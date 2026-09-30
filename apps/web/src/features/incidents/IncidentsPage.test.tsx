import type { IncidentDetail, IncidentView } from "@linkwatch/core";
import { notifications } from "@mantine/notifications";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Api, ApiError } from "@/lib/api";
import { renderWithApi } from "@/test/render";
import { stubApi } from "@/test/stub-api";
import { IncidentsPage } from "./IncidentsPage";

let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
	useSearchParams: () => search,
	usePathname: () => "/incidents/",
	useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
beforeEach(() => {
	search = new URLSearchParams();
});

const OPENED = "2026-09-30T08:13:29.704Z";
const incident = (over: Partial<IncidentView> = {}): IncidentView => ({
	id: `L1@${OPENED}`,
	linkId: "L1",
	domain: "hueai.net",
	url: "https://watch.hueai.net/smoke/x.txt",
	type: "dead",
	state: "open",
	openedAt: OPENED,
	httpCode: 403,
	errorType: "http_4xx",
	...over,
});

function fakeApi(
	opts: {
		active?: IncidentView[];
		closed?: IncidentView[];
		detail?: IncidentDetail;
	} = {},
) {
	const api = {
		...stubApi(),
		listIncidents: vi.fn(
			async ({
				state,
				cursor,
			}: {
				state: "active" | "closed";
				cursor?: string | null;
			}) => {
				if (state === "active")
					return { items: opts.active ?? [], cursor: null };
				const all = opts.closed ?? [];
				// One per page to exercise "Load more".
				const i = Number(cursor ?? 0);
				return {
					items: all.slice(i, i + 1),
					cursor: i + 1 < all.length ? String(i + 1) : null,
				};
			},
		),
		getIncident: vi.fn(async (id: string) => {
			if (!opts.detail || opts.detail.id !== id)
				throw new ApiError(404, { error: "not_found" });
			return opts.detail;
		}),
		resolveClaims: vi.fn(async (ids: string[], _note?: string) => ({
			items: ids.map((id) => ({
				incident: incident({ id, state: "verifying" }),
				decision: "started" as const,
			})),
		})),
		ackIncident: vi.fn(async (_id: string, note?: string) => ({
			...(opts.detail as IncidentDetail),
			ackedBy: "admin@abc.com",
			ackedAt: "2026-09-30T09:00:00.000Z",
			...(note ? { note } : {}),
		})),
	} satisfies Api;
	return api;
}

