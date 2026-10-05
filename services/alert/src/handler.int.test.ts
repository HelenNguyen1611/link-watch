import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { ClassifiedCheck } from "@linkwatch/core";
import { createTestDb, type TestDb } from "@linkwatch/core/db/testing";
import {
	createLink,
	deleteLink,
	recordCheck,
	recordTick,
} from "@linkwatch/core/usecases";
import type { DynamoDBRecord, DynamoDBStreamEvent, SQSEvent } from "aws-lambda";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHandler } from "./handler";

const sesMock = mockClient(SESv2Client);
const sqsMock = mockClient(SQSClient);

let t: TestDb;
beforeAll(async () => {
	t = await createTestDb();
	await t.db.Settings.put({ defaultAdminEmail: "admin@linkwatch.test" }).go();
});
afterAll(() => t?.drop());
beforeEach(() => {
	sesMock.reset();
	sqsMock.reset();
	sesMock.on(SendEmailCommand).resolves({ MessageId: "ses-id" });
	sqsMock.on(SendMessageCommand).resolves({ MessageId: "sqs-id" });
});

const QUEUE = "https://sqs.local/linkwatch-alert";
const T0 = Date.parse("2026-09-29T23:00:00.000Z"); // 06:00 Vietnam time
const at = (min: number) => new Date(T0 + min * 60_000);

const handlerAt = (now: Date) =>
	createHandler({
		db: t.db,
		ses: new SESv2Client({}),
		sqs: new SQSClient({}),
		alertQueueUrl: QUEUE,
		config: {
			appUrl: "https://watch.hueai.net",
			defaults: {
				sesIdentity: "watch.hueai.net",
				senderEmail: "noreply@watch.hueai.net",
			},
		},
		sleep: async () => {},
		now: () => now,
	});

const failing: ClassifiedCheck = {
	result: "dead",
	httpCode: 404,
	responseMs: 40,
	errorType: "http_4xx",
};
const ok: ClassifiedCheck = { result: "up", httpCode: 200, responseMs: 40 };

let jobSeq = 0;
/** Runs one check through the core use case, as the Checker does. */
async function check(
	link: { domain: string; id: string; url: string },
	result: ClassifiedCheck,
	now: Date,
) {
	const { data } = await t.db.Link.get({
		domain: link.domain,
		id: link.id,
	}).go();
	if (!data) throw new Error("link not found");
	await recordCheck(t.db, data, result, { now, jobId: `job-${++jobSeq}` });
}

/** Reads the incident item in DynamoDB JSON, as Streams delivers it. */
async function incidentImage(linkId: string, openedAt: string) {
	const r = await t.raw.send(
		new GetItemCommand({
			TableName: t.table,
			Key: { pk: { S: `LINK#${linkId}` }, sk: { S: `INC#${openedAt}` } },
		}),
	);
	if (!r.Item) throw new Error("incident not found");
	return r.Item as NonNullable<DynamoDBRecord["dynamodb"]>["NewImage"];
}

let seq = 0;
const streamRecord = (
	eventName: "INSERT" | "MODIFY",
	NewImage: unknown,
	OldImage?: unknown,
): DynamoDBRecord => ({
	eventName,
	eventSource: "aws:dynamodb",
	dynamodb: {
		SequenceNumber: String(++seq),
		NewImage: NewImage as never,
		...(OldImage ? { OldImage: OldImage as never } : {}),
	},
});

const streamEvent = (...records: DynamoDBRecord[]): DynamoDBStreamEvent => ({
	Records: records,
});

/** Delivers the delayed flush messages queued so far. */
async function deliverFlushes(now: Date) {
	const bodies = sqsMock
		.commandCalls(SendMessageCommand)
		.map((c) => c.args[0].input.MessageBody ?? "");
	sqsMock.resetHistory();
	const event = {
		Records: bodies.map((body, i) => ({
			messageId: `flush-${seq}-${i}`,
			body,
			eventSource: "aws:sqs",
		})),
	} as SQSEvent;
	return handlerAt(now)(event);
}

