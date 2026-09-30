import http from "node:http";
import type { AddressInfo } from "node:net";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { PriorityJob } from "@linkwatch/core";
import { createTestDb, type TestDb } from "@linkwatch/core/db/testing";
import { createLink } from "@linkwatch/core/usecases";
import type { DynamoDBRecord, SQSEvent, SQSRecord } from "aws-lambda";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHandler as createAlert } from "../../services/alert/src/handler";
import { createApp } from "../../services/api/src/app";
import { createHandler as createChecker } from "../../services/checker/src/handler";

/**
 * Step 33: the "Fixed — check again" flow end to end — Checker opens the incident, Alert emails
 * the per-recipient tokens, the recipient claims through the API, the verify jobs run through the
 * Checker and Alert sends the recovery or still-failing email. DynamoDB Local; SQS and SES mocked;
 * Streams and delayed queues are delivered by the test with a fake clock for the workers.
 */

const sesMock = mockClient(SESv2Client);
const sqsMock = mockClient(SQSClient);

const APP_URL = "https://watch.hueai.net";
const ADMIN = "admin@linkwatch.test";
const TEAM = ["lan@abc.com", "minh@abc.com"];

let t: TestDb;
let server: http.Server;
let base: string;
/** Status code the site answers with; the test "fixes" the site by changing it. */
let siteStatus = 404;
/** Fake clock of the Checker and Alert handlers. */
let clock = new Date();
const priorityJobs: { job: PriorityJob; delay: number }[] = [];

let app: ReturnType<typeof createApp>;
const checker = () =>
	createChecker({
		db: t.db,
		now: () => clock,
		probeOptions: { allowPrivate: true },
	});
const alert = () =>
	createAlert({
		db: t.db,
		ses: new SESv2Client({}),
		sqs: new SQSClient({}),
		alertQueueUrl: "https://sqs.local/linkwatch-alert",
		config: {
			appUrl: APP_URL,
			defaults: {
				sesIdentity: "watch.hueai.net",
				senderEmail: "noreply@watch.hueai.net",
			},
		},
		sleep: async () => {},
		now: () => clock,
	});