describe("IncidentsPage — list (FR-19)", () => {
	it("FR-19: open incidents with type, state, opened time, duration and error; URL links to the detail", async () => {
		renderWithApi(<IncidentsPage />, fakeApi({ active: [incident()] }));
		const link = await screen.findByRole("link", {
			name: "https://watch.hueai.net/smoke/x.txt",
		});
		// next/link drops the trailing slash in tests; the static build (trailingSlash) keeps it.
		expect(
			link.getAttribute("href")?.replace("/incidents/?", "/incidents?"),
		).toBe(`/incidents?id=${encodeURIComponent(`L1@${OPENED}`)}`);
		const row = within(link.closest("tr") as HTMLElement);
		expect(row.getByText("Dead link")).toBeTruthy();
		expect(row.getByText("Open")).toBeTruthy();
		expect(row.getByText("30/09/2026 15:13")).toBeTruthy();
		expect(row.getByText("403 · 4xx error")).toBeTruthy();
	});

	it("FR-19: an acknowledged open incident shows Acknowledged", async () => {
		renderWithApi(
			<IncidentsPage />,
			fakeApi({
				active: [
					incident({ ackedAt: "2026-09-30T09:00:00.000Z", ackedBy: "a@b.co" }),
				],
			}),
		);
		expect(await screen.findByText("Acknowledged")).toBeTruthy();
	});

	it("no open incidents → says every link is working", async () => {
		renderWithApi(<IncidentsPage />, fakeApi());
		expect(
			await screen.findByText("No open incidents. Every link is working."),
		).toBeTruthy();
	});

	it("FR-19: Closed tab shows the downtime and pages with Load more", async () => {
		const closed = [
			incident({
				id: "A@1",
				linkId: "A",
				url: "https://a.vn/",
				state: "closed",
				downtimeMs: 601_424,
			}),
			incident({
				id: "B@1",
				linkId: "B",
				url: "https://b.vn/",
				state: "closed",
				downtimeMs: 3_600_000,
			}),
		];
		const api = fakeApi({ closed });
		renderWithApi(<IncidentsPage />, api);
		await screen.findByText("No open incidents. Every link is working.");
		await userEvent.click(screen.getByText("Closed"));
		const a = await screen.findByRole("link", { name: "https://a.vn/" });
		expect(
			within(a.closest("tr") as HTMLElement).getByText("10 min"),
		).toBeTruthy();
		await userEvent.click(screen.getByRole("button", { name: "Load more" }));
		const b = await screen.findByRole("link", { name: "https://b.vn/" });
		expect(
			within(b.closest("tr") as HTMLElement).getByText("1 h"),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
	});

	it("load error → error box", async () => {
		const api = fakeApi();
		api.listIncidents.mockRejectedValue(
			new ApiError(500, { error: "internal" }),
		);
		renderWithApi(<IncidentsPage />, api);
		expect(await screen.findByText("Could not load incidents.")).toBeTruthy();
	});
});

describe("IncidentsPage — detail (FR-19, links in emails)", () => {
	const detail: IncidentDetail = {
		...incident(),
		claims: [],
		notifications: [
			{
				to: "helen@wootech.co",
				kind: "down",
				status: "sent",
				sentAt: "2026-09-30T08:18:30.904Z",
			},
			{
				to: "x@abc.com",
				kind: "down",
				status: "failed",
				sentAt: "2026-09-30T08:18:30.904Z",
				error: "MessageRejected",
			},
		],
	};

	it("FR-19: /incidents/?id=… shows the incident, links to the link page and lists the emails sent", async () => {
		search = new URLSearchParams({ id: detail.id });
		renderWithApi(<IncidentsPage />, fakeApi({ detail }));
		expect(
			await screen.findByRole("heading", { name: detail.url }),
		).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Link details" }).getAttribute("href"),
		).toMatch(/^\/links\/detail\/?\?id=L1$/);
		expect(
			screen.getByRole("link", { name: "All incidents" }).getAttribute("href"),
		).toMatch(/^\/incidents\/?$/);
		const helen = within(
			screen.getByText("helen@wootech.co").closest("tr") as HTMLElement,
		);
		expect(helen.getByText("Incident")).toBeTruthy();
		expect(helen.getByText("Sent")).toBeTruthy();
		expect(screen.getByText("Failed — MessageRejected")).toBeTruthy();
	});

	it("FR-19 / FR-23: Acknowledge with a note calls the API and shows who acknowledged", async () => {
		search = new URLSearchParams({ id: detail.id });
		const api = fakeApi({ detail });
		renderWithApi(<IncidentsPage />, api);
		await userEvent.type(
			await screen.findByLabelText("Note"),
			"Deploying a fix",
		);
		await userEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
		await waitFor(() =>
			expect(api.ackIncident).toHaveBeenCalledWith(
				detail.id,
				"Deploying a fix",
			),
		);
		expect(
			await screen.findByText(/Acknowledged by admin@abc.com/),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Update note" })).toBeTruthy();
	});

	it("FR-19: incident closed meanwhile (409) → says so", async () => {
		search = new URLSearchParams({ id: detail.id });
		const api = fakeApi({ detail });
		api.ackIncident.mockRejectedValue(
			new ApiError(409, { error: "incident_closed" }),
		);
		renderWithApi(<IncidentsPage />, api);
		await userEvent.click(
			await screen.findByRole("button", { name: "Acknowledge" }),
		);
		expect(
			await screen.findByText("This incident was closed in the meantime."),
		).toBeTruthy();
	});

	it("a closed incident has no Acknowledge button", async () => {
		const closed = {
			...detail,
			state: "closed" as const,
			closedAt: "2026-09-30T08:23:31.128Z",
			downtimeMs: 601_424,
		};
		search = new URLSearchParams({ id: closed.id });
		renderWithApi(<IncidentsPage />, fakeApi({ detail: closed }));
		expect(await screen.findByText("This incident is closed.")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Acknowledge" })).toBeNull();
		expect(screen.getByText("10 min")).toBeTruthy();
	});

	it("unknown id from an old email → not found message", async () => {
		search = new URLSearchParams({ id: "nope" });
		renderWithApi(<IncidentsPage />, fakeApi({ detail }));
		expect(
			await screen.findByText(/This incident does not exist/),
		).toBeTruthy();
	});
});

describe("IncidentsPage — report fixed in the app (FR-41)", () => {
	const detail: IncidentDetail = {
		...incident(),
		notifications: [],
		claims: [],
	};

	it("FR-41: Fixed — check again with a note starts the checks for this incident", async () => {
		const show = vi.spyOn(notifications, "show");
		search = new URLSearchParams({ id: detail.id });
		const api = fakeApi({ detail });
		renderWithApi(<IncidentsPage />, api);
		await userEvent.type(
			await screen.findByLabelText("Note (optional)"),
			"Restored the page",
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Fixed — check again" }),
		);
		await waitFor(() =>
			expect(api.resolveClaims).toHaveBeenCalledWith(
				[detail.id],
				"Restored the page",
			),
		);
		await waitFor(() =>
			expect(show).toHaveBeenCalledWith(
				expect.objectContaining({
					message: "Checking the incident now, then after 2 and 5 minutes.",
				}),
			),
		);
	});

	it("FR-41 / FR-38: timeline lists each claim with who, channel, note, outcome and checks", async () => {
		search = new URLSearchParams({ id: detail.id });
		const withClaims: IncidentDetail = {
			...detail,
			claimNote: "Still failing after the reported fix.",
			claims: [
				{
					claimedAt: "2026-09-30T09:00:00.000Z",
					byEmail: "dev@abc.com",
					channel: "email",
					note: "Fixed the CDN",
					outcome: "still_failing",
					attempts: [
						{
							attempt: 1,
							at: "2026-09-30T09:00:05.000Z",
							result: "dead",
							httpCode: 404,
						},
						{
							attempt: 2,
							at: "2026-09-30T09:02:05.000Z",
							result: "dead",
							httpCode: 404,
						},
					],
				},
			],
		};
		renderWithApi(<IncidentsPage />, fakeApi({ detail: withClaims }));
		expect(
			await screen.findByText("dev@abc.com via email, 30/09/2026 16:00"),
		).toBeTruthy();
		expect(screen.getByText("“Fixed the CDN”")).toBeTruthy();
		expect(
			screen.getByText(
				"Still failing — check 1: Dead link 404, check 2: Dead link 404",
			),
		).toBeTruthy();
		expect(
			screen.getByText("Still failing after the reported fix."),
		).toBeTruthy();
		// Not being verified any more → it can be reported again.
		expect(
			screen.getByRole("button", { name: "Fixed — check again" }),
		).toBeTruthy();
	});

	it("FR-39: while a claim is being verified there is no second button", async () => {
		search = new URLSearchParams({ id: detail.id });
		const verifying: IncidentDetail = {
			...detail,
			state: "verifying",
			claims: [
				{
					claimedAt: "2026-09-30T09:00:00.000Z",
					byEmail: "admin@abc.com",
					channel: "app",
					outcome: "pending",
					attempts: [],
				},
			],
		};
		renderWithApi(<IncidentsPage />, fakeApi({ detail: verifying }));
		expect(await screen.findByText("Checking the reported fix…")).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Fixed — check again" }),
		).toBeNull();
		expect(
			screen.getByText("admin@abc.com via LinkWatch, 30/09/2026 16:00"),
		).toBeTruthy();
	});

	it("FR-41: several open incidents are selected in the list and reported fixed at once", async () => {
		const api = fakeApi({
			active: [
				incident(),
				incident({ id: "L2@1", linkId: "L2", url: "https://b.vn/" }),
				incident({
					id: "L3@1",
					linkId: "L3",
					url: "https://c.vn/",
					state: "verifying",
				}),
			],
		});
		renderWithApi(<IncidentsPage />, api);
		await userEvent.click(
			await screen.findByRole("checkbox", {
				name: "Select https://watch.hueai.net/smoke/x.txt",
			}),
		);
		await userEvent.click(
			screen.getByRole("checkbox", { name: "Select https://b.vn/" }),
		);
		// An incident already being verified cannot be selected.
		expect(
			screen.queryByRole("checkbox", { name: "Select https://c.vn/" }),
		).toBeNull();
		const toolbar = within(screen.getByRole("toolbar"));
		expect(toolbar.getByText("2 selected")).toBeTruthy();
		await userEvent.click(
			toolbar.getByRole("button", { name: "Fixed — check again" }),
		);
		await waitFor(() =>
			expect(api.resolveClaims).toHaveBeenCalledWith(
				[`L1@${OPENED}`, "L2@1"],
				undefined,
			),
		);
		await waitFor(() => expect(screen.queryByRole("toolbar")).toBeNull());
	});
});
