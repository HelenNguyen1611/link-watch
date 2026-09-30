import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../db/testing";
import { incidentId } from "../incident";
import type { PriorityJob } from "../queue";
import { hashToken, newToken, tokenTtl } from "../token";
import { recordCheck } from "./checks";
import { applyVerification } from "./claims";
import { createLink, getLink } from "./links";
import { readTokenClaim, submitTokenClaim } from "./token-claims";

let t: TestDb;
beforeAll(async () => {
	t = await createTestDb();
});
afterAll(() => t?.drop());

const T0 = Date.parse("2026-09-30T03:00:00.000Z");
const at = (min: number) => new Date(T0 + min * 60_000);
let seq = 0;

/** A link with an open incident (two failed checks) and a token for lan@abc.com. */
async function setup(path: string) {
	const link = await createLink(
		t.db,
		{ url: `https://claims.vn/${path}` },
		{ now: at(-10) },
	);
	const fail = {
		result: "dead" as const,
		httpCode: 404,
		responseMs: 10,
		errorType: "http_4xx" as const,
	};
	await recordCheck(t.db, await getLink(t.db, link.id), fail, {
		now: at(-5),
		jobId: `j${++seq}`,
	});
	await recordCheck(t.db, await getLink(t.db, link.id), fail, {
		now: at(-3),
		jobId: `j${++seq}`,
	});
	const id = incidentId(link.id, at(-3).toISOString());
	const token = newToken();
	await t.db.Token.put({
		tokenHash: hashToken(token),
		incidentIds: [id],
		recipientEmail: "lan@abc.com",
		issuedAt: at(-2).toISOString(),
		ttl: tokenTtl(at(-2)),
	}).go();
	return { link, id, token };
}

const collect = () => {
	const jobs: { job: PriorityJob; delay: number }[] = [];
	return {
		jobs,
		send: async (job: PriorityJob, delay: number) =>
			void jobs.push({ job, delay }),
	};
};

describe("confirmation page — FR-35, AC-11, AC-12", () => {
	it("AC-11: opening the link (GET) writes nothing — no claim, incident unchanged", async () => {
		const { id, token } = await setup("scan");
		const v = await readTokenClaim(t.db, token, at(0));
		expect(v).toMatchObject({ status: "open", recipient: "lan@abc.com" });
		expect(v.status === "open" && v.items[0]?.incident.state).toBe("open");
		expect(
			(await t.db.Claim.query.byIncident({ incidentId: id }).go()).data,
		).toEqual([]);
	});

	it("AC-12: unknown or 7-day-old token → expired", async () => {
		const { token } = await setup("old");
		expect(await readTokenClaim(t.db, "nope", at(0))).toEqual({
			status: "expired",
		});
		expect(await readTokenClaim(t.db, token, at(7 * 24 * 60))).toEqual({
			status: "expired",
		});
	});
});

describe("submit — FR-36, FR-40, AC-13", () => {
	it("FR-36: records the claim, moves to Verifying, queues checks now, +2 and +5 minutes", async () => {
		const { id, token, link } = await setup("start");
		const { jobs, send } = collect();
		const v = await submitTokenClaim(
			t.db,
			{ token, note: "Renewed SSL" },
			{ send, now: at(0) },
		);
		expect(v.status).toBe("open");
		const item = v.status === "open" ? v.items[0] : undefined;
		expect(item?.decision).toBe("started");
		expect(item?.incident.state).toBe("verifying");
		expect(item?.progress).toMatchObject({
			byEmail: "lan@abc.com",
			channel: "email",
			note: "Renewed SSL",
			outcome: "pending",
		});
		expect(jobs.map((j) => [j.job.kind, j.job.attempt, j.delay])).toEqual([
			["verify", 1, 0],
			["verify", 2, 120],
			["verify", 3, 300],
		]);
		expect(jobs[0]?.job).toMatchObject({
			domain: "claims.vn",
			linkIds: [link.id],
			incidentId: id,
			claimedAt: at(0).toISOString(),
		});
	});

	it("AC-13: 5 clicks in 1 minute → a single verification", async () => {
		const { id, token } = await setup("five");
		const { jobs, send } = collect();
		for (let s = 0; s < 5; s++)
			await submitTokenClaim(
				t.db,
				{ token },
				{ send, now: new Date(T0 + s * 12_000) },
			);
		expect(jobs).toHaveLength(3);
		expect(
			(await t.db.Claim.query.byIncident({ incidentId: id }).go()).data,
		).toHaveLength(1);
	});

	it("FR-42 / AC-12: incident already recovered → 'recovered', no job", async () => {
		const { id, token, link } = await setup("recovered");
		await recordCheck(
			t.db,
			await getLink(t.db, link.id),
			{ result: "up", httpCode: 200, responseMs: 5 },
			{
				now: at(1),
				jobId: `j${++seq}`,
			},
		);
		const { jobs, send } = collect();
		const v = await submitTokenClaim(t.db, { token }, { send, now: at(2) });
		expect(v.status).toBe("recovered");
		expect(jobs).toEqual([]);
		expect((await readTokenClaim(t.db, token, at(2))).status).toBe("recovered");
		expect(
			(await t.db.Claim.query.byIncident({ incidentId: id }).go()).data,
		).toEqual([]);
	});
});

