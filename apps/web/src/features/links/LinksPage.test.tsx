import type { LinkInputRaw, LinkView } from "@linkwatch/core";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { type Api, ApiError } from "@/lib/api";
import { renderWithApi } from "@/test/render";
import { LinksPage } from "./LinksPage";

const view = (over: Partial<LinkView>): LinkView => ({
	id: "L1",
	domain: "abc.com",
	url: "https://abc.com/",
	tags: [],
	method: "GET",
	expectedCodes: [{ from: 200, to: 399 }],
	timeoutS: 30,
	status: "pending",
	paused: false,
	createdAt: "2026-09-29T10:00:00.000Z",
	...over,
});

/** API giả giữ danh sách trong bộ nhớ. */
function fakeApi(initial: LinkView[] = []) {
	let links = [...initial];
	const api = {
		listLinks: vi.fn(async () => ({ items: links, cursor: null })),
		createLink: vi.fn(async (input: LinkInputRaw) => {
			if (links.some((l) => l.url === input.url)) {
				throw new ApiError(409, { error: "duplicate", existingId: "L0" });
			}
			const created = view({
				id: `N${links.length}`,
				url: input.url,
				name: input.name ?? undefined,
			});
			links = [...links, created];
			return created;
		}),
		deleteLink: vi.fn(async (id: string) => {
			links = links.filter((l) => l.id !== id);
		}),
	} satisfies Api;
	return api;
}

describe("LinksPage", () => {
	it("hiển thị 4 trạng thái Hoạt động / Chậm / Link chết / Site down kèm mã HTTP và thời gian phản hồi", async () => {
		renderWithApi(
			<LinksPage />,
			fakeApi([
				view({
					id: "a",
					url: "https://a.vn/",
					status: "up",
					lastHttpCode: 200,
					lastResponseMs: 120,
					lastCheckedAt: "2026-09-29T23:01:00.000Z",
				}),
				view({
					id: "b",
					url: "https://b.vn/",
					status: "slow",
					lastHttpCode: 200,
					lastResponseMs: 7200,
				}),
				view({
					id: "c",
					url: "https://c.vn/",
					status: "dead",
					lastHttpCode: 404,
					lastErrorType: "http_4xx",
				}),
				view({
					id: "d",
					url: "https://d.vn/",
					status: "down",
					lastErrorType: "dns",
				}),
				view({ id: "e", url: "https://e.vn/", status: "pending" }),
			]),
		);
		const row = async (url: string) =>
			within((await screen.findByText(url)).closest("tr") as HTMLElement);
		expect((await row("https://a.vn/")).getByText("Hoạt động")).toBeTruthy();
		expect((await row("https://a.vn/")).getByText("120 ms")).toBeTruthy();
		expect(
			(await row("https://a.vn/")).getByText("30/09/2026 06:01"),
		).toBeTruthy();
		expect((await row("https://b.vn/")).getByText("Chậm")).toBeTruthy();
		expect((await row("https://b.vn/")).getByText("7.200 ms")).toBeTruthy();
		expect((await row("https://c.vn/")).getByText("Link chết")).toBeTruthy();
		expect((await row("https://c.vn/")).getByText("404")).toBeTruthy();
		expect((await row("https://d.vn/")).getByText("Site down")).toBeTruthy();
		expect((await row("https://d.vn/")).getByText("Lỗi DNS")).toBeTruthy();
		expect((await row("https://e.vn/")).getByText("Chờ kiểm tra")).toBeTruthy();
	});

	it("FR-01: URL sai → báo lỗi dưới ô URL, không gọi API", async () => {
		const api = fakeApi();
		renderWithApi(<LinksPage />, api);
		await userEvent.type(await screen.findByLabelText(/URL/), "ftp://abc.com");
		await userEvent.click(screen.getByRole("button", { name: "Thêm" }));
		expect(
			await screen.findByText("Chỉ hỗ trợ http:// và https://"),
		).toBeTruthy();
		expect(api.createLink).not.toHaveBeenCalled();
	});

	it("FR-01, FR-02: thêm link → gọi API với URL đã chuẩn hóa, link hiện ngay trong bảng, ô nhập được xóa", async () => {
		const api = fakeApi();
		renderWithApi(<LinksPage />, api);
		const input = await screen.findByLabelText(/URL/);
		await userEvent.type(input, "  HTTPS://Moi.ABC.com/x#top ");
		await userEvent.type(screen.getByLabelText(/Tên hiển thị/), "Trang mới");
		await userEvent.click(screen.getByRole("button", { name: "Thêm" }));
		await waitFor(() => expect(api.createLink).toHaveBeenCalledTimes(1));
		expect(api.createLink.mock.calls[0][0]).toMatchObject({
			url: "https://moi.abc.com/x",
			name: "Trang mới",
		});
		expect(await screen.findByText("https://moi.abc.com/x")).toBeTruthy();
		expect((input as HTMLInputElement).value).toBe("");
	});

	it("FR-02: trùng URL (409) → báo link đã có", async () => {
		const api = fakeApi([view({ url: "https://abc.com/" })]);
		renderWithApi(<LinksPage />, api);
		await userEvent.type(
			await screen.findByLabelText(/URL/),
			"https://abc.com",
		);
		await userEvent.click(screen.getByRole("button", { name: "Thêm" }));
		expect(
			await screen.findByText("Link này đã có trong danh sách"),
		).toBeTruthy();
	});

	it("FR-04: xóa cần bấm xác nhận lần 2, sau đó link biến mất", async () => {
		const api = fakeApi([view({ id: "x", url: "https://xoa.vn/" })]);
		renderWithApi(<LinksPage />, api);
		const row = within(
			(await screen.findByText("https://xoa.vn/")).closest("tr") as HTMLElement,
		);
		await userEvent.click(row.getByRole("button", { name: "Xóa" }));
		expect(api.deleteLink).not.toHaveBeenCalled();
		await userEvent.click(row.getByRole("button", { name: "Xác nhận xóa" }));
		await waitFor(() => expect(api.deleteLink).toHaveBeenCalledWith("x"));
		await waitFor(() =>
			expect(screen.queryByText("https://xoa.vn/")).toBeNull(),
		);
	});

	it("danh sách trống → hướng dẫn thêm link đầu tiên", async () => {
		renderWithApi(<LinksPage />, fakeApi());
		expect(
			await screen.findByText("Chưa có link nào. Thêm link đầu tiên ở trên."),
		).toBeTruthy();
	});

	it("khóa API sai (401) → yêu cầu nhập lại khóa", async () => {
		const api = fakeApi();
		api.listLinks.mockRejectedValue(
			new ApiError(401, { error: "unauthorized" }),
		);
		const onInvalid = vi.fn();
		window.addEventListener("linkwatch:api-key-invalid", onInvalid);
		renderWithApi(<LinksPage />, api);
		await waitFor(() => expect(onInvalid).toHaveBeenCalled());
		window.removeEventListener("linkwatch:api-key-invalid", onInvalid);
	});
});
