export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 50;

export type Page<T> = {
	rows: T[];
	/** 1-based page actually shown (clamped when the list shrank). */
	page: number;
	pages: number;
	/** 1-based index of the first and last row shown; 0 when empty. */
	from: number;
	to: number;
	total: number;
};

/** Client-side pagination; a page past the end shows the last page. */
export function paginate<T>(
	rows: readonly T[],
	page: number,
	size: number,
): Page<T> {
	const total = rows.length;
	const pages = Math.max(1, Math.ceil(total / size));
	const current = Math.min(Math.max(1, Math.floor(page)), pages);
	const start = (current - 1) * size;
	const slice = rows.slice(start, start + size);
	return {
		rows: slice,
		page: current,
		pages,
		from: total === 0 ? 0 : start + 1,
		to: start + slice.length,
		total,
	};
}
