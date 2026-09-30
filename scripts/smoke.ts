/**
 * Smoke test against a deployed LinkWatch (steps 40a, 40b) — see docs/RUNBOOK.md §4.
 *
 *   SMOKE_EMAIL=… SMOKE_PASSWORD=… AWS_PROFILE=linkwatch pnpm smoke
 *
 * Milestone 1 part: /api/health → request without a token gets 401 → API errors stay JSON
 * through CloudFront (step 37c) → add 4 sample links → wait for the Dispatcher/Checker
 * (up to 15 minutes: failures are Suspect first and confirmed by the 2-minute recheck, SRS 5.2)
 * → each link has the expected status → delete the sample links.
 * Milestone 2 part (smoke-incident.ts): 404 link → incident → email → fix → recovery email;
 * since milestone 3 the fix is reported in the app ("Fixed — check again") unless SMOKE_RECOVER=recheck.
 * Milestone 3 part (smoke-features.ts): Check now and a schedule of its own.
 */
import { pathToFileURL } from "node:url";
import type {
	LinkInputRaw,
	LinkPage,
	LinkStatus,
	LinkView,
} from "@linkwatch/core";
import { loadAwsEnvironment } from "./aws";
import { runFeatureSmoke } from "./smoke-features";
import { runIncidentSmoke } from "./smoke-incident";

export type SmokeSample = { expected: LinkStatus; input: LinkInputRaw };

/**
 * Not a final result yet: never checked, or failed once and waiting for the SRS 5.2
 * recheck (Suspect) — a dead/down link only gets its status after the second failure.
 */
const UNSETTLED: ReadonlySet<LinkStatus> = new Set(["pending", "suspect"]);

/** One public URL per SRS 5.1 result. A unique query string avoids duplicates left by an earlier run. */
export function defaultSamples(runId: string): SmokeSample[] {
	const q = `?linkwatch-smoke=${runId}`;
	const samples: { expected: LinkStatus; url: string }[] = [
		{ expected: "up", url: `https://example.com/${q}` },
		// Slow threshold is 5 s (SRS 5.1); httpbin answers after 7 s.
		{ expected: "slow", url: `https://httpbin.org/delay/7${q}` },
		{ expected: "dead", url: `https://httpbin.org/status/404${q}` },
		// NXDOMAIN → Site down (dns).
		{ expected: "down", url: `https://linkwatch-smoke-nx.example.com/${q}` },
	];
	return samples.map(({ expected, url }) => ({
		expected,
		input: { url, name: `smoke ${expected}`, tags: ["smoke"] },
	}));
}

export type SmokeOptions = {
	baseUrl: string;
	/** Cognito ID token (FR-28). */
	token: string;
	/** Also check that an unknown web page still shows the 404 page (step 37c); off for a local API. */
	checkWebNotFound?: boolean;
	samples: SmokeSample[];
	timeoutMs?: number;
	pollMs?: number;
	fetch?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
	log?: (message: string) => void;
};

export type SmokeReport = {
	ok: boolean;
	failures: string[];
	links: { expected: LinkStatus; actual?: LinkStatus; url: string }[];
};

export async function runSmoke(opts: SmokeOptions): Promise<SmokeReport> {
	const doFetch = opts.fetch ?? fetch;
	const sleep =
		opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
	const now = opts.now ?? Date.now;
	const log = opts.log ?? (() => {});
	// First check on the next tick (≤ 5 min) + SRS 5.2 recheck 2 min later for failures, plus slack.
	const timeoutMs = opts.timeoutMs ?? 15 * 60_000;
	const pollMs = opts.pollMs ?? 15_000;
	const base = `${opts.baseUrl.replace(/\/+$/, "")}/api`;
	const failures: string[] = [];

	const call = async (
		path: string,
		init: RequestInit = {},
		signedIn = true,
	) => {
		const headers = new Headers(init.headers);
		if (signedIn) headers.set("authorization", `Bearer ${opts.token}`);
		if (init.body) headers.set("content-type", "application/json");
		const res = await doFetch(`${base}${path}`, { ...init, headers });
		const body =
			res.status === 204 ? undefined : await res.json().catch(() => undefined);
		return { status: res.status, body };
	};

	const health = await call("/health", {}, false);
	if (health.status !== 200)
		failures.push(`GET /api/health: expected 200, got ${health.status}`);

	const noToken = await call("/links", {}, false);
	if (noToken.status !== 401)
		failures.push(
			`GET /api/links without a token: expected 401, got ${noToken.status}`,
		);

	// Step 37c: CloudFront must not turn API errors into the HTML 404 page.
	const missing = await call("/links/linkwatch-smoke-missing", {
		method: "DELETE",
	});
	if (
		missing.status !== 404 ||
		(missing.body as { error?: string } | undefined)?.error !== "not_found"
	)
		failures.push(
			`DELETE /api/links/<unknown>: expected 404 {"error":"not_found"}, got ${missing.status} ${JSON.stringify(missing.body)}`,
		);
	if (opts.checkWebNotFound) {
		const page = await doFetch(
			`${opts.baseUrl.replace(/\/+$/, "")}/linkwatch-smoke-missing-page/`,
		);
		if (!(page.headers.get("content-type") ?? "").includes("text/html"))
			failures.push(
				`unknown web page: expected the HTML 404 page, got ${page.status} ${page.headers.get("content-type")}`,
			);
	}

	// Stop early: without a working API every later step fails for the same reason.
	if (failures.length) return { ok: false, failures, links: [] };

	const created: { sample: SmokeSample; link: LinkView }[] = [];
	let links: SmokeReport["links"] = [];
	try {
		for (const sample of opts.samples) {
			const res = await call("/links", {
				method: "POST",
				body: JSON.stringify(sample.input),
			});
			if (res.status !== 201) {
				failures.push(
					`POST /api/links ${sample.input.url}: expected 201, got ${res.status} ${JSON.stringify(res.body)}`,
				);
				continue;
			}
			created.push({ sample, link: res.body as LinkView });
			log(`created ${sample.expected.padEnd(4)} ${sample.input.url}`);
		}

		const ids = new Set(created.map((c) => c.link.id));
		let latest = new Map<string, LinkView>();
		const deadline = now() + timeoutMs;
		while (created.length) {
			latest = await findLinks(call, ids);
			const pending = created.filter((c) =>
				UNSETTLED.has(latest.get(c.link.id)?.status ?? "pending"),
			);
			if (!pending.length) break;
			if (now() >= deadline) break;
			log(`waiting for ${pending.length} link(s) to get a confirmed result…`);
			await sleep(pollMs);
		}

		links = created.map(({ sample, link }) => ({
			expected: sample.expected,
			actual: latest.get(link.id)?.status,
			url: link.url,
		}));
		for (const l of links) {
			if (l.actual && UNSETTLED.has(l.actual))
				failures.push(
					`${l.url}: still ${l.actual} after ${Math.round(timeoutMs / 1000)} s`,
				);
			else if (l.actual !== l.expected)
				failures.push(
					`${l.url}: expected ${l.expected}, got ${l.actual ?? "missing"}`,
				);
		}
	} finally {
		for (const { link } of created) {
			const res = await call(`/links/${encodeURIComponent(link.id)}`, {
				method: "DELETE",
			}).catch((err: unknown) => ({ status: 0, body: String(err) }));
			if (res.status !== 204)
				failures.push(
					`DELETE /api/links/${link.id}: expected 204, got ${res.status}`,
				);
		}
		if (created.length) log(`deleted ${created.length} sample link(s)`);
	}
	// Computed after cleanup so a failed delete also fails the run.
	return { ok: failures.length === 0, failures, links };
}

