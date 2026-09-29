import { API_KEY_HEADER } from "@linkwatch/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, createApi } from "./api";

const fetchMock = vi.fn();
const json = (status: number, body: unknown) =>
	new Response(status === 204 ? null : JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

beforeEach(() => fetchMock.mockReset());
afterEach(() => vi.restoreAllMocks());

const api = (key: string | null = "k", base = "") =>
	createApi({
		baseUrl: base,
		getApiKey: () => key,
		fetch: fetchMock as unknown as typeof fetch,
	});

describe("createApi", () => {
	it("gắn header khóa API tạm và gọi /api cùng origin khi không đặt base URL", async () => {
		fetchMock.mockResolvedValue(json(200, { items: [], cursor: null }));
		await api().listLinks();
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("/api/links?limit=100");
		expect(new Headers(init.headers).get(API_KEY_HEADER)).toBe("k");
	});

	it("dùng base URL (chạy local: web :3000 → API :8787)", async () => {
		fetchMock.mockResolvedValue(json(200, { items: [], cursor: null }));
		await api("k", "http://localhost:8787").listLinks({ cursor: "abc=" });
		expect(fetchMock.mock.calls[0][0]).toBe(
			"http://localhost:8787/api/links?limit=100&cursor=abc%3D",
		);
	});

	it("FR-01: thêm link gửi JSON, trả link đã chuẩn hóa", async () => {
		fetchMock.mockResolvedValue(
			json(201, { id: "L1", url: "https://abc.com/" }),
		);
		const link = await api().createLink({ url: "https://ABC.com" });
		const [, init] = fetchMock.mock.calls[0];
		expect(init.method).toBe("POST");
		expect(JSON.parse(init.body)).toEqual({ url: "https://ABC.com" });
		expect(new Headers(init.headers).get("content-type")).toBe(
			"application/json",
		);
		expect(link.id).toBe("L1");
	});

	it("FR-04: xóa link → DELETE, 204 không có body", async () => {
		fetchMock.mockResolvedValue(json(204, null));
		await expect(api().deleteLink("L 1")).resolves.toBeUndefined();
		expect(fetchMock.mock.calls[0][0]).toBe("/api/links/L%201");
		expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
	});

	it("lỗi HTTP → ApiError có status và body (409 trùng, 401 sai khóa)", async () => {
		fetchMock.mockResolvedValue(
			json(409, { error: "duplicate", existingId: "L0" }),
		);
		const err = await api()
			.createLink({ url: "https://abc.com" })
			.catch((e) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect(err).toMatchObject({
			status: 409,
			body: { error: "duplicate", existingId: "L0" },
		});

		fetchMock.mockResolvedValue(json(401, { error: "unauthorized" }));
		expect(
			await api()
				.listLinks()
				.catch((e) => e.status),
		).toBe(401);
	});

	it("chưa nhập khóa thì không gửi header", async () => {
		fetchMock.mockResolvedValue(json(200, { items: [], cursor: null }));
		await api(null).listLinks();
		expect(
			new Headers(fetchMock.mock.calls[0][1].headers).has(API_KEY_HEADER),
		).toBe(false);
	});
});
