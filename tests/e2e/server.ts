/**
 * Step 34: local server for the Playwright E2E of SCR-10. Serves the static web build
 * (`apps/web/out`, same origin as CloudFront) and the real API on DynamoDB Local; verify jobs
 * run through the real Checker against a fake site, with delays scaled down (2 min → 2 s).
 * `/__e2e/*` seeds data for the specs — this file is never deployed.
 */
import { readFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { serve } from "@hono/node-server";
import { createTestDb } from "@linkwatch/core/db/testing";
import { hashToken, newToken, tokenTtl } from "@linkwatch/core/token";
import { createLink, getLink, recordCheck } from "@linkwatch/core/usecases";
import type { SQSRecord } from "aws-lambda";
import { Hono } from "hono";
import { createApp } from "../../services/api/src/app";
import { createHandler } from "../../services/checker/src/handler";

const PORT = Number(process.env.E2E_PORT ?? 4310);
/** Real seconds per queued second: 120 s → 2 s. */
const TIME_SCALE = Number(process.env.E2E_TIME_SCALE ?? 1 / 60);
const OUT = fileURLToPath(new URL("../../apps/web/out", import.meta.url));

const t = await createTestDb();

// Fake site: every path answers with the status the spec sets (404 until "fixed").
const siteStatus = new Map<string, number>();
const site = http.createServer((req, res) => {
	res.writeHead(siteStatus.get(req.url ?? "/") ?? 404).end("site");
});
await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
const siteBase = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;

const checker = createHandler({
	db: t.db,
	probeOptions: { allowPrivate: true },
	log: (message, extra) => console.log("[checker]", message, extra ?? ""),
});

let seq = 0;
const api = createApp({
	db: t.db,
	auth: { kind: "local", user: { sub: "e2e", email: "ops@abc.com" } },
	email: {
		ses: new SESv2Client({ region: "local" }),
		defaults: {
			sesIdentity: "watch.hueai.net",
			senderEmail: "noreply@watch.hueai.net",
		},
	},
	// The priority queue: run the job through the Checker after its (scaled) delay.
	sendPriorityJob: async (job, delay = 0) => {
		setTimeout(
			() => {
				const record = {
					messageId: `e2e-${++seq}`,
					body: JSON.stringify(job),
					eventSourceARN: "arn:aws:sqs:local:0:linkwatch-priority",
				} as SQSRecord;
				checker({ Records: [record] }).catch((err) =>
					console.error("[checker] failed", err),
				);
			},
			delay * 1000 * TIME_SCALE,
		);
	},
	log: console.error,
});

/** An open incident (5.2: two failed checks) and a token for one recipient (FR-33). */
async function seedIncident(name: string) {
	const now = Date.now();
	const link = await createLink(t.db, { url: `${siteBase}/${name}` });
	const fail = { result: "dead" as const, httpCode: 404, responseMs: 12 };
	for (const minutesAgo of [12, 10])
		await recordCheck(t.db, await getLink(t.db, link.id), fail, {
			now: new Date(now - minutesAgo * 60_000),
			jobId: `seed-${name}-${minutesAgo}`,
		});
	const { data } = await t.db.Incident.query.primary({ linkId: link.id }).go();
	const incident = data[0];
	if (!incident) throw new Error("incident not opened");
	const token = newToken();
	await t.db.Token.put({
		tokenHash: hashToken(token),
		incidentIds: [`${link.id}@${incident.openedAt}`],
		recipientEmail: "lan@abc.com",
		issuedAt: new Date(now).toISOString(),
		ttl: tokenTtl(new Date(now)),
	}).go();
	return {
		token,
		incidentId: `${link.id}@${incident.openedAt}`,
		url: link.url,
	};
}

const TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
	".txt": "text/plain",
};

const app = new Hono()
	.post("/__e2e/incident", async (c) => {
		const { name } = await c.req.json<{ name: string }>();
		return c.json(await seedIncident(name));
	})
	.post("/__e2e/site", async (c) => {
		const { name, status } = await c.req.json<{
			name: string;
			status: number;
		}>();
		siteStatus.set(`/${name}`, status);
		return c.json({ ok: true });
	})
	.get("/__e2e/claims", async (c) => {
		const incidentId = c.req.query("incidentId") ?? "";
		const { data } = await t.db.Claim.query.byIncident({ incidentId }).go();
		return c.json({ items: data });
	})
	.all("/api/*", (c) => api.fetch(c.req.raw))
	// Static export, like CloudFront + the index.html rewrite function.
	.get("*", async (c) => {
		let rel = decodeURIComponent(new URL(c.req.url).pathname);
		if (rel.endsWith("/")) rel += "index.html";
		const file = path.join(OUT, path.normalize(rel));
		if (!file.startsWith(OUT)) return c.notFound();
		try {
			const body = await readFile(file);
			return c.body(body, 200, {
				"content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
			});
		} catch {
			return c.notFound();
		}
	});

const server = serve({ fetch: app.fetch, port: PORT }, () =>
	console.log(
		`E2E server: http://localhost:${PORT} (site ${siteBase}, table ${t.table})`,
	),
);

const stop = async () => {
	server.close();
	site.close();
	await t.drop();
	process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
