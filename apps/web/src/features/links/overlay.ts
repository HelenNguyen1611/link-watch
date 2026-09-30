import type { LinkView } from "@linkwatch/core";

/**
 * A change the screen already knows about but the snapshot (≤ 5 min old) may not contain yet:
 * a new or edited row, or `null` for a deleted link. `at` = when the change was seen (epoch ms).
 */
export type Override = { row: LinkView | null; at: number };
export type Overrides = ReadonlyMap<string, Override>;

/**
 * Step 19b: snapshot rows with the overrides applied. An override older than the snapshot is
 * already included in it and is ignored. New links (not in the snapshot) come first, newest first.
 */
export function mergeOverrides(
	items: readonly LinkView[],
	generatedAt: string | undefined,
	overrides: Overrides,
): LinkView[] {
	const snapshotAt = generatedAt ? Date.parse(generatedAt) : 0;
	const live = new Map([...overrides].filter(([, o]) => o.at >= snapshotAt));
	const known = new Set(items.map((l) => l.id));
	const added = [...live.values()]
		.map((o) => o.row)
		.filter((r): r is LinkView => r !== null && !known.has(r.id))
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	const merged = items.flatMap((l) => {
		const o = live.get(l.id);
		if (!o) return [l];
		return o.row ? [o.row] : [];
	});
	return [...added, ...merged];
}

/** Overrides still newer than the snapshot (the others can be dropped). */
export function pruneOverrides(
	overrides: Overrides,
	generatedAt: string | undefined,
): Map<string, Override> {
	const snapshotAt = generatedAt ? Date.parse(generatedAt) : 0;
	return new Map([...overrides].filter(([, o]) => o.at >= snapshotAt));
}
