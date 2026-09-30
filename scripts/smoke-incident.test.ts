import { describe, expect, it } from "vitest";
import {
	type IncidentRow,
	type IncidentSmokeOptions,
	type MailRow,
	runIncidentSmoke,
} from "./smoke-incident";

type Scenario = {
	/** Poll count after which each event happens; undefined = never. */
	openAfter?: number;
	downMailAfter?: number;
	/** Polls after the fix before the incident closes. */
	closeAfter?: number;
	recoveryMailAfter?: number;
	downMailStatus?: string;
	/** Seconds between the incident and its email. */
	downMailDelayS?: number;
	domainExists?: boolean;
	/** Answer of POST /incidents/resolve-claim. */
	claimDecision?: string;
	/** GET /incidents/:id after the claim closed it. */
	closedBy?: string;
};

/** Fake API + table + bucket, advancing the "real" system one step per poll. */
function fakeWorld(s: Scenario = {}) {
	const calls: string[] = [];
	const uploads: string[] = [];
	const removed: string[] = [];
	let polls = 0;
	let fixedAtPoll: number | undefined;
	const openedAt = "2026-09-30T00:04:00.000Z";
	let domainExists = s.domainExists ?? true;

	const json = (status: number, body?: unknown) =>
		new Response(body === undefined ? null : JSON.stringify(body), { status });
	const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
		const url = new URL(String(input));
		const method = init.method ?? "GET";
		calls.push(`${method} ${url.pathname}${url.search}`);
		if (url.pathname === "/api/recipients" && method === "POST")
			return domainExists ? json(201, {}) : json(404, { error: "not_found" });
		if (url.pathname === "/api/links" && method === "POST") {
			domainExists = true;
			return json(201, { id: "L1" });
		}
		if (url.pathname === "/api/incidents/resolve-claim")
			return json(200, {
				items: [{ decision: s.claimDecision ?? "started" }],
			});
		if (url.pathname.startsWith("/api/incidents/") && method === "GET")
			return json(200, {
				closedBy: s.closedBy,
				claims: [{ outcome: "fixed" }],
			});
		if (method === "DELETE") return json(204);
		return json(404, { error: "not_found" });
	};

	const incident = (): IncidentRow | undefined => {
		if (s.openAfter === undefined || polls < s.openAfter) return undefined;
		const closed =
			fixedAtPoll !== undefined &&
			s.closeAfter !== undefined &&
			polls >= fixedAtPoll + s.closeAfter;
		return {
			linkId: "L1",
			openedAt,
			state: closed ? "closed" : "open",
		};
	};
	const mails = (): MailRow[] => {
		const out: MailRow[] = [];
		if (s.downMailAfter !== undefined && polls >= s.downMailAfter)
			out.push({
				kind: "down",
				to: "helen@wootech.co",
				status: s.downMailStatus ?? "sent",
				sentAt: new Date(
					Date.parse(openedAt) + (s.downMailDelayS ?? 300) * 1000,
				).toISOString(),
			});
		if (
			fixedAtPoll !== undefined &&
			s.recoveryMailAfter !== undefined &&
			polls >= fixedAtPoll + s.recoveryMailAfter
		)
			out.push({
				kind: "recovery",
				to: "helen@wootech.co",
				status: "sent",
				sentAt: openedAt,
			});
		return out;
	};

	let t = 0;
	const opts: IncidentSmokeOptions = {
		baseUrl: "https://watch.hueai.net/",
		token: "tok",
		runId: "run1",
		recipient: "Helen@wootech.co",
		fetch: fetch as typeof globalThis.fetch,
		store: {
			latestIncident: async () => incident(),
			mails: async () => mails(),
		},
		site: {
			put: async (key) => {
				uploads.push(key);
				fixedAtPoll = polls;
			},
			remove: async (key) => {
				removed.push(key);
			},
		},
		pollMs: 60_000,
		sleep: async (ms) => {
			t += ms;
			polls++;
		},
		now: () => t,
	};
	return { opts, calls, uploads, removed };
}