const emails = () =>
	sesMock.commandCalls(SendEmailCommand).map((c) => {
		const input = c.args[0].input;
		return {
			to: input.Destination?.ToAddresses ?? [],
			from: input.FromEmailAddress,
			subject: input.Content?.Simple?.Subject?.Data ?? "",
			text: input.Content?.Simple?.Body?.Text?.Data ?? "",
			html: input.Content?.Simple?.Body?.Html?.Data ?? "",
		};
	});

async function addLinks(domain: string, n: number, recipient?: string) {
	const links = [];
	for (let i = 0; i < n; i++)
		links.push(
			await createLink(
				t.db,
				{ url: `https://${domain}/page-${i}` },
				{ now: at(-60) },
			),
		);
	if (recipient)
		await t.db.Recipient.put({
			scope: "DOMAIN",
			target: domain,
			email: recipient,
		}).go();
	return links;
}

/** Two failing checks → incident opened; returns its stream INSERT record. */
async function openIncident(
	link: { domain: string; id: string; url: string },
	first: Date,
) {
	await check(link, failing, first);
	const second = new Date(first.getTime() + 2 * 60_000);
	await check(link, failing, second);
	return streamRecord(
		"INSERT",
		await incidentImage(link.id, second.toISOString()),
	);
}

describe("Alert — incident email (FR-20 → FR-22, FR-25)", () => {
	it("AC-04: 404 twice → exactly 1 email to the domain recipient within 5 minutes", async () => {
		const [link] = await addLinks("ac04.vn", 1, "owner@ac04.vn");
		if (!link) throw new Error();
		const insert = await openIncident(link, at(0));

		expect(
			(await handlerAt(at(2))(streamEvent(insert))).batchItemFailures,
		).toEqual([]);
		const queued = sqsMock.commandCalls(SendMessageCommand);
		expect(queued).toHaveLength(1);
		expect(queued[0]?.args[0].input).toMatchObject({
			QueueUrl: QUEUE,
			DelaySeconds: 300,
		});
		expect(emails()).toEqual([]);

		await deliverFlushes(at(7));
		const sent = emails();
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			to: ["owner@ac04.vn"],
			from: '"LinkWatch" <noreply@watch.hueai.net>',
			subject: "[LinkWatch][DOWN] ac04.vn — 1 broken link",
		});
		expect(sent[0]?.text).toContain(link.url);

		// FR-25: the email is logged.
		const openedAt = at(2).toISOString();
		const log = await t.db.Notification.query
			.byIncident({ incidentId: `${link.id}@${openedAt}` })
			.go();
		expect(log.data).toHaveLength(1);
		expect(log.data[0]).toMatchObject({
			to: "owner@ac04.vn",
			kind: "down",
			status: "sent",
			retries: 0,
			messageId: "ses-id",
		});
	});

	it("AC-06: 5 links of the same domain down together → 1 grouped email listing 5 links", async () => {
		const links = await addLinks("ac06.vn", 5, "owner@ac06.vn");
		const inserts = [];
		for (const [i, link] of links.entries())
			inserts.push(await openIncident(link, at(i * 0.5)));

		await handlerAt(at(3))(streamEvent(...inserts));
		expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);

		await deliverFlushes(at(8));
		const sent = emails();
		expect(sent).toHaveLength(1);
		expect(sent[0]?.subject).toBe("[LinkWatch][DOWN] ac06.vn — 5 broken links");
		for (const link of links) expect(sent[0]?.text).toContain(link.url);
	});

	it("FR-20: link recipients get only their link; the domain recipient gets both", async () => {
		const [a, b] = await addLinks("split.vn", 2, "owner@split.vn");
		if (!a || !b) throw new Error();
		await t.db.Recipient.put({
			scope: "LINK",
			target: a.id,
			email: "dev@split.vn",
		}).go();
		await handlerAt(at(3))(
			streamEvent(await openIncident(a, at(0)), await openIncident(b, at(0))),
		);
		await deliverFlushes(at(8));
		const byTo = Object.fromEntries(emails().map((e) => [e.to[0], e]));
		expect(Object.keys(byTo).sort()).toEqual([
			"dev@split.vn",
			"owner@split.vn",
		]);
		expect(byTo["dev@split.vn"]?.subject).toContain("1 broken link");
		expect(byTo["dev@split.vn"]?.text).toContain(a.url);
		expect(byTo["dev@split.vn"]?.text).not.toContain(b.url);
		expect(byTo["owner@split.vn"]?.subject).toContain("2 broken links");
	});

	it("FR-20: no recipients → the default admin email from Settings", async () => {
		const [link] = await addLinks("nobody.vn", 1);
		if (!link) throw new Error();
		await handlerAt(at(3))(streamEvent(await openIncident(link, at(0))));
		await deliverFlushes(at(8));
		expect(emails().map((e) => e.to)).toEqual([["admin@linkwatch.test"]]);
	});

	it("FR-20: alert users get the incident too, even when the domain has its own recipient", async () => {
		await t.db.Settings.patch({})
			.set({ alertEmails: ["ops@linkwatch.test"] })
			.go();
		try {
			const [owned] = await addLinks("alerts-owned.vn", 1, "owner@owned.vn");
			const [orphan] = await addLinks("alerts-orphan.vn", 1);
			if (!owned || !orphan) throw new Error();
			await handlerAt(at(3))(
				streamEvent(
					await openIncident(owned, at(0)),
					await openIncident(orphan, at(0)),
				),
			);
			await deliverFlushes(at(8));
			const to = emails()
				.map((e) => `${e.to[0]} ${e.subject}`)
				.sort();
			expect(to).toEqual([
				"admin@linkwatch.test [LinkWatch][DOWN] alerts-orphan.vn — 1 broken link",
				"ops@linkwatch.test [LinkWatch][DOWN] alerts-orphan.vn — 1 broken link",
				"ops@linkwatch.test [LinkWatch][DOWN] alerts-owned.vn — 1 broken link",
				"owner@owned.vn [LinkWatch][DOWN] alerts-owned.vn — 1 broken link",
			]);
		} finally {
			await t.db.Settings.patch({}).remove(["alertEmails"]).go();
		}
	});

	it("FR-25: SES failing → 3 retries, logged as failed", async () => {
		sesMock.on(SendEmailCommand).rejects(
			Object.assign(new Error("slow down"), {
				name: "TooManyRequestsException",
			}),
		);
		const [link] = await addLinks("retry.vn", 1, "owner@retry.vn");
		if (!link) throw new Error();
		await handlerAt(at(3))(streamEvent(await openIncident(link, at(0))));
		const res = await deliverFlushes(at(8));
		expect(res.batchItemFailures).toEqual([]);
		expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(4);
		const log = await t.db.Notification.query
			.byIncident({ incidentId: `${link.id}@${at(2).toISOString()}` })
			.go();
		expect(log.data[0]).toMatchObject({ status: "failed", retries: 3 });
	});

	it("PLAN Q3: a redelivered flush does not send the email twice", async () => {
		const [link] = await addLinks("redeliver.vn", 1, "owner@redeliver.vn");
		if (!link) throw new Error();
		await handlerAt(at(3))(streamEvent(await openIncident(link, at(0))));
		const body = sqsMock.commandCalls(SendMessageCommand)[0]?.args[0].input
			.MessageBody as string;
		const flush = {
			Records: [{ messageId: "dup", body, eventSource: "aws:sqs" }],
		} as SQSEvent;
		await handlerAt(at(8))(flush);
		await handlerAt(at(8))(flush);
		expect(emails()).toHaveLength(1);
	});
});

