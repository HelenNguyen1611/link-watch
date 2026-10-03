import type { SESv2Client } from "@aws-sdk/client-sesv2";
import type { Db } from "@linkwatch/core/db";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { requiredAction } from "./authorize";

describe("requiredAction — HLR-09, SRS 3.3", () => {
	it("HLR-09: reads need only 'view', including the fresh-rows POST", () => {
		expect(requiredAction("GET", "/api/links")).toBe("view");
		expect(requiredAction("GET", "/api/incidents/abc")).toBe("view");
		expect(requiredAction("POST", "/api/links/fresh")).toBe("view");
	});

	it("HLR-09: link, domain, recipient and schedule template writes need 'edit'", () => {
		expect(requiredAction("POST", "/api/links")).toBe("edit");
		expect(requiredAction("PATCH", "/api/links/l1")).toBe("edit");
		expect(requiredAction("POST", "/api/links/bulk")).toBe("edit");
		expect(requiredAction("POST", "/api/links/import")).toBe("edit");
		expect(requiredAction("PATCH", "/api/domains/abc.com")).toBe("edit");
		expect(requiredAction("POST", "/api/recipients")).toBe("edit");
		expect(requiredAction("DELETE", "/api/recipients")).toBe("edit");
		expect(requiredAction("POST", "/api/schedules")).toBe("edit");
		expect(requiredAction("PATCH", "/api/schedules/every-15")).toBe("edit");
		expect(requiredAction("DELETE", "/api/schedules/every-15")).toBe("edit");
	});

	it("FR-19 / FR-41 / FR-16: acknowledge, resolve-claim and Check now need 'handle_incidents'", () => {
		expect(requiredAction("POST", "/api/incidents/l1%402026/ack")).toBe(
			"handle_incidents",
		);
		expect(requiredAction("POST", "/api/incidents/resolve-claim")).toBe(
			"handle_incidents",
		);
		expect(requiredAction("POST", "/api/links/check-now")).toBe(
			"handle_incidents",
		);
	});

	it("FR-11 / FR-26: the default schedule and email settings need 'configure'", () => {
		expect(requiredAction("PATCH", "/api/schedules/default")).toBe("configure");
		expect(requiredAction("PATCH", "/api/settings")).toBe("configure");
		expect(requiredAction("POST", "/api/settings/test-email")).toBe(
			"configure",
		);
		expect(requiredAction("GET", "/api/settings")).toBe("view");
	});

	it("FR-29: every /api/users route needs 'manage_users', even GET", () => {
		expect(requiredAction("GET", "/api/users")).toBe("manage_users");
		expect(requiredAction("DELETE", "/api/users/a%40b.co")).toBe(
			"manage_users",
		);
	});

	it("HLR-09: an unknown write defaults to 'edit' (never open to viewers)", () => {
		expect(requiredAction("POST", "/api/something-new")).toBe("edit");
	});
});

const email = {
	ses: {} as SESv2Client,
	defaults: {
		sesIdentity: "watch.hueai.net",
		senderEmail: "noreply@watch.hueai.net",
	},
};
const signedIn = (groups?: string) => ({
	event: {
		requestContext: {
			authorizer: {
				jwt: {
					claims: {
						sub: "s1",
						email: "u@abc.com",
						token_use: "id",
						...(groups !== undefined && { "cognito:groups": groups }),
					},
				},
			},
		},
	},
});
const call = async (method: string, path: string, groups?: string) => {
	const app = createApp({ db: {} as Db, auth: { kind: "apiGateway" }, email });
	return app.request(
		path,
		{
			method,
			headers: { "content-type": "application/json" },
			body: method === "GET" ? undefined : "{}",
		},
		signedIn(groups),
	);
};

describe("API authorization — HLR-09", () => {
	it("HLR-09: a user without a group is a viewer → 403 on writes", async () => {
		const res = await call("POST", "/api/links");
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: "forbidden", required: "edit" });
	});

	it("HLR-09: a viewer cannot acknowledge or run Check now", async () => {
		expect(
			(await call("POST", "/api/links/check-now", "[viewer]")).status,
		).toBe(403);
		expect(
			(await call("POST", "/api/incidents/x/ack", "[viewer]")).status,
		).toBe(403);
	});

	it("HLR-09: an editor cannot change email settings, the default schedule or users", async () => {
		expect((await call("PATCH", "/api/settings", "[editor]")).status).toBe(403);
		expect(
			(await call("PATCH", "/api/schedules/default", "[editor]")).status,
		).toBe(403);
		expect((await call("GET", "/api/users", "[editor]")).status).toBe(403);
	});

	it("HLR-09: allowed requests pass the role check (reach the route)", async () => {
		// db is a stub, so a request that passes authorization fails later with 500, not 403.
		expect((await call("POST", "/api/links", "[editor]")).status).not.toBe(403);
		expect(
			(await call("PATCH", "/api/schedules/default", "[admin]")).status,
		).not.toBe(403);
	});
});