beforeAll(async () => {
	t = await createTestDb();
	await t.db.Settings.put({ defaultAdminEmail: ADMIN }).go();
	server = http.createServer((_req, res) => {
		res.writeHead(siteStatus).end("ok");
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	app = createApp({
		db: t.db,
		auth: { kind: "local", user: { sub: "u1", email: "ops@abc.com" } },
		email: {
			ses: new SESv2Client({}),
			defaults: {
				sesIdentity: "watch.hueai.net",
				senderEmail: "noreply@watch.hueai.net",
			},
		},
		sendPriorityJob: async (job, delay) => {
			priorityJobs.push({ job, delay: delay ?? 0 });
		},
	});
});
afterAll(async () => {
	await new Promise((r) => server.close(r));
	await t?.drop();
});
beforeEach(() => {
	sesMock.reset();
	sqsMock.reset();
	sesMock.on(SendEmailCommand).resolves({ MessageId: "ses-id" });
	sqsMock.on(SendMessageCommand).resolves({ MessageId: "sqs-id" });
	priorityJobs.length = 0;
});

let seq = 0;
const sqsRecord = (body: unknown): SQSRecord =>
	({
		messageId: `msg-${++seq}`,
		body: JSON.stringify(body),
		eventSource: "aws:sqs",
	}) as SQSRecord;

/** Incident items of a link in DynamoDB JSON, as Streams delivers them. */
async function incidentImages(linkId: string) {
	const r = await t.raw.send(
		new QueryCommand({
			TableName: t.table,
			KeyConditionExpression: "pk = :pk AND begins_with(sk, :inc)",
			ExpressionAttributeValues: {
				":pk": { S: `LINK#${linkId}` },
				":inc": { S: "INC#" },
			},
		}),
	);
	return new Map((r.Items ?? []).map((i) => [i.sk?.S ?? "", i]));
}

/** Runs `step`, then delivers the incident changes it made to the Alert handler (Streams). */
async function withStream(linkId: string, step: () => Promise<unknown>) {
	const before = await incidentImages(linkId);
	await step();
	const after = await incidentImages(linkId);
	const records: DynamoDBRecord[] = [];
	for (const [sk, next] of after) {
		const prev = before.get(sk);
		if (prev && JSON.stringify(prev) === JSON.stringify(next)) continue;
		records.push({
			eventName: prev ? "MODIFY" : "INSERT",
			eventSource: "aws:dynamodb",
			dynamodb: {
				SequenceNumber: String(++seq),
				NewImage: next as never,
				...(prev && { OldImage: prev as never }),
			},
		});
	}
	if (records.length) {
		const res = await alert()({ Records: records });
		expect(res).toEqual({ batchItemFailures: [] });
	}
}

/** Delivers the delayed Alert flush messages once their delay has passed (fake clock). */
async function deliverFlushes(at: Date) {
	const bodies = sqsMock
		.commandCalls(SendMessageCommand)
		.map((c) => c.args[0].input.MessageBody ?? "");
	sqsMock.resetHistory();
	clock = at;
	if (bodies.length)
		await alert()({
			Records: bodies.map((b) => sqsRecord(JSON.parse(b))),
		} as SQSEvent);
}

const emails = () =>
	sesMock.commandCalls(SendEmailCommand).map((c) => {
		const input = c.args[0].input;
		return {
			to: input.Destination?.ToAddresses?.[0] ?? "",
			subject: input.Content?.Simple?.Subject?.Data ?? "",
			html: input.Content?.Simple?.Body?.Html?.Data ?? "",
			text: input.Content?.Simple?.Body?.Text?.Data ?? "",
		};
	});

const tokenIn = (html: string) => {
	const m = html.match(/\/confirm\/\?token=([^"&\s]+)/);
	if (!m?.[1]) throw new Error("no confirm link in the email");
	return decodeURIComponent(m[1]);
};

const api = (path: string, init: RequestInit = {}) =>
	app.request(`/api${path}`, {
		...init,
		headers: {
			authorization: "Bearer test",
			"content-type": "application/json",
		},
	});

/**
 * 5.2: two failed scheduled checks open the incident (Checker → Streams → Alert), then the
 * 5-minute window flushes one incident email per recipient, each with its own token (FR-33).
 */
async function openIncidentAndEmail(path: string) {
	siteStatus = 404;
	const t0 = new Date(Date.now() - 30 * 60_000);
	clock = t0;
	const link = await createLink(t.db, { url: `${base}/${path}` }, { now: t0 });
	for (const email of TEAM)
		await t.db.Recipient.put({ scope: "LINK", target: link.id, email }).go();
	const scheduled = (at: Date) => ({
		kind: "scheduled",
		domain: link.domain,
		linkIds: [link.id],
		dispatchedAt: at.toISOString(),
	});
	await withStream(link.id, () =>
		checker()({ Records: [sqsRecord(scheduled(t0))] }),
	);
	const second = new Date(t0.getTime() + 2 * 60_000);
	clock = second;
	await withStream(link.id, () =>
		checker()({ Records: [sqsRecord(scheduled(second))] }),
	);
	const { data: incidents } = await t.db.Incident.query
		.primary({ linkId: link.id })
		.go();
	const incident = incidents[0];
	expect(incident?.state).toBe("open");
	if (!incident) throw new Error("incident not opened");
	await deliverFlushes(new Date(second.getTime() + 6 * 60_000));
	const sent = emails();
	sesMock.resetHistory();
	return {
		link,
		incidentId: `${link.id}@${incident.openedAt}`,
		openedAt: incident.openedAt,
		sent,
	};
}

/** FR-37: delivers one queued verify job once its delay has passed (fake clock). */
async function runVerify(i: number, linkId: string) {
	const entry = priorityJobs[i];
	if (!entry) throw new Error(`verify job ${i} not queued`);
	clock = new Date(entry.job.dueAt);
	await withStream(linkId, () =>
		checker()({ Records: [sqsRecord(entry.job)] }),
	);
}

describe("Flow — Fixed, check again (step 33)", () => {
	it("AC-09: recipient fixes the site, confirms from the email → OK at once, incident closed by them, everyone gets the recovery email", async () => {
		const { link, incidentId, openedAt, sent } =
			await openIncidentAndEmail("ac09");
		// FR-33: one email per link recipient (the admin is only the fallback), each with its own token.
		expect(sent.map((e) => e.to).sort()).toEqual([...TEAM].sort());
		const lan = sent.find((e) => e.to === "lan@abc.com");
		if (!lan) throw new Error();
		const token = tokenIn(lan.html);
		expect(new Set(sent.map((e) => tokenIn(e.html))).size).toBe(2);

		// The site is fixed; Lan opens the link (read only) and confirms.
		siteStatus = 200;
		const view = await api(`/public/claims?token=${encodeURIComponent(token)}`);
		expect(await view.json()).toMatchObject({
			status: "open",
			recipient: "lan@abc.com",
		});
		const claimed = await api("/public/claims", {
			method: "POST",
			body: JSON.stringify({ token, note: "Restored the file" }),
		});
		expect(claimed.status).toBe(200);
		// FR-37: 3 checks queued — now, +2 min, +5 min.
		expect(
			priorityJobs.map((j) => [j.job.kind, j.job.attempt, j.delay]),
		).toEqual([
			["verify", 1, 0],
			["verify", 2, 120],
			["verify", 3, 300],
		]);

		// Attempt 1 runs right away and succeeds.
		await runVerify(0, link.id);
		const { data: closed } = await t.db.Incident.get({
			linkId: link.id,
			openedAt,
		}).go();
		expect(closed).toMatchObject({
			state: "closed",
			closedBy: "lan@abc.com",
		});

		// AC-09: the confirmation page (polling every 3 s) now shows OK.
		const progress = (await (
			await api(`/public/claims?token=${encodeURIComponent(token)}`)
		).json()) as { status: string; items: { incident: { state: string } }[] };
		expect(progress.status).toBe("recovered");
		expect(progress.items[0]?.incident.state).toBe("closed");

		// The later attempts find the claim settled and change nothing.
		await runVerify(1, link.id);
		await runVerify(2, link.id);
		const { data: claims } = await t.db.Claim.query
			.byIncident({ incidentId })
			.go();
		expect(claims).toHaveLength(1);
		expect(claims[0]).toMatchObject({ outcome: "fixed" });

		// FR-37: recovery email to every recipient, labelled with who fixed it.
		await deliverFlushes(new Date(clock.getTime() + 6 * 60_000));
		const recovery = emails();
		expect(recovery.map((e) => e.to).sort()).toEqual([...TEAM].sort());
		for (const e of recovery) {
			expect(e.subject).toContain("RECOVERED");
			expect(e.text).toContain("lan@abc.com");
		}

		// FR-42: the email link of a closed incident says it recovered and queues nothing.
		priorityJobs.length = 0;
		const again = await api("/public/claims", {
			method: "POST",
			body: JSON.stringify({ token }),
		});
		expect(await again.json()).toMatchObject({ status: "recovered" });
		expect(priorityJobs).toHaveLength(0);
	});

	it("AC-10: the site still fails → after 3 checks (now, +2, +5 min) the incident is Open again and only the claimer is told", async () => {
		const { link, incidentId, openedAt } = await openIncidentAndEmail("ac10");
		// In-app claim (FR-41) by the signed-in user; the site is still broken.
		const res = await api("/incidents/resolve-claim", {
			method: "POST",
			body: JSON.stringify({ incidentIds: [incidentId], note: "Deployed" }),
		});
		expect(res.status).toBe(200);
		expect(priorityJobs).toHaveLength(3);
		const incident = () =>
			t.db.Incident.get({ linkId: link.id, openedAt }).go();
		expect((await incident()).data?.state).toBe("verifying");

		// Attempts 1 and 2 fail: still Verifying, no email yet.
		await runVerify(0, link.id);
		await runVerify(1, link.id);
		expect((await incident()).data?.state).toBe("verifying");
		expect(emails()).toHaveLength(0);

		// Attempt 3 fails → Open with a note; Streams → still-failing email to the claimer only.
		await runVerify(2, link.id);
		expect((await incident()).data).toMatchObject({ state: "open" });
		expect((await incident()).data?.claimNote).toBeTruthy();
		const claims = await t.db.Claim.query.byIncident({ incidentId }).go();
		expect(claims.data[0]).toMatchObject({
			outcome: "still_failing",
			byEmail: "ops@abc.com",
		});
		expect(claims.data[0]?.attempts?.map((a) => a.result)).toEqual([
			"dead",
			"dead",
			"dead",
		]);
		const sent = emails();
		expect(sent).toHaveLength(1);
		expect(sent[0]?.to).toBe("ops@abc.com");
		expect(sent[0]?.subject).toContain("STILL FAILING");

		// No recovery email for anyone; the incident was never closed.
		await deliverFlushes(new Date(clock.getTime() + 6 * 60_000));
		expect(emails()).toHaveLength(1);
	});
});