describe("Alert — Fixed — check again tokens (FR-33, FR-34)", () => {
	it("FR-33 / FR-34: each recipient gets its own tokens (per link + group); only hashes are stored", async () => {
		const links = await addLinks("tok.vn", 2, "owner@tok.vn");
		await t.db.Recipient.put({
			scope: "DOMAIN",
			target: "tok.vn",
			email: "dev@tok.vn",
		}).go();
		const inserts = [];
		for (const link of links) inserts.push(await openIncident(link, at(200)));
		await handlerAt(at(203))(streamEvent(...inserts));
		await deliverFlushes(at(208));
		const sent = emails();
		expect(sent.map((e) => e.to[0]).sort()).toEqual([
			"dev@tok.vn",
			"owner@tok.vn",
		]);
		const tokensOf = (html: string) =>
			[...html.matchAll(/confirm\/\?token=([A-Za-z0-9_-]+)/g)].map(
				(m) => m[1] as string,
			);
		const owner = tokensOf(
			sent.find((e) => e.to[0] === "owner@tok.vn")?.html ?? "",
		);
		const dev = tokensOf(
			sent.find((e) => e.to[0] === "dev@tok.vn")?.html ?? "",
		);
		// 2 link buttons + 1 group button each, all different.
		expect(new Set(owner).size).toBe(3);
		expect(owner.some((tok) => dev.includes(tok))).toBe(false);
		const { hashToken } = await import("@linkwatch/core/token");
		const records = await Promise.all(
			owner.map((tok) => t.db.Token.get({ tokenHash: hashToken(tok) }).go()),
		);
		expect(records.map((r) => r.data?.recipientEmail)).toEqual([
			"owner@tok.vn",
			"owner@tok.vn",
			"owner@tok.vn",
		]);
		expect(records.map((r) => r.data?.incidentIds.length).sort()).toEqual([
			1, 1, 2,
		]);
		const raw = await t.db.Token.get({ tokenHash: owner[0] as string }).go();
		expect(raw.data).toBeNull(); // the raw token is never a key
	});
});

