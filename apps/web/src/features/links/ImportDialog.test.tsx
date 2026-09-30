import type { LinkView } from "@linkwatch/core";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { type Api, ApiError, type ImportCommitView } from "@/lib/api";
import { renderWithApi } from "@/test/render";
import { stubApi } from "@/test/stub-api";
import { LinksPage } from "./LinksPage";

const row = (id: string, url: string, domain: string): LinkView => ({
	id,
	domain,
	url,
	tags: [],
	method: "GET",
	expectedCodes: [{ from: 200, to: 399 }],
	timeoutS: 30,
	status: "pending",
	paused: false,
	createdAt: "2026-09-30T00:00:00.000Z",
});

function fakeApi() {
	const created: LinkView[] = [];
	const api = {
		...stubApi(),
		getSnapshot: vi.fn(async () => ({
			generatedAt: "2026-09-29T00:00:00.000Z",
			items: [row("OLD", "https://old.vn/", "old.vn")],
			stored: true,
		})),
		freshLinks: vi.fn(async (keys: { id: string }[]) => ({
			items: created.filter((c) => keys.some((k) => k.id === c.id)),
		})),
		previewImport: vi.fn(async () => ({
			rows: [
				{ line: 2, url: "https://a.abc.com/x", status: "valid" as const },
				{
					line: 3,
					url: "https://old.vn/",
					status: "duplicate" as const,
					error: "duplicate_existing" as const,
				},
				{
					line: 4,
					url: "ftp://x",
					status: "error" as const,
					error: "invalid_url" as const,
				},
			],
			summary: { valid: 1, duplicate: 1, error: 1 },
		})),
		commitImport: vi.fn(async (text: string): Promise<ImportCommitView> => {
			const urls = text.split("\n").filter((l) => l.startsWith("https://a"));
			const out = urls.map((url, i) => {
				const r = row(`N${created.length + i}`, url, "abc.com");
				return r;
			});
			created.push(...out);
			return {
				created: out.map((r, i) => ({
					line: i + 1,
					id: r.id,
					url: r.url,
					domain: r.domain,
				})),
				rejected: [],
			};
		}),
	} satisfies Api;
	return api;
}

async function openImport() {
	await screen.findByText("https://old.vn/");
	await userEvent.click(screen.getByRole("button", { name: "Import" }));
	return within(await screen.findByRole("dialog"));
}

describe("ImportDialog — FR-03, AC-01", () => {
	it("FR-03: preview shows each row as valid / duplicate / error with a summary", async () => {
		const api = fakeApi();
		renderWithApi(<LinksPage />, api);
		const dialog = await openImport();
		fireEvent.change(dialog.getByRole("textbox", { name: "Links or CSV" }), {
			target: { value: "url\nhttps://a.abc.com/x\nhttps://old.vn/\nftp://x" },
		});
		await userEvent.click(dialog.getByRole("button", { name: "Preview" }));
		expect(await dialog.findByText("1 valid")).toBeTruthy();
		expect(dialog.getByText("1 duplicate")).toBeTruthy();
		expect(dialog.getByText("1 with errors")).toBeTruthy();
		const table = within(dialog.getByRole("table", { name: "Import preview" }));
		expect(table.getByText("Already monitored")).toBeTruthy();
		expect(table.getByText("Invalid URL (http/https only)")).toBeTruthy();
		expect(dialog.getByRole("button", { name: "Import 1 links" })).toBeTruthy();
	});

	it("FR-03: 60 URLs are committed in 3 chunks of ≤ 25; the new links show in the table at once", async () => {
		const api = fakeApi();
		api.previewImport.mockResolvedValue({
			rows: Array.from({ length: 60 }, (_, i) => ({
				line: i + 1,
				url: `https://a.abc.com/${i}`,
				status: "valid" as const,
			})),
			summary: { valid: 60, duplicate: 0, error: 0 },
		});
		renderWithApi(<LinksPage />, api);
		const dialog = await openImport();
		fireEvent.change(dialog.getByRole("textbox", { name: "Links or CSV" }), {
			target: {
				value: Array.from(
					{ length: 60 },
					(_, i) => `https://a.abc.com/${i}`,
				).join("\n"),
			},
		});
		await userEvent.click(dialog.getByRole("button", { name: "Preview" }));
		await userEvent.click(
			await dialog.findByRole("button", { name: "Import 60 links" }),
		);
		await waitFor(() => expect(api.commitImport).toHaveBeenCalledTimes(3));
		expect(
			await dialog.findByText("60 links added, 0 rows skipped."),
		).toBeTruthy();
		await userEvent.click(dialog.getByRole("button", { name: "Close" }));
		expect(await screen.findByText("https://a.abc.com/0")).toBeTruthy();
	});

	it("FR-03: more than 1,000 rows → clear message", async () => {
		const api = fakeApi();
		api.previewImport.mockRejectedValue(
			new ApiError(400, { error: "import_too_large" }),
		);
		renderWithApi(<LinksPage />, api);
		const dialog = await openImport();
		fireEvent.change(dialog.getByRole("textbox", { name: "Links or CSV" }), {
			target: { value: "https://a.vn/" },
		});
		await userEvent.click(dialog.getByRole("button", { name: "Preview" }));
		expect(
			await dialog.findByText("Too many rows: at most 1000 per import."),
		).toBeTruthy();
	});
});
