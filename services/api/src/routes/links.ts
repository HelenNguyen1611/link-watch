import { type LinkPage, toLinkView } from "@linkwatch/core";
import type { Db } from "@linkwatch/core/db";
import { createLink, deleteLink, listLinks } from "@linkwatch/core/usecases";
import { Hono } from "hono";
import { z } from "zod";

const ListQuery = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(50),
	cursor: z.string().min(1).optional(),
});

/** Milestone 1: add, list, delete links (FR-01, FR-02, FR-04). Edit/pause/filter come in step 19b. */
export function linkRoutes(db: Db) {
	return new Hono()
		.post("/", async (c) => {
			const link = await createLink(db, await c.req.json());
			return c.json(toLinkView(link), 201);
		})
		.get("/", async (c) => {
			const q = ListQuery.parse(c.req.query());
			const page = await listLinks(db, q);
			return c.json({
				items: page.items.map(toLinkView),
				cursor: page.cursor ?? null,
			} satisfies LinkPage);
		})
		.delete("/:id", async (c) => {
			await deleteLink(db, c.req.param("id"));
			return c.body(null, 204);
		});
}
