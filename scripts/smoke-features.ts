/**
 * Milestone 3 smoke test (step 40c): Check now (FR-16) and a schedule of its own (FR-12, FR-13)
 * on the real environment, with one sample link that is removed at the end (with the schedule).
 */
import type { LinkView } from "@linkwatch/core";

export type FeatureSmokeOptions = {
	baseUrl: string;
	token: string;
	runId: string;
	/** Check now → result recorded: priority queue (no delay) + Checker. */
	checkNowTimeoutMs?: number;
	pollMs?: number;
	fetch?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
	log?: (message: string) => void;
};

export type FeatureSmokeReport = { ok: boolean; failures: string[] };

const MIN = 60_000;
/** Every 5 minutes: next run ≤ 5 min + half the jitter; 10 min leaves room for slow clocks. */
const INTERVAL_NEXT_RUN_MAX_MS = 10 * MIN;

export async function runFeatureSmoke(
	opts: FeatureSmokeOptions,
): Promise<FeatureSmokeReport> {
	const doFetch = opts.fetch ?? fetch;
	const sleep =
		opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
	const now = opts.now ?? Date.now;
	const log = opts.log ?? (() => {});
	const pollMs = opts.pollMs ?? 5_000;
	const base = opts.baseUrl.replace(/\/+$/, "");
	const failures: string[] = [];

	const call = async (path: string, init: RequestInit = {}) => {
		const headers = new Headers(init.headers);
		headers.set("authorization", `Bearer ${opts.token}`);
		if (init.body) headers.set("content-type", "application/json");
		const res = await doFetch(`${base}/api${path}`, { ...init, headers });
		const body =
			res.status === 204 ? undefined : await res.json().catch(() => undefined);
		return { status: res.status, body };
	};

	let linkId: string | undefined;
	let scheduleId: string | undefined;
	try {
		const created = await call("/links", {
			method: "POST",
			body: JSON.stringify({
				url: `https://example.com/?linkwatch-smoke-features=${opts.runId}`,
				name: "smoke features",
				tags: ["smoke"],
			}),
		});
		if (created.status !== 201) {
			failures.push(`POST /api/links: expected 201, got ${created.status}`);
			return { ok: false, failures };
		}
		const id = (created.body as LinkView).id;
		linkId = id;
		const link = `/links/${encodeURIComponent(id)}`;

		// FR-16: Check now → the priority queue → a result within about a minute.
		const queued = await call("/links/check-now", {
			method: "POST",
			body: JSON.stringify({ linkIds: [id] }),
		});
		const queuedIds = (queued.body as { queued?: string[] } | undefined)
			?.queued;
		if (queued.status !== 202 || !queuedIds?.includes(id))
			failures.push(
				`POST /api/links/check-now: expected 202 with the link queued, got ${queued.status} ${JSON.stringify(queued.body)}`,
			);
		else {
			log("Check now queued");
			const timeoutMs = opts.checkNowTimeoutMs ?? 2 * MIN;
			const deadline = now() + timeoutMs;
			let checked: LinkView | undefined;
			for (;;) {
				const res = await call(link);
				const row = res.body as LinkView | undefined;
				if (res.status === 200 && row?.lastCheckedAt) {
					checked = row;
					break;
				}
				if (now() >= deadline) break;
				await sleep(pollMs);
			}
			if (!checked)
				failures.push(
					`Check now: no result within ${Math.round(timeoutMs / 1000)} s (FR-16)`,
				);
			else if (checked.status !== "up")
				failures.push(`Check now: expected up, got ${checked.status}`);
			else log(`Check now → ${checked.status} (HTTP ${checked.lastHttpCode})`);
		}

		// FR-12 / FR-13: a schedule of the link's own replaces the 06:00 default.
		const schedule = await call("/schedules", {
			method: "POST",
			body: JSON.stringify({
				name: `smoke ${opts.runId}`,
				rule: { kind: "interval", minutes: 5 },
			}),
		});
		if (schedule.status !== 201) {
			failures.push(
				`POST /api/schedules: expected 201, got ${schedule.status} ${JSON.stringify(schedule.body)}`,
			);
			return { ok: false, failures };
		}
		const sid = (schedule.body as { id: string }).id;
		scheduleId = sid;
		const assigned = await call(link, {
			method: "PATCH",
			body: JSON.stringify({ scheduleId: sid }),
		});
		const row = assigned.body as LinkView | undefined;
		const next = Date.parse(row?.nextRunAt ?? "");
		if (assigned.status !== 200 || row?.scheduleId !== sid)
			failures.push(
				`PATCH /api/links/<id> {scheduleId}: expected 200 with the schedule, got ${assigned.status} ${JSON.stringify(assigned.body)}`,
			);
		else if (!(next - now() <= INTERVAL_NEXT_RUN_MAX_MS))
			failures.push(
				`every-5-minutes schedule: next run ${row.nextRunAt} is not within 10 min (FR-13)`,
			);
		else log(`own schedule assigned, next run ${row.nextRunAt}`);

		// A schedule in use cannot be deleted.
		const inUse = await call(`/schedules/${encodeURIComponent(sid)}`, {
			method: "DELETE",
		});
		if (inUse.status !== 409)
			failures.push(
				`DELETE /api/schedules/<in use>: expected 409, got ${inUse.status}`,
			);
	} finally {
		if (linkId) {
			const del = await call(`/links/${encodeURIComponent(linkId)}`, {
				method: "DELETE",
			});
			if (del.status !== 204)
				failures.push(
					`DELETE /api/links/${linkId}: expected 204, got ${del.status}`,
				);
		}
		if (scheduleId) {
			const del = await call(`/schedules/${encodeURIComponent(scheduleId)}`, {
				method: "DELETE",
			});
			if (del.status !== 204)
				failures.push(
					`DELETE /api/schedules/${scheduleId}: expected 204, got ${del.status}`,
				);
		}
		log("cleaned up");
	}
	return { ok: failures.length === 0, failures };
}
