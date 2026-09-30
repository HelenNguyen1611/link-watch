import { type LinkPage, toLinkView } from "@linkwatch/core";
import type { Db } from "@linkwatch/core/db";
import {
	checkNow,
	createLink,
	deleteLink,
	getLink,
	linkChecks,
	linkIncidents,
	linkUptime,
	listLinks,
	type SendPriorityJob,
} from "@linkwatch/core/usecases";
import { Hono } from "hono";
import { z } from "zod";

const ListQuery = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(50),
	cursor: z.string().min(1).optional(),
});

const ChecksQuery = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(100),
});
const UptimeQuery = z.object({
	days: z.coerce.number().int().min(1).max(90).default(30),
});

/**
 * Add, list, delete links (FR-01, FR-02, FR-04); one link, its checks, uptime and incidents
 * (FR-17, FR-18); Check now (FR-16). Edit/pause/bulk/import come in step 19b.
 * `sendPriorityJob` is undefined when no priority queue is configured (local API).
 */
export function linkRoutes(db: Db, sendPriorityJob?: SendPriorityJob) {
	return new Hono()
		.post("/check-now", async (c) => {
			if (!sendPriorityJob)
				return c.json(
					{
						error: "check_now_unavailable",
						message: "No priority queue configured (local API)",
					},
					503,
				);
			return c.json(
				await checkNow(db, await c.req.json(), { send: sendPriorityJob }),
				202,
			);
		})
		.get("/:id", async (c) =>
			c.json(toLinkView(await getLink(db, c.req.param("id")))),
		)
		.get("/:id/checks", async (c) => {
			const { limit } = ChecksQuery.parse(c.req.query());
			return c.json({ items: await linkChecks(db, c.req.param("id"), limit) });
		})
		.get("/:id/uptime", async (c) => {
			const { days } = UptimeQuery.parse(c.req.query());
			return c.json(await linkUptime(db, c.req.param("id"), { days }));
		})
		.get("/:id/incidents", async (c) =>
			c.json({ items: await linkIncidents(db, c.req.param("id")) }),
		)
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
