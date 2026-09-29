/**
 * Milestone 1 smoke test against a deployed LinkWatch (step 40a).
 *
 *   SMOKE_API_KEY=… pnpm smoke                        # https://watch.hueai.net
 *   SMOKE_BASE_URL=http://localhost:8787 SMOKE_API_KEY=dev pnpm smoke
 *
 * Steps: /api/health → request without key gets 401 → add 4 sample links →
 * wait for the Dispatcher/Checker (up to 10 minutes) → each link has the expected status → delete the sample links.
 */
import { pathToFileURL } from "node:url";
import {
	API_KEY_HEADER,
	type LinkInputRaw,
	type LinkPage,
	type LinkStatus,
	type LinkView,
} from "@linkwatch/core";

export type SmokeSample = { expected: LinkStatus; input: LinkInputRaw };

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
	apiKey: string;
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
	const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
	const pollMs = opts.pollMs ?? 15_000;
	const base = `${opts.baseUrl.replace(/\/+$/, "")}/api`;
	const failures: string[] = [];

	const call = async (path: string, init: RequestInit = {}, withKey = true) => {
		const headers = new Headers(init.headers);
		if (withKey) headers.set(API_KEY_HEADER, opts.apiKey);
		if (init.body) headers.set("content-type", "application/json");
		const res = await doFetch(`${base}${path}`, { ...init, headers });
		const body =
			res.status === 204 ? undefined : await res.json().catch(() => undefined);
		return { status: res.status, body };
	};

	const health = await call("/health", {}, false);
	if (health.status !== 200)
		failures.push(`GET /api/health: expected 200, got ${health.status}`);

	const noKey = await call("/links", {}, false);
	if (noKey.status !== 401)
		failures.push(
			`GET /api/links without key: expected 401, got ${noKey.status}`,
		);

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
			const pending = created.filter(
				(c) => (latest.get(c.link.id)?.status ?? "pending") === "pending",
			);
			if (!pending.length) break;
			if (now() >= deadline) break;
			log(`waiting for ${pending.length} link(s) to be checked…`);
			await sleep(pollMs);
		}

		links = created.map(({ sample, link }) => ({
			expected: sample.expected,
			actual: latest.get(link.id)?.status,
			url: link.url,
		}));
		for (const l of links) {
			if (l.actual === "pending")
				failures.push(
					`${l.url}: not checked within ${Math.round(timeoutMs / 1000)} s`,
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
	const apiKey = process.env.SMOKE_API_KEY;
	if (!apiKey) {
		console.error(
			"SMOKE_API_KEY is required (see docs/RUNBOOK.md, section 2, for how to read it from SSM).",
		);
		process.exit(2);
	}
	const baseUrl = process.env.SMOKE_BASE_URL ?? "https://watch.hueai.net";
	const runId = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
	console.log(`LinkWatch smoke test → ${baseUrl} (run ${runId})`);
	const report = await runSmoke({
		baseUrl,
		apiKey,
		samples: defaultSamples(runId),
		timeoutMs: Number(process.env.SMOKE_TIMEOUT_MS ?? 10 * 60_000),
		log: (m) => console.log(`  ${m}`),
	});
	for (const l of report.links)
		console.log(
			`  ${l.actual === l.expected ? "PASS" : "FAIL"} ${l.expected.padEnd(4)} ← ${l.actual ?? "-"}  ${l.url}`,
		);
	for (const f of report.failures) console.error(`  ✗ ${f}`);
	console.log(report.ok ? "Smoke test passed" : "Smoke test FAILED");
	process.exit(report.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