describe("incident smoke test (step 40b)", () => {
	it("AC-04 + AC-07: incident, email, fix, recovery email; then cleans up", async () => {
		const w = fakeWorld({
			openAfter: 3,
			downMailAfter: 5,
			closeAfter: 2,
			recoveryMailAfter: 3,
		});
		const report = await runIncidentSmoke(w.opts);
		expect(report.failures).toEqual([]);
		expect(report.ok).toBe(true);
		expect(w.uploads).toEqual(["smoke/run1.txt"]);
		expect(w.removed).toEqual(["smoke/run1.txt"]);
		expect(w.calls).toContain("DELETE /api/links/L1");
		expect(w.calls).toContain(
			"DELETE /api/recipients?scope=DOMAIN&target=hueai.net&email=Helen%40wootech.co",
		);
		expect(w.calls[0]).toBe("POST /api/recipients");
		expect(w.calls[1]).toBe("POST /api/links");
	});

	it("FR-20: a domain that does not exist yet gets the recipient right after the link is added", async () => {
		const w = fakeWorld({
			domainExists: false,
			openAfter: 1,
			downMailAfter: 1,
			closeAfter: 1,
			recoveryMailAfter: 1,
		});
		const report = await runIncidentSmoke(w.opts);
		expect(report.ok).toBe(true);
		expect(w.calls.slice(0, 3)).toEqual([
			"POST /api/recipients",
			"POST /api/links",
			"POST /api/recipients",
		]);
	});

	it("5.2: no incident within the timeout → fails, does not touch the bucket, deletes the link", async () => {
		const w = fakeWorld({});
		const report = await runIncidentSmoke({
			...w.opts,
			openTimeoutMs: 180_000,
		});
		expect(report.ok).toBe(false);
		expect(report.failures).toEqual([
			expect.stringContaining("incident opened after two failed checks"),
		]);
		expect(w.uploads).toEqual([]);
		expect(w.calls).toContain("DELETE /api/links/L1");
	});

	it("FR-25: an email logged as failed fails the run", async () => {
		const w = fakeWorld({
			openAfter: 0,
			downMailAfter: 0,
			downMailStatus: "failed",
			closeAfter: 0,
			recoveryMailAfter: 0,
		});
		const report = await runIncidentSmoke(w.opts);
		expect(report.failures).toEqual([
			"incident email status: expected sent, got failed",
		]);
	});

	it("AC-04: an incident email later than 5 minutes (+1 min slack) fails the run", async () => {
		const w = fakeWorld({
			openAfter: 0,
			downMailAfter: 0,
			downMailDelayS: 7 * 60,
			closeAfter: 0,
			recoveryMailAfter: 0,
		});
		const report = await runIncidentSmoke(w.opts);
		expect(report.failures).toEqual([
			expect.stringContaining("expected ≤ 5 min"),
		]);
	});

	it("AC-07: no recovery email → fails, still removes the uploaded object", async () => {
		const w = fakeWorld({ openAfter: 0, downMailAfter: 0, closeAfter: 1 });
		const report = await runIncidentSmoke({
			...w.opts,
			mailTimeoutMs: 120_000,
		});
		expect(report.ok).toBe(false);
		expect(report.failures).toEqual([
			expect.stringContaining("recovery email"),
		]);
		expect(w.removed).toEqual(["smoke/run1.txt"]);
	});

	it("FR-41 / FR-37: recover by claim → reports fixed after the upload, incident closed by the smoke user", async () => {
		const w = fakeWorld({
			openAfter: 0,
			downMailAfter: 0,
			closeAfter: 1,
			recoveryMailAfter: 1,
			closedBy: "smoke@watch.hueai.net",
		});
		const report = await runIncidentSmoke({ ...w.opts, recover: "claim" });
		expect(report.failures).toEqual([]);
		const claim = w.calls.indexOf("POST /api/incidents/resolve-claim");
		expect(claim).toBeGreaterThan(-1);
		expect(w.calls).toContain(
			"GET /api/incidents/L1%402026-09-30T00%3A04%3A00.000Z",
		);
	});

	it("FR-37: closed without closedBy (not by the claim) → fails", async () => {
		const w = fakeWorld({
			openAfter: 0,
			downMailAfter: 0,
			closeAfter: 1,
			recoveryMailAfter: 1,
		});
		const report = await runIncidentSmoke({ ...w.opts, recover: "claim" });
		expect(report.failures).toEqual([
			expect.stringContaining("expected closedBy and a fixed claim"),
		]);
	});

	it("FR-41: claim not started → fails, still cleans up", async () => {
		const w = fakeWorld({
			openAfter: 0,
			downMailAfter: 0,
			claimDecision: "in_progress",
		});
		const report = await runIncidentSmoke({ ...w.opts, recover: "claim" });
		expect(report.failures).toEqual([
			expect.stringContaining("expected 200 started"),
		]);
		expect(w.removed).toEqual(["smoke/run1.txt"]);
		expect(w.calls).toContain("DELETE /api/links/L1");
	});
});