describe("Alert — recovery email (FR-21)", () => {
	it("AC-07: incident open, link back to 200 → recovery email with the downtime", async () => {
		const [link] = await addLinks("ac07.vn", 1, "owner@ac07.vn");
		if (!link) throw new Error();
		const insert = await openIncident(link, at(0));
		await handlerAt(at(2))(streamEvent(insert));
		await deliverFlushes(at(7));
		sesMock.resetHistory();

		const before = await incidentImage(link.id, at(2).toISOString());
		await check(link, ok, at(47));
		const after = await incidentImage(link.id, at(2).toISOString());
		await handlerAt(at(47))(streamEvent(streamRecord("MODIFY", after, before)));
		await deliverFlushes(at(52));

		const sent = emails();
		expect(sent).toHaveLength(1);
		expect(sent[0]?.subject).toBe(
			"[LinkWatch][RECOVERED] ac07.vn — 1 link back up",
		);
		expect(sent[0]?.text).toContain("Downtime: 45 min");
	});

	it("FR-04: deleting the link closes the incident without a recovery email", async () => {
		const [link] = await addLinks("deleted.vn", 1, "owner@deleted.vn");
		if (!link) throw new Error();
		const insert = await openIncident(link, at(0));
		await handlerAt(at(2))(streamEvent(insert));
		await deliverFlushes(at(7));
		sesMock.resetHistory();

		const before = await incidentImage(link.id, at(2).toISOString());
		await deleteLink(t.db, link.id, { now: at(30) });
		const after = await incidentImage(link.id, at(2).toISOString());
		await handlerAt(at(30))(streamEvent(streamRecord("MODIFY", after, before)));
		await deliverFlushes(at(35));
		expect(emails()).toEqual([]);
	});

	it("FR-21: no recovery email when the incident email was never sent", async () => {
		const [link] = await addLinks("quiet.vn", 1, "owner@quiet.vn");
		if (!link) throw new Error();
		const insert = await openIncident(link, at(0));
		await handlerAt(at(2))(streamEvent(insert));
		// Closed again before the 5-minute flush.
		const before = await incidentImage(link.id, at(2).toISOString());
		await check(link, ok, at(4));
		const after = await incidentImage(link.id, at(2).toISOString());
		await handlerAt(at(4))(streamEvent(streamRecord("MODIFY", after, before)));
		await deliverFlushes(at(9));
		expect(emails()).toEqual([]);
	});

	it("FR-21: stream records of other entities or unrelated changes are ignored", async () => {
		const [link] = await addLinks("noise.vn", 1);
		if (!link) throw new Error();
		const raw = await t.raw.send(
			new GetItemCommand({
				TableName: t.table,
				Key: { pk: { S: `DOMAIN#noise.vn` }, sk: { S: `LINK#${link.id}` } },
			}),
		);
		await handlerAt(at(1))(streamEvent(streamRecord("INSERT", raw.Item)));
		expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(0);
	});
});