type Call = (
	path: string,
	init?: RequestInit,
) => Promise<{ status: number; body: unknown }>;

/** Walks every page of GET /api/links until all ids are found. */
async function findLinks(call: Call, ids: Set<string>) {
	const found = new Map<string, LinkView>();
	let cursor: string | null = null;
	do {
		const q = new URLSearchParams({ limit: "100" });
		if (cursor) q.set("cursor", cursor);
		const res = await call(`/links?${q}`);
		if (res.status !== 200)
			throw new Error(`GET /api/links: expected 200, got ${res.status}`);
		const page = res.body as LinkPage;
		for (const l of page.items) if (ids.has(l.id)) found.set(l.id, l);
		cursor = page.cursor;
	} while (cursor && found.size < ids.size);
	return found;
}

async function main() {
	const email = process.env.SMOKE_EMAIL;
	const password = process.env.SMOKE_PASSWORD;
	if (!email || !password) {
		console.error(
			"SMOKE_EMAIL and SMOKE_PASSWORD (a Cognito user) are required — see docs/RUNBOOK.md §4.",
		);
		process.exit(2);
	}
	const baseUrl = process.env.SMOKE_BASE_URL ?? "https://watch.hueai.net";
	const runId = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
	console.log(`LinkWatch smoke test → ${baseUrl} (run ${runId})`);

	const aws = await loadAwsEnvironment();
	const token = await aws.signIn(email, password);
	const report = await runSmoke({
		baseUrl,
		token,
		checkWebNotFound: true,
		samples: defaultSamples(runId),
		timeoutMs: Number(process.env.SMOKE_TIMEOUT_MS ?? 15 * 60_000),
		log: (m) => console.log(`  ${m}`),
	});
	for (const l of report.links)
		console.log(
			`  ${l.actual === l.expected ? "PASS" : "FAIL"} ${l.expected.padEnd(4)} ← ${l.actual ?? "-"}  ${l.url}`,
		);
	for (const f of report.failures) console.error(`  ✗ ${f}`);

	console.log("Check now and own schedule (milestone 3)…");
	const features = await runFeatureSmoke({
		baseUrl,
		token,
		runId,
		log: (m) => console.log(`  ${m}`),
	});
	for (const f of features.failures) console.error(`  ✗ ${f}`);

	let incidentOk = true;
	if (process.env.SMOKE_SKIP_INCIDENT !== "1") {
		const recover =
			process.env.SMOKE_RECOVER === "recheck" ? "recheck" : "claim";
		console.log(
			`Incident flow (up to ~${recover === "claim" ? 25 : 35} minutes, recover by ${recover})…`,
		);
		const incident = await runIncidentSmoke({
			baseUrl,
			token,
			runId,
			recipient: process.env.SMOKE_RECIPIENT ?? "helen@wootech.co",
			store: aws.store,
			site: aws.site,
			recover,
			log: (m) => console.log(`  ${m}`),
		});
		for (const f of incident.failures) console.error(`  ✗ ${f}`);
		incidentOk = incident.ok;
	}
	const ok = report.ok && features.ok && incidentOk;
	console.log(ok ? "Smoke test passed" : "Smoke test FAILED");
	process.exit(ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
