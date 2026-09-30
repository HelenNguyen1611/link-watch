import type { IncidentDetail, IncidentView } from "@linkwatch/core";
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
