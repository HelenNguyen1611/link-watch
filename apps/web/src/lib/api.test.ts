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

const onUnauthorized = vi.fn();
beforeEach(() => onUnauthorized.mockReset());

const api = (token: string | null = "k", base = "") =>
	createApi({
		baseUrl: base,
		getToken: async () => token,
		onUnauthorized,
		fetch: fetchMock as unknown as typeof fetch,
	});

describe("createApi", () => {
	it("FR-28: sends the Cognito ID token as a Bearer token and calls same-origin /api when no base URL is set", async () => {
		fetchMock.mockResolvedValue(json(200, { items: [], cursor: null }));
		await api().listLinks();
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("/api/links?limit=100");
		expect(new Headers(init.headers).get("authorization")).toBe("Bearer k");
	});

	it("uses the base URL (local: web :3000 → API :8787)", async () => {
		fetchMock.mockResolvedValue(json(200, { items: [], cursor: null }));
		await api("k", "http://localhost:8787").listLinks({ cursor: "abc=" });
		expect(fetchMock.mock.calls[0][0]).toBe(
			"http://localhost:8787/api/links?limit=100&cursor=abc%3D",
		);
	});

	it("FR-01: adding a link sends JSON and returns the normalised link", async () => {
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

	it("FR-04: deleting a link → DELETE, 204 without body", async () => {
		fetchMock.mockResolvedValue(json(204, null));
		await expect(api().deleteLink("L 1")).resolves.toBeUndefined();
		expect(fetchMock.mock.calls[0][0]).toBe("/api/links/L%201");
		expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
	});

	it("HTTP errors → ApiError with status and body (409 duplicate, 401 expired session)", async () => {
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

	it("FR-28: 401 → signs out (onUnauthorized), other errors do not", async () => {
		fetchMock.mockResolvedValue(json(409, { error: "duplicate" }));
		await api()
			.createLink({ url: "https://abc.com" })
			.catch(() => {});
		expect(onUnauthorized).not.toHaveBeenCalled();
		fetchMock.mockResolvedValue(json(401, { message: "Unauthorized" }));
		await api()
			.listLinks()
			.catch(() => {});
		expect(onUnauthorized).toHaveBeenCalledTimes(1);
	});

	it("sends no Authorization header when signed out", async () => {
		fetchMock.mockResolvedValue(json(200, { items: [], cursor: null }));
		await api(null).listLinks();
		expect(
			new Headers(fetchMock.mock.calls[0][1].headers).has("authorization"),
		).toBe(false);
	});

	it("FR-26: settings — GET, PATCH with a JSON body, test email with an optional recipient", async () => {
		fetchMock.mockImplementation(async () => json(200, { ok: true }));
		await api().getSettings();
		await api().updateSettings({ reminderIntervalHours: 6 });
		await api().sendTestEmail();
		await api().sendTestEmail("x@abc.com");
		const calls = fetchMock.mock.calls.map(([url, init]) => [
			url,
			init.method ?? "GET",
			init.body ?? null,
		]);
		expect(calls).toEqual([
			["/api/settings", "GET", null],
			["/api/settings", "PATCH", '{"reminderIntervalHours":6}'],
			["/api/settings/test-email", "POST", "{}"],
			["/api/settings/test-email", "POST", '{"to":"x@abc.com"}'],
		]);
	});

	it("FR-26: a SES failure (502) surfaces as ApiError with the SES error", async () => {
		fetchMock.mockResolvedValue(
			json(502, {
				status: "failed",
				to: "x@abc.com",
				error: "MessageRejected: not verified",
			}),
		);
		const err = await api()
			.sendTestEmail("x@abc.com")
			.catch((e) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect(err.status).toBe(502);
		expect(err.body.error).toBe("MessageRejected: not verified");
	});
});
