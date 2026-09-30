/**
 * Milestone 2 smoke test (step 40b): a dead link on the real environment opens an incident
 * after the second check (SRS 5.2), the incident email is sent within ≤ 5 minutes of that
 * (AC-04, FR-22), and fixing the link closes the incident with a recovery email (AC-07).
 *
 * The link points at a missing object of the web bucket (CloudFront → S3 answers 403, a dead
 * link); "fixing" it uploads that object. Everything created is removed at the end.
 *
 * Milestone 3 (step 40c), `recover: "claim"`: after the fix the smoke user reports it fixed in
 * the app (FR-41) → the verify check closes the incident within a minute, "fixed by" them (FR-37).
 */
import { incidentId, rootDomainOf } from "@linkwatch/core";

export type IncidentRow = {
	linkId: string;
	openedAt: string;
	state: string;
	closedAt?: string;
};
export type MailRow = {
	kind: string;
	to: string;
	status: string;
	sentAt: string;
};

/** Read access to the table (the API has no incident/email routes before milestone 3). */
export type SmokeStore = {
	latestIncident: (linkId: string) => Promise<IncidentRow | undefined>;
	mails: (incidentId: string) => Promise<MailRow[]>;
};

/** Writes to the static site bucket, used to break and then fix the sample link. */
export type SmokeSite = {
	put: (key: string, body: string) => Promise<void>;
	remove: (key: string) => Promise<void>;
};

export type IncidentSmokeOptions = {
	baseUrl: string;
	token: string;
	runId: string;
	/** Must be verified in SES while the account is in the sandbox. */
	recipient: string;
	store: SmokeStore;
	site: SmokeSite;
	/** Link added → incident open: first check on the next tick (≤ 5 min) + recheck 2 min (+ fallback). */
	openTimeoutMs?: number;
	/** Incident opened → email sent: 5-minute grouping window + delivery. */
	mailTimeoutMs?: number;
	/** Link fixed → incident closed: 10-minute recheck (`recheck`) or the verify check (`claim`). */
	recoveryTimeoutMs?: number;
	/** How the fixed link gets closed: the incident rechecks (5.2) or "Fixed — check again" (FR-41). */
	recover?: "recheck" | "claim";
	pollMs?: number;
	fetch?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
	log?: (message: string) => void;
};

export type IncidentSmokeReport = { ok: boolean; failures: string[] };

const MIN = 60_000;

