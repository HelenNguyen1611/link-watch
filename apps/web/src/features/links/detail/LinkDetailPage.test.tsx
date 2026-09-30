import type {
	CheckNowResult,
	CheckView,
	IncidentView,
	LinkView,
	UptimeSummary,
} from "@linkwatch/core";
import { notifications } from "@mantine/notifications";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Api, ApiError } from "@/lib/api";
import { renderWithApi } from "@/test/render";
import { stubApi } from "@/test/stub-api";
import { LinkDetailPage } from "./LinkDetailPage";
import { toPoints } from "./ResponseChart";
import { uptimeColor } from "./UptimeBar";

let search = new URLSearchParams({ id: "L1" });
vi.mock("next/navigation", () => ({
	useSearchParams: () => search,
	usePathname: () => "/links/detail/",
	useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
beforeEach(() => {
	search = new URLSearchParams({ id: "L1" });
});
afterEach(() => {
	vi.useRealTimers();
});

const link = (over: Partial<LinkView> = {}): LinkView => ({
	id: "L1",
	domain: "abc.com",
	url: "https://abc.com/pricing",
	name: "Pricing",
	tags: [],
	method: "GET",
	expectedCodes: [{ from: 200, to: 399 }],
	timeoutS: 30,
	status: "up",
	paused: false,
	lastCheckedAt: "2026-09-29T23:01:00.000Z",
	lastHttpCode: 200,
	lastResponseMs: 320,
	nextRunAt: "2026-09-30T23:02:00.000Z",
	createdAt: "2026-09-01T00:00:00.000Z",
	...over,
});
const checks: CheckView[] = [
	{
		checkedAt: "2026-09-29T23:01:00.000Z",
		result: "up",
		httpCode: 200,
		responseMs: 320,
	},
	{
		checkedAt: "2026-09-28T23:01:00.000Z",
		result: "dead",
		httpCode: 404,
		responseMs: 90,
		errorType: "http_4xx",
	},
];
const uptime: UptimeSummary = {
	checks: 2,
	uptimePct: 50,
	days: [
		{
			day: "2026-09-29",
			checks: 1,
			up: 0,
			slow: 0,
			dead: 1,
			down: 0,
			uptimePct: 0,
		},
		{
			day: "2026-09-30",
			checks: 1,
			up: 1,
			slow: 0,
			dead: 0,
			down: 0,
			uptimePct: 100,
		},
	],
};
const incidents: IncidentView[] = [
	{
		id: "L1@2026-09-28T23:01:00.000Z",
		linkId: "L1",
		domain: "abc.com",
		url: "https://abc.com/pricing",
		type: "dead",
		state: "closed",
		openedAt: "2026-09-28T23:01:00.000Z",
		closedAt: "2026-09-29T00:01:00.000Z",
		downtimeMs: 3_600_000,
	},
];

function fakeApi(current: LinkView = link()) {
	let state = current;
	const api = {
		...stubApi(),
		getLink: vi.fn(async (id: string) => {
			if (id !== state.id) throw new ApiError(404, { error: "not_found" });
			return state;
		}),
		linkChecks: vi.fn(async () => ({ items: checks })),
		linkUptime: vi.fn(async () => uptime),
		linkIncidents: vi.fn(async () => ({ items: incidents })),
		resolveClaims: vi.fn(async (ids: string[], _note?: string) => ({
			items: ids.map((id) => ({
				incident: {
					...(incidents[0] as IncidentView),
					id,
					state: "verifying" as const,
				},
				decision: "started" as const,
			})),
		})),
		checkNow: vi.fn(
			async (): Promise<CheckNowResult> => ({
				queued: [state.id],
				skipped: [],
				jobs: 1,
			}),
		),
	} satisfies Api;
	return {
		api,
		setLink: (next: Partial<LinkView>) => {
			state = { ...state, ...next };
		},
	};
}

describe("LinkDetailPage — SCR-05 (FR-17, FR-18)", () => {
	it("FR-18: shows the link, its latest check, uptime, last checks and incidents", async () => {
		renderWithApi(<LinkDetailPage />, fakeApi().api);
		expect(
			await screen.findByRole("heading", { name: "https://abc.com/pricing" }),
		).toBeTruthy();
		expect(screen.getByText("Pricing · abc.com")).toBeTruthy();
		expect(await screen.findByTestId("uptime-total")).toHaveProperty(
			"textContent",
			"50%",
		);
		expect(screen.getAllByRole("listitem")).toHaveLength(2);
		expect(
			screen.getByRole("listitem", { name: "30/09/2026: 100% up (1 checks)" }),
		).toBeTruthy();
		const table = within(
			await screen.findByRole("table", { name: "Last 2 checks" }),
		);
		expect(table.getByText("404")).toBeTruthy();
		expect(table.getByText("4xx error")).toBeTruthy();
		const incident = screen.getByRole("link", { name: "29/09/2026 06:01" });
		expect(incident.getAttribute("href")).toContain(
			encodeURIComponent(incidents[0]?.id ?? ""),
		);
		expect(screen.getByText("1 h")).toBeTruthy();
	});

	it("unknown link → not found message", async () => {
		search = new URLSearchParams({ id: "NOPE" });
		renderWithApi(<LinkDetailPage />, fakeApi().api);
		expect(
			await screen.findByText("This link does not exist or was deleted."),
		).toBeTruthy();
	});

	it("FR-04: a paused link cannot be checked now", async () => {
		renderWithApi(<LinkDetailPage />, fakeApi(link({ paused: true })).api);
		const button = await screen.findByRole("button", { name: "Check now" });
		expect((button as HTMLButtonElement).disabled).toBe(true);
	});
});

describe("LinkDetailPage — Check now (FR-16)", () => {
	it("FR-16: queues the link, polls it every 3 s and reports the new result", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const show = vi.spyOn(notifications, "show");
		const { api, setLink } = fakeApi();
		renderWithApi(<LinkDetailPage />, api);
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		await user.click(await screen.findByRole("button", { name: "Check now" }));
		await waitFor(() =>
			expect(api.checkNow).toHaveBeenCalledWith({ linkIds: ["L1"] }),
		);
		const before = api.getLink.mock.calls.length;
		// The Checker records a new result a few seconds later.
		setLink({
			status: "dead",
			lastCheckedAt: new Date(Date.now() + 1000).toISOString(),
			lastHttpCode: 404,
		});
		await act(async () => {
			vi.advanceTimersByTime(3_100);
		});
		await waitFor(() =>
			expect(api.getLink.mock.calls.length).toBeGreaterThan(before),
		);
		await waitFor(() =>
			expect(show).toHaveBeenCalledWith(
				expect.objectContaining({ message: "Checked: Dead link." }),
			),
		);
		// The history is reloaded after the result.
		await waitFor(() =>
			expect(api.linkChecks.mock.calls.length).toBeGreaterThan(1),
		);
	});

	it("FR-04: a link paused meanwhile is skipped by the API → says so", async () => {
		const show = vi.spyOn(notifications, "show");
		const { api } = fakeApi();
		api.checkNow.mockResolvedValue({
			queued: [],
			skipped: [{ id: "L1", reason: "paused" }],
			jobs: 0,
		});
		renderWithApi(<LinkDetailPage />, api);
		await userEvent.click(
			await screen.findByRole("button", { name: "Check now" }),
		);
		await waitFor(() =>
			expect(show).toHaveBeenCalledWith(
				expect.objectContaining({
					message: "This link is paused, so it is not checked.",
				}),
			),
		);
	});
});

describe("LinkDetailPage — report fixed (FR-41)", () => {
	it("FR-41: a link with an open incident has Fixed — check again", async () => {
		const { api } = fakeApi(link({ status: "dead" }));
		const open: IncidentView = {
			...(incidents[0] as IncidentView),
			id: "L1@2026-09-30T00:00:00.000Z",
			state: "open",
			openedAt: "2026-09-30T00:00:00.000Z",
			closedAt: undefined,
		};
		api.linkIncidents.mockResolvedValue({ items: [open, ...incidents] });
		renderWithApi(<LinkDetailPage />, api);
		await userEvent.click(
			await screen.findByRole("button", { name: "Fixed — check again" }),
		);
		await waitFor(() =>
			expect(api.resolveClaims).toHaveBeenCalledWith([open.id], undefined),
		);
	});

	it("FR-41: no open incident → no button", async () => {
		renderWithApi(<LinkDetailPage />, fakeApi().api);
		await screen.findByRole("button", { name: "Check now" });
		expect(
			screen.queryByRole("button", { name: "Fixed — check again" }),
		).toBeNull();
	});
});

describe("chart and uptime helpers", () => {
	it("FR-18: chart points are oldest first; failed checks are marked", () => {
		expect(toPoints(checks)).toEqual([
			{ at: "2026-09-28T23:01:00.000Z", ms: 90, failed: true },
			{ at: "2026-09-29T23:01:00.000Z", ms: 320, failed: false },
		]);
	});

	it("FR-18: uptime colours — full, degraded, outage, no data", () => {
		expect(uptimeColor(100)).toContain("success");
		expect(uptimeColor(97)).toContain("yellow");
		expect(uptimeColor(50)).toContain("danger");
		expect(uptimeColor(undefined)).toContain("gray");
	});
});
