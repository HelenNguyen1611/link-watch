import type { CheckNowResult, LinkUpdateRaw, LinkView } from "@linkwatch/core";
import { notifications } from "@mantine/notifications";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { type Api, ApiError } from "@/lib/api";
import { renderWithApi, signedInAuth } from "@/test/render";
import { stubApi } from "@/test/stub-api";
import { LinksPage } from "./LinksPage";

const view = (i: number, over: Partial<LinkView> = {}): LinkView => ({
	id: `L${String(i).padStart(3, "0")}`,
	domain: i % 2 ? "abc.com" : "xyz.vn",
	url: `https://${i % 2 ? "abc.com" : "xyz.vn"}/p${i}`,
	tags: i % 3 === 0 ? ["shop"] : [],
	method: "GET",
	expectedCodes: [{ from: 200, to: 399 }],
	timeoutS: 30,
	status: "up",
	paused: false,
	createdAt: `2026-09-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
	...over,
});

function fakeApi(links: LinkView[]) {
	let rows = [...links];
	const api = {
		...stubApi(),
		getSnapshot: vi.fn(async () => ({
			generatedAt: "2026-09-29T00:00:00.000Z",
			items: rows,
			stored: true,
		})),
		freshLinks: vi.fn(async (keys: { domain: string; id: string }[]) => ({
			items: rows.filter((l) => keys.some((k) => k.id === l.id)),
		})),
		bulkLinks: vi.fn(
			async (_action: "pause" | "resume" | "delete", ids: string[]) => {
				// The snapshot is not rebuilt yet: the screen must apply the change itself.
				return { updated: ids, notFound: [] as string[] };
			},
		),
		checkNow: vi.fn(
			async (input: { linkIds?: string[] }): Promise<CheckNowResult> => ({
				queued: input.linkIds ?? [],
				skipped: [],
				jobs: 1,
			}),
		),
		updateLink: vi.fn(async (id: string, input: LinkUpdateRaw) => {
			const row = rows.find((l) => l.id === id) as LinkView;
			const next = { ...row, ...(input as Partial<LinkView>) };
			return next;
		}),
		exportCsv: vi.fn(async () => "url\r\nhttps://abc.com/p1\r\n"),
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
	} satisfies Api;
	return {
		api,
		setRows: (next: LinkView[]) => {
			rows = next;
		},
	};
}

const dataRows = () =>
	screen
		.getAllByRole("row")
		.slice(1)
		.map((r) => within(r).getAllByRole("link")[0]?.textContent);

describe("LinksPage — pagination (SCR-03)", () => {
	it("120 links → 50 per page, Showing 1–50 of 120; next page shows 51–100", async () => {
		const links = Array.from({ length: 120 }, (_, i) => view(i + 1));
		renderWithApi(<LinksPage />, fakeApi(links).api);
		await screen.findByText("https://abc.com/p1");
		expect(dataRows()).toHaveLength(50);
		expect(screen.getByText("Showing 1–50 of 120")).toBeTruthy();
		await userEvent.click(screen.getByRole("button", { name: "Next page" }));
		expect(screen.getByText("Showing 51–100 of 120")).toBeTruthy();
		expect(dataRows()[0]).toBe("https://abc.com/p51");
	});

	it("changing a filter goes back to page 1", async () => {
		const links = Array.from({ length: 120 }, (_, i) => view(i + 1));
		renderWithApi(<LinksPage />, fakeApi(links).api);
		await screen.findByText("https://abc.com/p1");
		await userEvent.click(screen.getByRole("button", { name: "Next page" }));
		await userEvent.type(
			screen.getByRole("textbox", { name: "Search" }),
			"abc",
		);
		await waitFor(() =>
			expect(screen.getByText("Showing 1–50 of 60")).toBeTruthy(),
		);
	});
});

describe("LinksPage — bulk actions (FR-04, FR-16)", () => {
	it("FR-04: select two links and pause them — shown as paused at once", async () => {
		const { api } = fakeApi([view(1), view(2), view(3)]);
		renderWithApi(<LinksPage />, api);
		await screen.findByText("https://abc.com/p1");
		await userEvent.click(
			screen.getByRole("checkbox", { name: "Select https://abc.com/p1" }),
		);
		await userEvent.click(
			screen.getByRole("checkbox", { name: "Select https://xyz.vn/p2" }),
		);
		const bar = within(
			screen.getByRole("toolbar", { name: "Actions on selected links" }),
		);
		expect(bar.getByText("2 selected")).toBeTruthy();
		await userEvent.click(bar.getByRole("button", { name: "Pause" }));
		await waitFor(() =>
			expect(api.bulkLinks).toHaveBeenCalledWith("pause", ["L001", "L002"]),
		);
		await waitFor(() =>
			expect(screen.getAllByText("· Paused")).toHaveLength(2),
		);
		expect(screen.queryByRole("toolbar")).toBeNull();
	});

	it("FR-04: delete needs a confirming click; the rows disappear without waiting for the snapshot", async () => {
		const { api } = fakeApi([view(1), view(2)]);
		renderWithApi(<LinksPage />, api);
		await screen.findByText("https://abc.com/p1");
		await userEvent.click(
			screen.getByRole("checkbox", { name: "Select all links on this page" }),
		);
		const bar = within(screen.getByRole("toolbar"));
		await userEvent.click(bar.getByRole("button", { name: "Delete" }));
		expect(api.bulkLinks).not.toHaveBeenCalled();
		await userEvent.click(bar.getByRole("button", { name: "Delete 2 links" }));
		await waitFor(() =>
			expect(api.bulkLinks).toHaveBeenCalledWith("delete", ["L001", "L002"]),
		);
		expect(await screen.findByText(/No links yet|No links match/)).toBeTruthy();
	});

	it("FR-16: Check now on the selection", async () => {
		const show = vi.spyOn(notifications, "show");
		const { api } = fakeApi([view(1), view(2)]);
		renderWithApi(<LinksPage />, api);
		await screen.findByText("https://abc.com/p1");
		await userEvent.click(
			screen.getByRole("checkbox", { name: "Select https://abc.com/p1" }),
		);
		await userEvent.click(
			within(screen.getByRole("toolbar")).getByRole("button", {
				name: "Check now",
			}),
		);
		await waitFor(() =>
			expect(api.checkNow).toHaveBeenCalledWith({ linkIds: ["L001"] }),
		);
		await waitFor(() =>
			expect(show).toHaveBeenCalledWith(
				expect.objectContaining({ message: "1 links queued for a check." }),
			),
		);
	});
});

describe("LinksPage — edit (FR-01, FR-04)", () => {
	it("FR-04: edit sends only the changed fields and updates the row", async () => {
		const { api } = fakeApi([view(1, { name: "Old" })]);
		renderWithApi(<LinksPage />, api);
		await userEvent.click(
			await screen.findByRole("button", { name: "Edit https://abc.com/p1" }),
		);
		const dialog = within(await screen.findByRole("dialog"));
		const name = dialog.getByRole("textbox", { name: "Display name" });
		await userEvent.clear(name);
		await userEvent.type(name, "Pricing");
		const codes = dialog.getByRole("textbox", { name: /Expected HTTP codes/ });
		await userEvent.clear(codes);
		await userEvent.type(codes, "200-299, 404");
		await userEvent.click(dialog.getByRole("button", { name: "Save changes" }));
		await waitFor(() =>
			expect(api.updateLink).toHaveBeenCalledWith("L001", {
				name: "Pricing",
				expectedCodes: [
					{ from: 200, to: 299 },
					{ from: 404, to: 404 },
				],
			}),
		);
		expect(await screen.findByText("Pricing")).toBeTruthy();
	});

	it("FR-13: choose an own schedule for the link", async () => {
		const { api } = fakeApi([view(1)]);
		renderWithApi(<LinksPage />, api);
		await userEvent.click(
			await screen.findByRole("button", { name: "Edit https://abc.com/p1" }),
		);
		const dialog = within(await screen.findByRole("dialog"));
		await userEvent.click(
			dialog.getAllByLabelText(/^Schedule/)[0] as HTMLElement,
		);
		await userEvent.click(
			await screen.findByRole("option", { name: "Quarter — Every 15 minutes" }),
		);
		await userEvent.click(dialog.getByRole("button", { name: "Save changes" }));
		await waitFor(() =>
			expect(api.updateLink).toHaveBeenCalledWith("L001", {
				scheduleId: "S15",
			}),
		);
	});

	it("FR-01: invalid codes or timeout are refused before calling the API", async () => {
		const { api } = fakeApi([view(1)]);
		renderWithApi(<LinksPage />, api);
		await userEvent.click(
			await screen.findByRole("button", { name: "Edit https://abc.com/p1" }),
		);
		const dialog = within(await screen.findByRole("dialog"));
		const codes = dialog.getByRole("textbox", { name: /Expected HTTP codes/ });
		await userEvent.clear(codes);
		await userEvent.type(codes, "2xx");
		await userEvent.click(dialog.getByRole("button", { name: "Save changes" }));
		expect(await dialog.findByText(/Enter codes or ranges/)).toBeTruthy();
		expect(api.updateLink).not.toHaveBeenCalled();
	});

	it("FR-02: a URL already monitored → error under the URL field", async () => {
		const { api } = fakeApi([view(1)]);
		api.updateLink.mockRejectedValue(new ApiError(409, { error: "duplicate" }));
		renderWithApi(<LinksPage />, api);
		await userEvent.click(
			await screen.findByRole("button", { name: "Edit https://abc.com/p1" }),
		);
		const dialog = within(await screen.findByRole("dialog"));
		const url = dialog.getByRole("textbox", { name: /URL/ });
		await userEvent.clear(url);
		await userEvent.type(url, "https://abc.com/other");
		expect(dialog.getByText(/starts again as Pending/)).toBeTruthy();
		await userEvent.click(dialog.getByRole("button", { name: "Save changes" }));
		expect(await dialog.findByText(/already/i)).toBeTruthy();
	});
});

describe("LinksPage — filters, export, fresh rows", () => {
	it("FR-06: filter by domain (tags: see filter.test.ts)", async () => {
		renderWithApi(<LinksPage />, fakeApi([view(1), view(2), view(3)]).api);
		await screen.findByText("https://abc.com/p1");
		// Mantine Select also renders a hidden input with the same label.
		const [domain] = within(screen.getByRole("search")).getAllByLabelText(
			"Domain",
		);
		await userEvent.click(domain as HTMLElement);
		await userEvent.click(
			await screen.findByRole("option", { name: "xyz.vn" }),
		);
		await waitFor(() => expect(dataRows()).toEqual(["https://xyz.vn/p2"]));
	});

	it("FR-05: Export CSV downloads the file from the API", async () => {
		const { api } = fakeApi([view(1)]);
		const createObjectURL = vi.fn(() => "blob:x");
		Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
		const click = vi
			.spyOn(HTMLAnchorElement.prototype, "click")
			.mockImplementation(() => {});
		renderWithApi(<LinksPage />, api);
		await screen.findByText("https://abc.com/p1");
		await userEvent.click(screen.getByRole("button", { name: "Export CSV" }));
		await waitFor(() => expect(api.exportCsv).toHaveBeenCalled());
		await waitFor(() => expect(click).toHaveBeenCalled());
		click.mockRestore();
	});

	it("step 19b: a pending link is re-read by key and its new result replaces the snapshot row", async () => {
		const fake = fakeApi([view(1, { status: "pending" })]);
		renderWithApi(<LinksPage />, fake.api);
		await screen.findByText("https://abc.com/p1");
		await waitFor(() =>
			expect(fake.api.freshLinks).toHaveBeenCalledWith([
				{ domain: "abc.com", id: "L001" },
			]),
		);
		expect(
			screen.getByText(
				"Refreshing every 30 seconds while links wait for a check result.",
			),
		).toBeTruthy();
	});
});

describe("LinksPage roles — HLR-09", () => {
	it("HLR-09: a viewer sees the links but no add, import, select, edit or delete", async () => {
		const { api } = fakeApi([view(1), view(2)]);
		renderWithApi(
			<LinksPage />,
			api,
			signedInAuth({ user: { email: "v@abc.com", role: "viewer" } }),
		);
		expect(await screen.findByText("https://abc.com/p1")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Add link" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Import" })).toBeNull();
		expect(screen.queryByRole("checkbox", { name: /^Select/ })).toBeNull();
		expect(screen.queryByRole("button", { name: /^Edit/ })).toBeNull();
		expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
		// Export is a read.
		expect(screen.getByRole("button", { name: "Export CSV" })).toBeTruthy();
	});

	it("HLR-09: an editor can add, import, select and edit", async () => {
		const { api } = fakeApi([view(1)]);
		renderWithApi(
			<LinksPage />,
			api,
			signedInAuth({ user: { email: "e@abc.com", role: "editor" } }),
		);
		expect(await screen.findByText("https://abc.com/p1")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Import" })).toBeTruthy();
		expect(
			screen.getByRole("checkbox", { name: "Select all links on this page" }),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
	});
});
