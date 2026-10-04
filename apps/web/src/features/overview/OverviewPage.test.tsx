import type { DomainSummary, IncidentView } from "@linkwatch/core";
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Api } from "@/lib/api";
import { renderWithApi } from "@/test/render";
import { stubApi } from "@/test/stub-api";
import { OverviewPage } from "./OverviewPage";

vi.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(),
	usePathname: () => "/",
	useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const summary = (over: Partial<DomainSummary>): DomainSummary => ({
	name: "a.vn",
	enabled: true,
	slowAlert: false,
	ignoreWaf403: false,
	status: "normal",
	counts: { pending: 0, up: 5, slow: 0, dead: 0, down: 0, suspect: 0 },
	paused: 0,
	total: 5,
	uptime7: 100,
	lastCheckedAt: "2026-09-29T23:01:00.000Z",
	schedule: { source: "default" },
	...over,
});
const incident: IncidentView = {
	id: "L1@2026-09-30T08:00:00.000Z",
	linkId: "L1",
	domain: "down.vn",
	url: "https://down.vn/",
	type: "down",
	state: "open",
	openedAt: "2026-09-30T08:00:00.000Z",
};

function fakeApi(
	domains: DomainSummary[],
	incidents: IncidentView[] = [],
	closed: IncidentView[] = [],
) {
	return {
		...stubApi(),
		listDomains: vi.fn(async () => ({
			items: domains,
			generatedAt: "2026-09-30T09:00:00.000Z",
		})),
		listIncidents: vi.fn(async ({ state }: { state: "active" | "closed" }) => ({
			items: state === "active" ? incidents : closed,
			cursor: null,
		})),
	} satisfies Api;
}

describe("OverviewPage — SCR-01 (FR-09, FR-10)", () => {
	it("FR-10: totals, domains needing attention (worst first) and open incidents", async () => {
		renderWithApi(
			<OverviewPage />,
			fakeApi(
				[
					summary({ name: "ok.vn" }),
					summary({
						name: "slow.vn",
						status: "warning",
						counts: {
							pending: 0,
							up: 4,
							slow: 1,
							dead: 0,
							down: 0,
							suspect: 0,
						},
					}),
					summary({
						name: "down.vn",
						displayName: "Down Co",
						status: "down",
						counts: {
							pending: 0,
							up: 3,
							slow: 0,
							dead: 0,
							down: 2,
							suspect: 0,
						},
						uptime7: 60,
					}),
				],
				[incident],
			),
		);
		expect((await screen.findByTestId("stat-Domains")).textContent).toBe("3");
		expect(
			screen.getByText("Down 1 · Error 0 · Warning 1 · Normal 1"),
		).toBeTruthy();
		expect(screen.getByTestId("stat-Active links").textContent).toBe("15");
		expect(screen.getByTestId("stat-Failing links").textContent).toBe("2");
		// (100 × 5 + 100 × 5 + 60 × 5) / 15
		expect(screen.getByTestId("stat-Uptime 7 days").textContent).toBe("86.67%");

		const rows = within(
			screen.getByRole("table", { name: "Domains needing attention" }),
		).getAllByRole("row");
		expect(rows).toHaveLength(2);
		expect(within(rows[0] as HTMLElement).getByText("Down Co")).toBeTruthy();
		expect(
			within(rows[0] as HTMLElement).getByText("Site down: 2"),
		).toBeTruthy();
		expect(within(rows[1] as HTMLElement).getByText("slow.vn")).toBeTruthy();
		expect(
			within(rows[0] as HTMLElement)
				.getByRole("link", { name: "Down Co" })
				.getAttribute("href"),
		).toMatch(/^\/domains\/?\?d=down\.vn$/);

		expect(await screen.findByText("Open incidents (1)")).toBeTruthy();
		expect(screen.getByRole("link", { name: "https://down.vn/" })).toBeTruthy();
	});

	it("every domain Normal and no incidents → says so", async () => {
		renderWithApi(<OverviewPage />, fakeApi([summary({})]));
		expect(await screen.findByText("Every domain is Normal.")).toBeTruthy();
		expect(
			await screen.findByText("No open incidents. Every link is working."),
		).toBeTruthy();
	});

	it("SCR-01: incidents resolved in the last 24 hours stay visible after they close", async () => {
		const closedAt = (msAgo: number) =>
			new Date(Date.now() - msAgo).toISOString();
		renderWithApi(
			<OverviewPage />,
			fakeApi(
				[summary({})],
				[],
				[
					{
						...incident,
						id: "L2@x",
						url: "https://fixed.vn/",
						state: "closed",
						closedAt: closedAt(60 * 60_000),
						downtimeMs: 4 * 60 * 60_000,
					},
					{
						...incident,
						id: "L3@x",
						url: "https://old.vn/",
						state: "closed",
						closedAt: closedAt(2 * 24 * 60 * 60_000),
						downtimeMs: 600_000,
					},
				],
			),
		);
		expect(
			await screen.findByText("Resolved in the last 24 hours (1)"),
		).toBeTruthy();
		const table = screen.getByRole("table", {
			name: "Resolved in the last 24 hours",
		});
		expect(
			within(table).getByRole("link", { name: "https://fixed.vn/" }),
		).toBeTruthy();
		expect(within(table).getByText("4 h")).toBeTruthy();
		expect(screen.queryByRole("link", { name: "https://old.vn/" })).toBeNull();
	});

	it("no incident resolved in the last 24 hours → says so", async () => {
		renderWithApi(<OverviewPage />, fakeApi([summary({})]));
		expect(
			await screen.findByText("No incidents resolved in the last 24 hours."),
		).toBeTruthy();
	});

	it("no links yet → points to adding links", async () => {
		renderWithApi(<OverviewPage />, fakeApi([]));
		expect(
			await screen.findByText("No links yet. Add links to start monitoring."),
		).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Add links" }).getAttribute("href"),
		).toMatch(/^\/links\/?$/);
	});
});
