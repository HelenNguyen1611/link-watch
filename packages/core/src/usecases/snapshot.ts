import type { Db } from "../db/index";
import { type LinkView, toLinkView } from "../schema/link-view";
import { listAllLinks } from "./links";

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

/** Dispatcher: rebuild and store the snapshot. Returns the number of links. */
export async function refreshLinkSnapshot(
	db: Db,
	store: SnapshotStore,
	now: Date = new Date(),
): Promise<number> {
	const snapshot = await buildLinkSnapshot(db, now);
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
	return { ...(await buildLinkSnapshot(db, now)), stored: false };
}