export async function runIncidentSmoke(
	opts: IncidentSmokeOptions,
): Promise<IncidentSmokeReport> {
	const doFetch = opts.fetch ?? fetch;
	const sleep =
		opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
	const now = opts.now ?? Date.now;
	const log = opts.log ?? (() => {});
	const pollMs = opts.pollMs ?? 20_000;
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

	/** Polls until `probe` returns a value or the timeout passes. */
	async function waitFor<T>(
		what: string,
		timeoutMs: number,
		probe: () => Promise<T | undefined>,
	): Promise<T | undefined> {
		const deadline = now() + timeoutMs;
		for (;;) {
			const value = await probe();
			if (value !== undefined) return value;
			if (now() >= deadline) {
				failures.push(`${what}: not within ${Math.round(timeoutMs / MIN)} min`);
				return undefined;
			}
			log(`waiting: ${what}…`);
			await sleep(pollMs);
		}
	}

	const key = `smoke/${opts.runId}.txt`;
	const url = `${base}/${key}`;
	const domain = rootDomainOf(url);
	let linkId: string | undefined;
	let addedRecipient = false;
	let uploaded = false;

	try {
		// FR-20: the recipient of the link's domain gets the emails.
		const rcp = await call("/recipients", {
			method: "POST",
			body: JSON.stringify({
				scope: "DOMAIN",
				target: domain,
				email: opts.recipient,
				name: "LinkWatch smoke test",
			}),
		});
		if (rcp.status === 201) addedRecipient = true;
		else if (rcp.status !== 409 && rcp.status !== 404) {
			failures.push(
				`POST /api/recipients: expected 201/409, got ${rcp.status}`,
			);
			return { ok: false, failures };
		}

		const created = await call("/links", {
			method: "POST",
			body: JSON.stringify({ url, name: "smoke incident", tags: ["smoke"] }),
		});
		if (created.status !== 201) {
			failures.push(
				`POST /api/links ${url}: expected 201, got ${created.status}`,
			);
			return { ok: false, failures };
		}
		const id = (created.body as { id: string }).id;
		linkId = id;
		log(`created dead link ${url}`);

		// The domain exists now (created with the link): add the recipient if that failed with 404.
		if (!addedRecipient && rcp.status === 404) {
			const retry = await call("/recipients", {
				method: "POST",
				body: JSON.stringify({
					scope: "DOMAIN",
					target: domain,
					email: opts.recipient,
				}),
			});
			addedRecipient = retry.status === 201;
		}

		const incident = await waitFor(
			"incident opened after two failed checks (5.2, AC-04)",
			opts.openTimeoutMs ?? 15 * MIN,
			async () => {
				const inc = await opts.store.latestIncident(id);
				return inc?.state === "open" ? inc : undefined;
			},
		);
		if (!incident) return { ok: false, failures };
		const incId = incidentId(incident.linkId, incident.openedAt);
		log(`incident opened at ${incident.openedAt}`);

		const mailOf = (kind: string) => async () =>
			(await opts.store.mails(incId)).find(
				(m) => m.kind === kind && m.to === opts.recipient.toLowerCase(),
			);
		const down = await waitFor(
			`incident email to ${opts.recipient} (FR-21, FR-22)`,
			opts.mailTimeoutMs ?? 8 * MIN,
			mailOf("down"),
		);
		if (down && down.status !== "sent")
			failures.push(`incident email status: expected sent, got ${down.status}`);
		if (down) {
			const delay = Date.parse(down.sentAt) - Date.parse(incident.openedAt);
			log(`incident email ${down.status} after ${Math.round(delay / 1000)} s`);
			// NFR-03 / AC-04: ≤ 5 minutes after confirmation (+ 1 minute of queue/Lambda slack).
			if (delay > 6 * MIN)
				failures.push(
					`incident email sent ${Math.round(delay / 1000)} s after the incident (expected ≤ 5 min)`,
				);
		}

		// Fix the link: the object now exists, CloudFront → 200.
		await opts.site.put(key, "LinkWatch smoke test — fixed\n");
		uploaded = true;
		log("link fixed (object uploaded)");

		const claim = opts.recover === "claim";
		if (claim) {
			const res = await call("/incidents/resolve-claim", {
				method: "POST",
				body: JSON.stringify({
					incidentIds: [incId],
					note: "LinkWatch smoke test",
				}),
			});
			const decision = (
				res.body as { items?: { decision?: string }[] } | undefined
			)?.items?.[0]?.decision;
			if (res.status !== 200 || decision !== "started") {
				failures.push(
					`POST /api/incidents/resolve-claim: expected 200 started, got ${res.status} ${decision ?? JSON.stringify(res.body)}`,
				);
				return { ok: false, failures };
			}
			log("reported fixed (FR-41), verify check queued");
		}

		const closed = await waitFor(
			claim
				? "incident closed by the verify check (FR-37)"
				: "incident closed after the link was fixed (5.2 step 4)",
			opts.recoveryTimeoutMs ?? (claim ? 3 * MIN : 20 * MIN),
			async () => {
				const inc = await opts.store.latestIncident(id);
				return inc?.state === "closed" ? inc : undefined;
			},
		);
		if (closed && claim) {
			const res = await call(`/incidents/${encodeURIComponent(incId)}`);
			const detail = res.body as
				| { closedBy?: string; claims?: { outcome: string }[] }
				| undefined;
			if (!detail?.closedBy || detail.claims?.at(-1)?.outcome !== "fixed")
				failures.push(
					`GET /api/incidents/<id>: expected closedBy and a fixed claim, got ${JSON.stringify({ closedBy: detail?.closedBy, claims: detail?.claims })}`,
				);
			else log(`incident closed, fixed by ${detail.closedBy}`);
		}
		if (closed) {
			const recovery = await waitFor(
				`recovery email to ${opts.recipient} (FR-21, AC-07)`,
				opts.mailTimeoutMs ?? 8 * MIN,
				mailOf("recovery"),
			);
			if (recovery && recovery.status !== "sent")
				failures.push(
					`recovery email status: expected sent, got ${recovery.status}`,
				);
		}
	} finally {
		if (uploaded)
			await opts.site.remove(key).catch((err: unknown) => {
				failures.push(`delete s3://…/${key}: ${String(err)}`);
			});
		if (linkId) {
			const del = await call(`/links/${encodeURIComponent(linkId)}`, {
				method: "DELETE",
			});
			if (del.status !== 204)
				failures.push(
					`DELETE /api/links/${linkId}: expected 204, got ${del.status}`,
				);
		}
		if (addedRecipient)
			await call(
				`/recipients?${new URLSearchParams({ scope: "DOMAIN", target: domain, email: opts.recipient })}`,
				{ method: "DELETE" },
			);
		log("cleaned up");
	}
	return { ok: failures.length === 0, failures };
}
