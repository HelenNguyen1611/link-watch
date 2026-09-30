import { LinkStatus, type LinkView } from "@linkwatch/core";
import { z } from "zod";

/** YYYY-MM-DD from <input type="date">, or "" when empty. */
const day = z.union([z.literal(""), z.iso.date()]);

/** Links table filters (UI only, applied to the links already loaded). */
export const LinkFilter = z
	.object({
		/** Part of the URL, domain or display name, case-insensitive. */
		q: z.string(),
		/** Empty = every status. */
		statuses: z.array(LinkStatus),
		/** FR-06: root domain; "" = every domain. */
		domain: z.string(),
		/** FR-06: links having any of these tags; empty = no tag filter. */
		tags: z.array(z.string()),
		/** FR-04: all links, only active ones or only paused ones. */
		paused: z.enum(["any", "active", "paused"]),
		/** Last check between these days (inclusive), in Asia/Saigon time. */
		checkedFrom: day,
		checkedTo: day,
	})
	.refine(
		(f) => !f.checkedFrom || !f.checkedTo || f.checkedFrom <= f.checkedTo,
		{
			path: ["checkedTo"],
			message: "dateRange",
		},
	);
export type LinkFilter = z.infer<typeof LinkFilter>;

export const EMPTY_FILTER: LinkFilter = {
	q: "",
	statuses: [],
	domain: "",
	tags: [],
	paused: "any",
	checkedFrom: "",
	checkedTo: "",
};

export const isFilterActive = (f: LinkFilter) =>
	f.q.trim() !== "" ||
	f.statuses.length > 0 ||
	f.domain !== "" ||
	f.tags.length > 0 ||
	f.paused !== "any" ||
	f.checkedFrom !== "" ||
	f.checkedTo !== "";

/** Start / end of a calendar day in Asia/Saigon (+07:00, no DST) as epoch ms. */
const dayStart = (d: string) => Date.parse(`${d}T00:00:00.000+07:00`);
const dayEnd = (d: string) => Date.parse(`${d}T23:59:59.999+07:00`);

/**
 * Keeps the links matching every filter. With a date bound, links never checked are
 * left out (they have no check time to compare).
 */
export function filterLinks(
	links: readonly LinkView[],
	filter: LinkFilter,
): LinkView[] {
	const q = filter.q.trim().toLowerCase();
	const statuses = new Set(filter.statuses);
	const from = filter.checkedFrom ? dayStart(filter.checkedFrom) : undefined;
	const to = filter.checkedTo ? dayEnd(filter.checkedTo) : undefined;
	return links.filter((l) => {
		if (
			q &&
			![l.url, l.domain, l.name ?? ""].some((v) => v.toLowerCase().includes(q))
		)
			return false;
		if (statuses.size > 0 && !statuses.has(l.status)) return false;
		if (filter.domain && l.domain !== filter.domain) return false;
		if (
			filter.tags.length > 0 &&
			!filter.tags.some((tag) => l.tags.includes(tag))
		)
			return false;
		if (filter.paused === "active" && l.paused) return false;
		if (filter.paused === "paused" && !l.paused) return false;
		if (from !== undefined || to !== undefined) {
			if (!l.lastCheckedAt) return false;
			const at = Date.parse(l.lastCheckedAt);
			if (from !== undefined && at < from) return false;
			if (to !== undefined && at > to) return false;
		}
		return true;
	});
}

/** Filter options found in the loaded links, sorted. */
export function filterOptions(links: readonly LinkView[]) {
	const domains = [...new Set(links.map((l) => l.domain))].sort();
	const tags = [...new Set(links.flatMap((l) => l.tags))].sort((a, b) =>
		a.localeCompare(b),
	);
	return { domains, tags };
}
