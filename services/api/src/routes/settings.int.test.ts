import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { createTestDb, type TestDb } from "@linkwatch/core/db/testing";
import { createLink } from "@linkwatch/core/usecases";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";

const sesMock = mockClient(SESv2Client);
let t: TestDb;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
	t = await createTestDb();
	app = createApp({
		db: t.db,
		auth: { kind: "local", user: { sub: "u1", email: "helen@wootech.co" } },
		email: {
			ses: new SESv2Client({}),
			defaults: {
				sesIdentity: "watch.hueai.net",
				senderEmail: "noreply@watch.hueai.net",
				defaultAdminEmail: "helen@wootech.co",
			},
			sleep: async () => {},
		},
	});
});
afterAll(() => t?.drop());
beforeEach(() => {
	sesMock.reset();
	sesMock.on(SendEmailCommand).resolves({ MessageId: "ses-1" });
});

const call = (path: string, init: RequestInit = {}) =>
	app.request(path, {
		...init,
		headers: {
			authorization: "Bearer test",
			"content-type": "application/json",
			...(init.headers ?? {}),
		},
	});
const post = (path: string, body: unknown) =>
	call(path, { method: "POST", body: JSON.stringify(body) });

describe("Recipients API — FR-20", () => {
	it("FR-20: add, list and remove domain recipients", async () => {
		const link = await createLink(t.db, { url: "https://abc.com/a" });
		expect(link.domain).toBe("abc.com");

		const created = await post("/api/recipients", {
			scope: "DOMAIN",
			target: "abc.com",
			email: " Lan@ABC.com ",
			name: "Lan",
		});
		expect(created.status).toBe(201);
		expect(await created.json()).toEqual({
			scope: "DOMAIN",
			target: "abc.com",
			email: "lan@abc.com",
			name: "Lan",
		});
		await post("/api/recipients", {
			scope: "DOMAIN",
			target: "abc.com",
			email: "an@abc.com",
		});

		const list = await call("/api/recipients?scope=DOMAIN&target=abc.com");
		expect(
			(await list.json()).items.map((r: { email: string }) => r.email),
		).toEqual(["an@abc.com", "lan@abc.com"]);

		const del = await call(
			"/api/recipients?scope=DOMAIN&target=abc.com&email=an@abc.com",
			{ method: "DELETE" },
		);
		expect(del.status).toBe(204);
		const after = await call("/api/recipients?scope=DOMAIN&target=abc.com");
		expect((await after.json()).items).toHaveLength(1);
	});

	it("FR-20: link recipients", async () => {
		const link = await createLink(t.db, { url: "https://abc.com/b" });
		const res = await post("/api/recipients", {
			scope: "LINK",
			target: link.id,
			email: "dev@abc.com",
		});
		expect(res.status).toBe(201);
		const list = await call(`/api/recipients?scope=LINK&target=${link.id}`);
		expect((await list.json()).items).toEqual([
			{ scope: "LINK", target: link.id, email: "dev@abc.com" },
		]);
	});

	it("FR-20: duplicate recipient → 409; unknown domain or link → 404; bad email → 400", async () => {
		const dup = await post("/api/recipients", {
			scope: "DOMAIN",
			target: "abc.com",
			email: "LAN@abc.com",
		});
		expect(dup.status).toBe(409);
		expect(
			(
				await post("/api/recipients", {
					scope: "DOMAIN",
					target: "nope.vn",
					email: "a@nope.vn",
				})
			).status,
		).toBe(404);
		expect(
			(
				await post("/api/recipients", {
					scope: "LINK",
					target: "NO-SUCH-LINK",
					email: "a@b.co",
				})
			).status,
		).toBe(404);
		const bad = await post("/api/recipients", {
			scope: "DOMAIN",
			target: "abc.com",
			email: "not-an-email",
		});
		expect(bad.status).toBe(400);
	});
});

describe("Settings API — FR-20, FR-23, FR-26", () => {
	it("FR-26: before saving, returns the deployment defaults", async () => {
		const res = await call("/api/settings");
		expect(await res.json()).toEqual({
			senderEmail: "noreply@watch.hueai.net",
			senderName: "LinkWatch",
			defaultAdminEmail: "helen@wootech.co",
			alertEmails: [],
			remindersEnabled: true,
			reminderIntervalHours: 24,
			sesIdentity: "watch.hueai.net",
		});
	});

	it("FR-20 / FR-23: saves the admin email and reminder settings", async () => {
		const res = await call("/api/settings", {
			method: "PATCH",
			body: JSON.stringify({
				defaultAdminEmail: "Ops@ABC.com",
				reminderIntervalHours: 12,
			}),
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			defaultAdminEmail: "ops@abc.com",
			reminderIntervalHours: 12,
			remindersEnabled: true,
		});
		await call("/api/settings", {
			method: "PATCH",
			body: JSON.stringify({ remindersEnabled: false, senderName: "Ops" }),
		});
		expect(await (await call("/api/settings")).json()).toMatchObject({
			defaultAdminEmail: "ops@abc.com",
			reminderIntervalHours: 12,
			remindersEnabled: false,
			senderName: "Ops",
		});
	});

	it("FR-26: a sender outside the verified SES identity is rejected", async () => {
		const res = await call("/api/settings", {
			method: "PATCH",
			body: JSON.stringify({ senderEmail: "alerts@gmail.com" }),
		});
		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe("sender_not_verified");
		const ok = await call("/api/settings", {
			method: "PATCH",
			body: JSON.stringify({ senderEmail: "alerts@watch.hueai.net" }),
		});
		expect((await ok.json()).senderEmail).toBe("alerts@watch.hueai.net");
	});

	it("FR-26: test email goes to the signed-in user through SES from the configured sender", async () => {
		const res = await call("/api/settings/test-email", { method: "POST" });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			status: "sent",
			to: "helen@wootech.co",
		});
		const input = sesMock.commandCalls(SendEmailCommand)[0]?.args[0].input;
		expect(input?.FromEmailAddress).toBe('"Ops" <alerts@watch.hueai.net>');
		expect(input?.Destination?.ToAddresses).toEqual(["helen@wootech.co"]);
		expect(input?.Content?.Simple?.Subject?.Data).toBe(
			"[LinkWatch] Test email",
		);
	});

	it("FR-26: test email to another address; SES rejecting it → 502 with the error", async () => {
		sesMock.on(SendEmailCommand).rejects(
			Object.assign(new Error("Email address is not verified."), {
				name: "MessageRejected",
			}),
		);
		const res = await post("/api/settings/test-email", { to: "x@abc.com" });
		expect(res.status).toBe(502);
		expect(await res.json()).toMatchObject({
			status: "failed",
			to: "x@abc.com",
			error: "MessageRejected: Email address is not verified.",
		});
		expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(1);
	});
});
