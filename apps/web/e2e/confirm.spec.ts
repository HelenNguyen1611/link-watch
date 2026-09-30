import { type APIRequestContext, expect, test } from "@playwright/test";

/**
 * Step 34: SCR-10 "Fixed — check again" in a real browser on a phone viewport (NFR-10).
 * The E2E server (tests/e2e/server.ts) runs the real API and Checker; verify delays are
 * scaled down (0 / 2 / 5 s instead of 0 / 2 / 5 min).
 */

type Seeded = { token: string; incidentId: string; url: string };

async function seed(request: APIRequestContext, name: string): Promise<Seeded> {
	const res = await request.post("/__e2e/incident", { data: { name } });
	expect(res.ok()).toBe(true);
	return res.json();
}

const fixSite = (request: APIRequestContext, name: string) =>
	request.post("/__e2e/site", { data: { name, status: 200 } });

async function claims(request: APIRequestContext, incidentId: string) {
	const res = await request.get(
		`/__e2e/claims?incidentId=${encodeURIComponent(incidentId)}`,
	);
	return ((await res.json()) as { items: unknown[] }).items;
}

const confirmUrl = (token: string) =>
	`/confirm/?token=${encodeURIComponent(token)}`;

test("AC-09: the site is fixed → confirm → the page shows OK within 30 s, fixed by the recipient", async ({
	page,
	request,
}) => {
	const s = await seed(request, "ac09");
	await page.goto(confirmUrl(s.token));
	await expect(page.getByText(s.url)).toBeVisible();
	await fixSite(request, "ac09");
	await page.getByLabel("Note (optional)").fill("Restored the file");
	const started = Date.now();
	await page.getByRole("button", { name: "Confirm & check again" }).click();
	await expect(
		page.getByText("Fixed — the link works again. Everyone was emailed."),
	).toBeVisible({ timeout: 30_000 });
	expect(Date.now() - started).toBeLessThan(30_000);
	await expect(page.getByText("Check 1: Up (HTTP 200)")).toBeVisible();
	await expect(page.getByText(/fixed by lan@abc\.com/)).toBeVisible();
	await expect(page.getByText("Already back up")).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Confirm & check again" }),
	).toHaveCount(0);
});

test("AC-11: a link scanner opening the page (GET) records no claim", async ({
	page,
	request,
}) => {
	const s = await seed(request, "ac11");
	// Scanner: fetches the page and the API without clicking anything.
	expect((await request.get(confirmUrl(s.token))).ok()).toBe(true);
	const api = await request.get(
		`/api/public/claims?token=${encodeURIComponent(s.token)}`,
	);
	expect(api.headers()["cache-control"]).toContain("no-store");
	// A real browser renders it, still without clicking.
	await page.goto(confirmUrl(s.token));
	await expect(
		page.getByRole("button", { name: "Confirm & check again" }),
	).toBeVisible();
	expect(await claims(request, s.incidentId)).toHaveLength(0);
});

test("AC-12: unknown or expired token → expired message, no button", async ({
	page,
}) => {
	await page.goto(confirmUrl("x".repeat(43)));
	await expect(page.getByText("This link has expired")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Confirm & check again" }),
	).toHaveCount(0);
});

test("AC-12 / FR-42: token of an incident someone else already fixed → shows who fixed it, no button", async ({
	page,
	request,
}) => {
	const s = await seed(request, "ac12");
	await fixSite(request, "ac12");
	// Someone else's claim closes it; this recipient opens an older email afterwards.
	await request.post("/api/incidents/resolve-claim", {
		headers: { authorization: "Bearer e2e" },
		data: { incidentIds: [s.incidentId] },
	});
	await expect
		.poll(async () => {
			const res = await request.get(
				`/api/public/claims?token=${encodeURIComponent(s.token)}`,
			);
			return ((await res.json()) as { status: string }).status;
		})
		.toBe("recovered");
	await page.goto(confirmUrl(s.token));
	await expect(page.getByText(/fixed by ops@abc\.com/)).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Confirm & check again" }),
	).toHaveCount(0);
});

test("AC-13: confirming 5 times in a minute starts one verification", async ({
	page,
	request,
}) => {
	const s = await seed(request, "ac13");
	// Two tabs and repeated POSTs, as an impatient user would.
	await page.goto(confirmUrl(s.token));
	await page.getByRole("button", { name: "Confirm & check again" }).click();
	for (let i = 0; i < 4; i++)
		await request.post("/api/public/claims", { data: { token: s.token } });
	expect(await claims(request, s.incidentId)).toHaveLength(1);
});

test("FR-38: still failing after 3 checks → only you were told, can report again", async ({
	page,
	request,
}) => {
	const s = await seed(request, "fr38");
	await page.goto(confirmUrl(s.token));
	await page.getByRole("button", { name: "Confirm & check again" }).click();
	await expect(page.getByText("Checking…")).toBeVisible();
	await expect(
		page.getByText(
			"Still failing after 3 checks. Only you were told; the incident stays open.",
		),
	).toBeVisible({ timeout: 30_000 });
	for (const n of [1, 2, 3])
		await expect(
			page.getByText(`Check ${n}: Dead link (HTTP 404)`),
		).toBeVisible();
	await expect(
		page.getByText(
			"The last check did not succeed. You can report it fixed again.",
		),
	).toBeVisible();
	// Same page session: the button is back without a reload.
	await expect(
		page.getByRole("button", { name: "Confirm & check again" }),
	).toBeVisible();
});
