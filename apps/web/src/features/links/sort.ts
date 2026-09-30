import type { LinkStatus, LinkView } from "@linkwatch/core";

export type SortKey =
	| "url"
	| "status"
	| "domain"
	| "http"
	| "responseTime"
	| "lastChecked"
	| "added";
export type SortDir = "asc" | "desc";
/** null = API order (newest link first). */
export type SortState = { key: SortKey; dir: SortDir } | null;

/**
 * Direction of the first click on each column — the most useful view first:
 * text A→Z, status worst first, HTTP highest code (errors) first, slowest first, newest first.
 */
export const FIRST_DIR: Record<SortKey, SortDir> = {
	url: "asc",
	status: "asc",
	domain: "asc",
	http: "desc",
	responseTime: "desc",
	lastChecked: "desc",
	added: "desc",
};

/** FR-09 severity: ascending = worst first. */
const STATUS_RANK: Record<LinkStatus, number> = {
	down: 0,
	dead: 1,
	suspect: 2,
	slow: 3,
	up: 4,
	pending: 5,
};

const collator = new Intl.Collator("en", {
	sensitivity: "base",
	numeric: true,
});

/** Value compared for each column; undefined = no value ("—"). */
function sortValue(link: LinkView, key: SortKey): string | number | undefined {
	switch (key) {
		case "url":
			return link.url;
		case "status":
			return STATUS_RANK[link.status];
		case "domain":
			return link.domain;
		case "http":
			return link.lastHttpCode;
		case "responseTime":
			return link.lastResponseMs;
		case "lastChecked":
			return link.lastCheckedAt ? Date.parse(link.lastCheckedAt) : undefined;
		case "added":
			return Date.parse(link.createdAt);
	}
}

/**
 * Sorts a copy of the links. Links without a value always go last, whatever the direction;
 * ties keep the API order (stable sort).
 */
export function sortLinks(
	links: readonly LinkView[],
	sort: SortState,
): LinkView[] {
	if (!sort) return [...links];
	const sign = sort.dir === "asc" ? 1 : -1;
	return [...links].sort((a, b) => {
		const va = sortValue(a, sort.key);
		const vb = sortValue(b, sort.key);
		if (va === undefined || vb === undefined)
			return va === vb ? 0 : va === undefined ? 1 : -1;
		const cmp =
			typeof va === "number" && typeof vb === "number"
				? va - vb
				: collator.compare(String(va), String(vb));
		return sign * cmp;
	});
}

/** Header click: first direction → opposite direction → back to the API order. */
export function nextSort(current: SortState, key: SortKey): SortState {
	if (current?.key !== key) return { key, dir: FIRST_DIR[key] };
	if (current.dir === FIRST_DIR[key])
		return { key, dir: current.dir === "asc" ? "desc" : "asc" };
	return null;
}
