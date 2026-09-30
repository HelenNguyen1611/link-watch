import type { Db } from "../db/index";
import type { DomainUptime } from "../domain-summary";
import { type LinkView, toLinkView } from "../schema/link-view";
import { summarizeUptime } from "../uptime";
import { listAllLinks } from "./links";

/** FR-10: domain uptime changes slowly — recomputed at most once an hour. */
export const UPTIME_REFRESH_MS = 60 * 60_000;

export type DomainUptimeCache = {
	generatedAt: string;
	byDomain: Record<string, DomainUptime>;
};

/** Object key of the links snapshot in the snapshot bucket. */
export const LINK_SNAPSHOT_KEY = "links/snapshot.json";

/**
 * Step 19b (option 2, decided 30/09/2026): every link as shown in the list, rebuilt after each
 * Dispatcher tick. The web sorts / filters / pages it client-side and overlays fresh rows.
 */
export type LinkSnapshot = {
	generatedAt: string;
	items: LinkView[];
	/** false when built on the fly because no stored snapshot exists yet. */
	stored: boolean;
	/** FR-10 / NFR-02: uptime 7/30 days per domain (DomainDayStat), refreshed hourly. */
	uptime?: DomainUptimeCache;
};

/** Where the snapshot lives (S3 in AWS; tests use memory). */
export type SnapshotStore = {
	read: () => Promise<string | null>;
	write: (body: string) => Promise<void>;
};

export async function buildLinkSnapshot(
	db: Db,
	now: Date = new Date(),
): Promise<LinkSnapshot> {
	const links = await listAllLinks(db);
	return {
		generatedAt: now.toISOString(),
		items: links.map(toLinkView),
		stored: true,
	};
}

/** FR-10: uptime 7/30 days of every domain from its daily counters (≤ 30 items per domain). */
export async function computeDomainUptime(
	db: Db,
	now: Date,
): Promise<DomainUptimeCache> {
	const { data: domains } = await db.Domain.query.all({}).go({ pages: "all" });
	const byDomain: Record<string, DomainUptime> = {};
	for (const d of domains) {
		const { data } = await db.DomainDayStat.query
			.primary({ domain: d.name })
			.gte({
				day: new Date(now.getTime() - 31 * 86_400_000)
					.toISOString()
					.slice(0, 10),
			})
			.go({ pages: "all" });
		const u7 = summarizeUptime(data, now, 7).uptimePct;
		const u30 = summarizeUptime(data, now, 30).uptimePct;
		byDomain[d.name] = {
			...(u7 !== undefined && { uptime7: u7 }),
			...(u30 !== undefined && { uptime30: u30 }),
		};
	}
	return { generatedAt: now.toISOString(), byDomain };
}

/** Dispatcher: rebuild and store the snapshot. Returns the number of links. */
export async function refreshLinkSnapshot(
	db: Db,
	store: SnapshotStore,
	now: Date = new Date(),
): Promise<number> {
	const snapshot = await buildLinkSnapshot(db, now);
	const previous = await store
		.read()
		.then((b) => (b ? (JSON.parse(b) as LinkSnapshot) : null));
	const fresh =
		previous?.uptime &&
		now.getTime() - Date.parse(previous.uptime.generatedAt) < UPTIME_REFRESH_MS;
	snapshot.uptime =
		fresh && previous?.uptime
			? previous.uptime
			: await computeDomainUptime(db, now);
	await store.write(JSON.stringify(snapshot));
	return snapshot.items.length;
}

/** API: the stored snapshot, or one built on the fly when none is stored yet (or no store). */
export async function readLinkSnapshot(
	db: Db,
	store: SnapshotStore | undefined,
	now: Date = new Date(),
): Promise<LinkSnapshot> {
	const body = store ? await store.read() : null;
	if (body) return JSON.parse(body) as LinkSnapshot;
	const built = await buildLinkSnapshot(db, now);
	return {
		...built,
		stored: false,
		uptime: await computeDomainUptime(db, now),
	};
}
