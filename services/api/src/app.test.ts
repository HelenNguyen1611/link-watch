import { LinkInput } from "@linkwatch/core";
import type { Db } from "@linkwatch/core/db";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import type { AuthMode } from "./middleware/auth";

const gateway: AuthMode = { kind: "apiGateway" };

const app = (auth: AuthMode = gateway) => {
	const a = createApp({ db: {} as Db, auth });
	a.post("/_test/zod", async (c) =>
		c.json(LinkInput.parse(await c.req.json())),
	);
	a.get("/_test/boom", () => {
		throw new Error("internal detail");
	});
	a.get("/_test/me", (c) => c.json(c.get("user")));
	a.get("/public/_test", (c) => c.text("public"));
	return a;
};

/** Lambda env as hono/aws-lambda passes it: the API Gateway v2 event. */
const lambdaEnv = (claims?: Record<string, unknown>) => ({
	event: {
		requestContext: claims ? { authorizer: { jwt: { claims } } } : {},
	},
});
const ID_CLAIMS = {
	sub: "c0ffee",
	email: "admin@abc.com",
	token_use: "id",
};
const signedIn = lambdaEnv(ID_CLAIMS);
const json = (body: string) => ({
	method: "POST",
	headers: { "content-type": "application/json" },
	body,
});

describe("API auth — FR-28, NFR-07", () => {
	it("GET /api/health needs no sign-in", async () => {
		const res = await app().request("/api/health", {}, lambdaEnv());
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});

	it("FR-28: /api/public/* needs no sign-in (email token links)", async () => {
		const res = await app().request("/api/public/_test", {}, lambdaEnv());
		expect(res.status).toBe(200);
	});

	it("NFR-07: no JWT claims → 401", async () => {
		const res = await app().request("/api/_test/me", {}, lambdaEnv());
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: "unauthorized" });
	});

	it("NFR-07: an access token (not an ID token) or claims without email → 401", async () => {
		expect(
			(
				await app().request(
					"/api/_test/me",
					{},
					lambdaEnv({ ...ID_CLAIMS, token_use: "access" }),
				)
			).status,
		).toBe(401);
		expect(
			(
				await app().request(
					"/api/_test/me",
					{},
					lambdaEnv({ sub: "x", token_use: "id" }),
				)
			).status,
		).toBe(401);
	});

	it("FR-28: Cognito claims → the user is available to routes", async () => {
		const res = await app().request("/api/_test/me", {}, signedIn);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ sub: "c0ffee", email: "admin@abc.com" });
	});

	it("NFR-07: the temporary x-linkwatch-key header no longer grants access", async () => {
		const res = await app().request(
			"/api/_test/me",
			{ headers: { "x-linkwatch-key": "anything" } },
			lambdaEnv(),
		);
		expect(res.status).toBe(401);
	});

	it("local mode: Bearer token required, signs in as the fake user", async () => {
		const local = app({
			kind: "local",
			user: { sub: "local-dev", email: "dev@localhost" },
		});
		expect((await local.request("/api/_test/me")).status).toBe(401);
		const res = await local.request("/api/_test/me", {
			headers: { authorization: "Bearer fake" },
		});
		expect(await res.json()).toEqual({
			sub: "local-dev",
			email: "dev@localhost",
		});
	});
});

describe("API errors", () => {
	it("FR-01: Zod error → 400 with per-field details", async () => {
		const res = await app().request(
			"/api/_test/zod",
			json(JSON.stringify({ url: "ftp://abc.com" })),
			signedIn,
		);
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toBe("validation");
		expect(body.issues[0]).toMatchObject({
			path: ["url"],
			params: { code: "unsupported_scheme" },
		});
	});

	it("non-JSON body → 400", async () => {
		const res = await app().request(
			"/api/_test/zod",
			json("{not json"),
			signedIn,
		);
		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe("invalid_json");
	});

	it("unexpected error → 500 without leaking internal details", async () => {
		const res = await app().request("/api/_test/boom", {}, signedIn);
		expect(res.status).toBe(500);
		const text = await res.text();
		expect(text).not.toContain("internal detail");
		expect(JSON.parse(text)).toEqual({ error: "internal" });
	});

	it("unknown route → 404 JSON", async () => {
		const res = await app().request("/api/does-not-exist", {}, signedIn);
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "not_found" });
	});
});

describe("CORS (local development only)", () => {
	it("with corsOrigins: OPTIONS preflight passes without sign-in and allows the Authorization header", async () => {
		const a = createApp({
			db: {} as Db,
			auth: { kind: "local", user: { sub: "l", email: "l@l" } },
			corsOrigins: ["http://localhost:3000"],
		});
		const res = await a.request("/api/links", {
			method: "OPTIONS",
			headers: {
				origin: "http://localhost:3000",
				"access-control-request-method": "POST",
				"access-control-request-headers": "authorization,content-type",
			},
		});
		expect(res.status).toBe(204);
		expect(res.headers.get("access-control-allow-origin")).toBe(
			"http://localhost:3000",
		);
		expect(
			res.headers.get("access-control-allow-headers")?.toLowerCase(),
		).toContain("authorization");
	});

	it("by default (production, same origin via CloudFront) no CORS headers are sent", async () => {
		const res = await app().request(
			"/api/health",
			{ headers: { origin: "https://evil.example" } },
			lambdaEnv(),
		);
		expect(res.headers.get("access-control-allow-origin")).toBeNull();
	});
});
