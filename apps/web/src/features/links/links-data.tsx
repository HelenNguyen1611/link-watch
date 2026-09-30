"use client";

import type { LinkView } from "@linkwatch/core";
import { useQuery } from "@tanstack/react-query";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useApi } from "@/lib/api-context";
import { mergeOverrides, type Override, pruneOverrides } from "./overlay";
import {
	FAST_REFRESH_MS,
	isWaitingForResult,
	SLOW_REFRESH_MS,
} from "./refresh";

/** The Checker writes results into the snapshot within one tick: reload it every 5 minutes. */
export const SNAPSHOT_REFRESH_MS = SLOW_REFRESH_MS;
/** POST /api/links/fresh takes at most 100 keys. */
const MAX_FRESH = 100;

export type LinksData = {
	rows: LinkView[];
	isPending: boolean;
	error: unknown;
	isFetching: boolean;
	/** Epoch ms of the last successful load (snapshot or fresh rows). */
	updatedAt: number;
	/** Some active link waits for a check result → rows are re-read every 30 s. */
	waiting: boolean;
	refresh: () => void;
	/** A row the screen just created, edited or re-read. */
	upsert: (row: LinkView) => void;
	remove: (id: string) => void;
	/** Same change on several rows (bulk pause / resume). */
	patchMany: (ids: readonly string[], patch: Partial<LinkView>) => void;
};

const LinksDataContext = createContext<LinksData | null>(null);

/** Inside the links page; `null` elsewhere (components then fall back to invalidating queries). */
export const useLinksData = () => useContext(LinksDataContext);

const same = (a: LinkView, b: LinkView) =>
	a.status === b.status &&
	a.lastCheckedAt === b.lastCheckedAt &&
	a.paused === b.paused &&
	a.url === b.url;

/**
 * Step 19b (option 2): list rows = snapshot (rebuilt every 5 min by the Dispatcher) + changes
 * the screen already knows (created / edited / deleted / re-read rows). Links waiting for a
 * result (Pending, Suspect) are re-read by key every 30 s — cheap point reads, not a full list.
 */
export function LinksDataProvider({ children }: { children: ReactNode }) {
	const api = useApi();
	const snapshot = useQuery({
		queryKey: ["links", "snapshot"],
		queryFn: () => api.getSnapshot(),
		refetchInterval: SNAPSHOT_REFRESH_MS,
	});
	const [overrides, setOverrides] = useState<Map<string, Override>>(new Map());
	const generatedAt = snapshot.data?.generatedAt;

	useEffect(() => {
		setOverrides((o) => pruneOverrides(o, generatedAt));
	}, [generatedAt]);

	const rows = useMemo(
		() => mergeOverrides(snapshot.data?.items ?? [], generatedAt, overrides),
		[snapshot.data, generatedAt, overrides],
	);

	const waitingKeys = useMemo(
		() =>
			rows
				.filter((l) => isWaitingForResult([l]))
				.slice(0, MAX_FRESH)
				.map((l) => ({ domain: l.domain, id: l.id })),
		[rows],
	);
	const fresh = useQuery({
		queryKey: ["links", "fresh", waitingKeys.map((k) => k.id).join(",")],
		queryFn: () => api.freshLinks(waitingKeys),
		enabled: waitingKeys.length > 0,
		refetchInterval: FAST_REFRESH_MS,
	});

	const upsert = useCallback((row: LinkView) => {
		setOverrides((o) => new Map(o).set(row.id, { row, at: Date.now() }));
	}, []);
	const remove = useCallback((id: string) => {
		setOverrides((o) => new Map(o).set(id, { row: null, at: Date.now() }));
	}, []);

	// Latest rows for the effect below, which must only run when fresh rows arrive.
	const rowsRef = useRef(rows);
	rowsRef.current = rows;
	useEffect(() => {
		const byId = new Map(rowsRef.current.map((r) => [r.id, r]));
		const changed = (fresh.data?.items ?? []).filter((r) => {
			const current = byId.get(r.id);
			return !current || !same(current, r);
		});
		if (changed.length === 0) return;
		setOverrides((o) => {
			const next = new Map(o);
			for (const r of changed) next.set(r.id, { row: r, at: Date.now() });
			return next;
		});
	}, [fresh.data]);

	const patchMany = useCallback(
		(ids: readonly string[], patch: Partial<LinkView>) => {
			const byId = new Map(rows.map((r) => [r.id, r]));
			setOverrides((o) => {
				const next = new Map(o);
				for (const id of ids) {
					const row = byId.get(id);
					if (row) next.set(id, { row: { ...row, ...patch }, at: Date.now() });
				}
				return next;
			});
		},
		[rows],
	);

	const value: LinksData = {
		rows,
		isPending: snapshot.isPending,
		error: snapshot.error,
		isFetching: snapshot.isFetching || fresh.isFetching,
		updatedAt: Math.max(snapshot.dataUpdatedAt, fresh.dataUpdatedAt),
		waiting: waitingKeys.length > 0,
		refresh: () => {
			void snapshot.refetch();
			if (waitingKeys.length > 0) void fresh.refetch();
		},
		upsert,
		remove,
		patchMany,
	};
	return (
		<LinksDataContext.Provider value={value}>
			{children}
		</LinksDataContext.Provider>
	);
}
