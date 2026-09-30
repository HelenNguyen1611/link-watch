import type { DomainSummary, RecipientView } from "@linkwatch/core";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Api, ApiError, type DomainDetailView } from "@/lib/api";
import { renderWithApi } from "@/test/render";
import { stubApi } from "@/test/stub-api";
import { DomainsPage } from "./DomainsPage";

let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
	useSearchParams: () => search,
	usePathname: () => "/domains/",
	useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
beforeEach(() => {
	search = new URLSearchParams();
});

const summary = (over: Partial<DomainSummary> = {}): DomainSummary => ({
	name: "abc.com",
	enabled: true,
	slowAlert: false,
	ignoreWaf403: false,
	status: "error",
	counts: { pending: 0, up: 3, slow: 0, dead: 1, down: 0, suspect: 0 },
	paused: 1,
	total: 5,
	avgResponseMs: 240,
	lastCheckedAt: "2026-09-29T23:01:00.000Z",
	nextRunAt: "2026-09-30T23:02:00.000Z",
	uptime7: 98.5,
	uptime30: 99.1,
	schedule: { source: "domain", scheduleId: "S15" },
	...over,
});
const detail = (over: Partial<DomainDetailView> = {}): DomainDetailView => ({
	...summary(),
	displayName: "ABC",
	scheduleId: "S15",
	uptimeDays: {
		checks: 2,
		uptimePct: 50,
		days: [
			{
				day: "2026-09-30",
				checks: 2,
				up: 1,
				slow: 0,
				dead: 1,
				down: 0,
				uptimePct: 50,
			},
		],
	},
	...over,
});

function fakeApi() {
	let recipients: RecipientView[] = [
		{ scope: "DOMAIN", target: "abc.com", email: "lan@abc.com", name: "Lan" },
	];
	const api = {
		...stubApi(),
		listDomains: vi.fn(async () => ({
			items: [
				summary(),
				summary({
					name: "xyz.vn",
					status: "normal",
					displayName: "XYZ Shop",
					schedule: { source: "default", scheduleId: "default" },
				}),
			],
			generatedAt: "2026-09-30T00:00:00.000Z",
		})),
		listSchedules: vi.fn(async () => ({
			items: [
				{
					id: "default",
					name: "Default",
					rule: { kind: "daily" as const, at: "06:00" },
				},
				{
					id: "S15",
					name: "Quarter",
					rule: { kind: "interval" as const, minutes: 15 as const },
				},
			],
		})),
		getDomain: vi.fn(async (name: string) => {
			if (name !== "abc.com") throw new ApiError(404, { error: "not_found" });
			return detail();
		}),
		updateDomain: vi.fn(async (_name: string, input: Record<string, unknown>) =>
			detail(input as Partial<DomainDetailView>),
		),
		listRecipients: vi.fn(async () => ({ items: recipients })),
		addRecipient: vi.fn(async (input: { email: string }) => {
			if (recipients.some((r) => r.email === input.email))
				throw new ApiError(409, { error: "duplicate" });
			const r = {
				scope: "DOMAIN" as const,
				target: "abc.com",
				email: input.email,
			};
			recipients = [...recipients, r];
			return r;
		}),
		removeRecipient: vi.fn(async (_s: string, _t: string, email: string) => {
			recipients = recipients.filter((r) => r.email !== email);
		}),
	} satisfies Api;
	return api;
}

describe("DomainsPage — list (FR-09, FR-10, FR-13)", () => {
	it("FR-10: status, link counts, uptime 7/30, response, schedule with its source", async () => {
		renderWithApi(<DomainsPage />, fakeApi());
		const link = await screen.findByRole("link", { name: "abc.com" });
		const row = within(link.closest("tr") as HTMLElement);
		expect(row.getByText("Error")).toBeTruthy();
		expect(row.getByText("5 links (1 paused)")).toBeTruthy();
		expect(row.getByText("Dead link: 1")).toBeTruthy();
		expect(row.getByText("98.5% / 99.1%")).toBeTruthy();
		expect(row.getByText("240 ms")).toBeTruthy();
		expect(
			await row.findByText("Every 15 minutes (from the domain)"),
		).toBeTruthy();
		expect(link.getAttribute("href")?.replace("/domains/?", "/domains?")).toBe(
			"/domains?d=abc.com",
		);
	});

	it("search by domain or display name", async () => {
		renderWithApi(<DomainsPage />, fakeApi());
		await screen.findByRole("link", { name: "abc.com" });
		await userEvent.type(
			screen.getByRole("textbox", { name: "Search" }),
			"shop",
		);
		expect(screen.queryByRole("link", { name: "abc.com" })).toBeNull();
		expect(screen.getByRole("link", { name: "XYZ Shop" })).toBeTruthy();
	});
});

describe("DomainsPage — detail (FR-08, FR-20, SRS 3.4)", () => {
	it("FR-10: /domains/?d=abc.com shows the domain with its uptime bar", async () => {
		search = new URLSearchParams({ d: "abc.com" });
		renderWithApi(<DomainsPage />, fakeApi());
		expect(await screen.findByRole("heading", { name: "ABC" })).toBeTruthy();
		expect(screen.getByTestId("uptime-total").textContent).toBe("50%");
	});

	it("FR-08 / SRS 3.4: save only the changed settings (WAF flag, schedule)", async () => {
		search = new URLSearchParams({ d: "abc.com" });
		const api = fakeApi();
		renderWithApi(<DomainsPage />, api);
		await userEvent.click(
			await screen.findByRole("switch", { name: /Ignore 403/ }),
		);
		await userEvent.click(
			screen.getAllByLabelText(/^Schedule/)[0] as HTMLElement,
		);
		await userEvent.click(
			await screen.findByRole("option", { name: "Default schedule" }),
		);
		await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await waitFor(() =>
			expect(api.updateDomain).toHaveBeenCalledWith("abc.com", {
				ignoreWaf403: true,
				scheduleId: null,
			}),
		);
	});

	it("FR-20: add and remove domain recipients; duplicate → message", async () => {
		search = new URLSearchParams({ d: "abc.com" });
		const api = fakeApi();
		renderWithApi(<DomainsPage />, api);
		expect(await screen.findByText("lan@abc.com")).toBeTruthy();
		await userEvent.type(
			screen.getByRole("textbox", { name: "Email" }),
			"ops@abc.com",
		);
		await userEvent.click(screen.getByRole("button", { name: "Add" }));
		expect(await screen.findByText("ops@abc.com")).toBeTruthy();
		await userEvent.type(
			screen.getByRole("textbox", { name: "Email" }),
			"lan@abc.com",
		);
		await userEvent.click(screen.getByRole("button", { name: "Add" }));
		expect(
			await screen.findByText("This recipient is already listed."),
		).toBeTruthy();
		await userEvent.click(
			screen.getByRole("button", { name: "Remove ops@abc.com" }),
		);
		await waitFor(() => expect(screen.queryByText("ops@abc.com")).toBeNull());
	});

	it("unknown domain → not found", async () => {
		search = new URLSearchParams({ d: "nope.vn" });
		renderWithApi(<DomainsPage />, fakeApi());
		expect(await screen.findByText("This domain does not exist.")).toBeTruthy();
	});
});