describe("Alert — system-wide outage (SRS 5.2 step 5)", () => {
	it("5.2: ≥ 80% of a run failing → no domain emails, 1 email to the admin", async () => {
		const tick = at(100).toISOString();
		await recordTick(t.db, tick, 20);
		await t.db.Tick.update({ dispatchedAt: tick }).add({ failed: 18 }).go();

		const [a] = await addLinks("outage-a.vn", 1, "owner@outage-a.vn");
		const [b] = await addLinks("outage-b.vn", 1, "owner@outage-b.vn");
		if (!a || !b) throw new Error();
		await handlerAt(at(103))(
			streamEvent(
				await openIncident(a, at(101)),
				await openIncident(b, at(101)),
			),
		);
		await deliverFlushes(at(108));

		const sent = emails();
		expect(sent).toHaveLength(1);
		expect(sent[0]?.to).toEqual(["admin@linkwatch.test"]);
		expect(sent[0]?.subject).toBe(
			"[LinkWatch][NETWORK] 18/20 links failed in one run — possible LinkWatch network issue",
		);
	});
});

describe("Alert — still failing after a claim (FR-38)", () => {
	it("FR-38 / AC-10: Verifying → Open with a failed claim → 1 email to the claimer only, logged, never twice", async () => {
		const [link] = await addLinks("claim.vn", 1, "owner@claim.vn");
		if (!link) throw new Error();
		await t.db.Recipient.put({
			scope: "DOMAIN",
			target: "claim.vn",
			email: "boss@claim.vn",
		}).go();
		await openIncident(link, at(300));
		const openedAt = at(302).toISOString();
		const incidentId = `${link.id}@${openedAt}`;
		await t.db.Claim.create({
			incidentId,
			claimedAt: at(310).toISOString(),
			linkId: link.id,
			domain: "claim.vn",
			byEmail: "fixer@claim.vn",
			channel: "email",
			outcome: "still_failing",
			attempts: [
				{
					attempt: 1,
					at: at(310).toISOString(),
					result: "dead",
					httpCode: 404,
				},
				{
					attempt: 2,
					at: at(312).toISOString(),
					result: "dead",
					httpCode: 404,
				},
				{
					attempt: 3,
					at: at(315).toISOString(),
					result: "dead",
					httpCode: 404,
				},
			],
		}).go();
		await t.db.Incident.patch({ linkId: link.id, openedAt })
			.set({ state: "verifying" })
			.go();
		const before = await incidentImage(link.id, openedAt);
		await t.db.Incident.patch({ linkId: link.id, openedAt })
			.set({ state: "open", claimNote: "Reported fixed but still failing" })
			.go();
		const after = await incidentImage(link.id, openedAt);
		const record = streamRecord("MODIFY", after, before);
		await handlerAt(at(315))(streamEvent(record));
		await handlerAt(at(315))(streamEvent(record)); // redelivered
		const sent = emails();
		expect(sent).toHaveLength(1);
		expect(sent[0]?.to).toEqual(["fixer@claim.vn"]);
		expect(sent[0]?.subject).toContain("STILL FAILING");
		const log = await t.db.Notification.query.byIncident({ incidentId }).go();
		expect(log.data.map((n) => n.kind)).toContain("verify_failed");
	});
});