describe("verification — FR-37, FR-38 (usecase level)", () => {
	it("AC-09: first check succeeds → incident closed 'fixed by' the claimer, claim fixed", async () => {
		const { id, token, link } = await setup("fixed");
		await submitTokenClaim(
			t.db,
			{ token },
			{ send: async () => {}, now: at(0) },
		);
		const ok = { result: "up" as const, httpCode: 200, responseMs: 20 };
		await recordCheck(t.db, await getLink(t.db, link.id), ok, {
			now: at(0.1),
			jobId: `j${++seq}`,
			verifiedBy: "lan@abc.com",
		});
		expect(
			await applyVerification(
				t.db,
				{ incidentId: id, claimedAt: at(0).toISOString(), attempt: 1 },
				ok,
				at(0.1),
			),
		).toBe("fixed");
		const v = await readTokenClaim(t.db, token, at(1));
		expect(v.status).toBe("recovered");
		const item = v.status === "recovered" ? v.items[0] : undefined;
		expect(item?.incident).toMatchObject({
			state: "closed",
			closedReason: "verified_fix",
		});
		expect(item?.progress).toMatchObject({ outcome: "fixed", done: true });
		const { data } = await t.db.Incident.get({
			linkId: link.id,
			openedAt: at(-3).toISOString(),
		}).go();
		expect(data?.closedBy).toBe("lan@abc.com");
	});

	it("AC-10: three failed checks → claim still failing, incident back to Open with a note", async () => {
		const { id, token, link } = await setup("still");
		await submitTokenClaim(
			t.db,
			{ token },
			{ send: async () => {}, now: at(0) },
		);
		const fail = {
			result: "dead" as const,
			httpCode: 404,
			responseMs: 10,
			errorType: "http_4xx" as const,
		};
		const job = (attempt: number) => ({
			incidentId: id,
			claimedAt: at(0).toISOString(),
			attempt,
		});
		for (const [n, min] of [
			[1, 0.1],
			[2, 2.1],
			[3, 5.1],
		] as const) {
			await recordCheck(t.db, await getLink(t.db, link.id), fail, {
				now: at(min),
				jobId: `j${++seq}`,
				verifiedBy: "lan@abc.com",
			});
			expect(await applyVerification(t.db, job(n), fail, at(min))).toBe(
				n < 3 ? "retry" : "still_failing",
			);
		}
		const { data } = await t.db.Incident.get({
			linkId: link.id,
			openedAt: at(-3).toISOString(),
		}).go();
		expect(data).toMatchObject({
			state: "open",
			claimNote:
				"Reported fixed by lan@abc.com but still failing (404 http_4xx)",
		});
		expect(data?.verifyingBy).toBeUndefined();
		const claims = (await t.db.Claim.query.byIncident({ incidentId: id }).go())
			.data;
		expect(claims[0]).toMatchObject({ outcome: "still_failing" });
		expect(claims[0]?.attempts).toHaveLength(3);
	});
});
