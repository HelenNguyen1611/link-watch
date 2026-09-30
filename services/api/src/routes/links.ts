import { type LinkPage, toLinkView } from "@linkwatch/core";
import type { Db } from "@linkwatch/core/db";
import {
	checkNow,
	commitImport,
	createLink,
	deleteLink,
	deleteLinks,
	getLink,
	getLinksByKeys,
	linkChecks,
	linkIncidents,
	linksToCsv,
	linkUptime,
	listAllLinks,
	listLinks,
	previewImport,
	type SendPriorityJob,
	setPaused,
	updateLink,
} from "@linkwatch/core/usecases";
import { Hono } from "hono";
import { z } from "zod";

const ListQuery = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(50),
	cursor: z.string().min(1).optional(),
});

const BulkInput = z
	.object({
		action: z.enum(["pause", "resume", "delete"]),
		ids: z.array(z.string()),
	})
	.strict();
const ImportInput = z.object({ text: z.string().max(2_000_000) }).strict();

const ChecksQuery = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(100),
});
const UptimeQuery = z.object({
	days: z.coerce.number().int().min(1).max(90).default(30),
});

/**
 * Links: add, list, edit, pause/resume, delete one or many (FR-01, FR-02, FR-04); import and
 * export CSV (FR-03, FR-05); one link, its checks, uptime and incidents (FR-17, FR-18); Check now (FR-16).
 * `sendPriorityJob` is undefined when no priority queue is configured (local API).
 */
export function linkRoutes(db: Db, sendPriorityJob?: SendPriorityJob) {
	return (
		new Hono()
			// FR-05: CSV export of every link with its current status.
			.get("/export.csv", async (c) => {
				const csv = linksToCsv(await listAllLinks(db));
				const day = new Date().toISOString().slice(0, 10);
				return c.body(csv, 200, {
					"content-type": "text/csv; charset=utf-8",
					"content-disposition": `attachment; filename="linkwatch-links-${day}.csv"`,
				});
			})
			// Step 19b: fresh rows for links the web is watching (overlay on the snapshot).
			.post("/fresh", async (c) =>
				c.json({
					items: (await getLinksByKeys(db, await c.req.json())).map(toLinkView),
				}),
			)
			// FR-04: pause / resume / delete up to 100 links.
			.post("/bulk", async (c) => {
				const { action, ids } = BulkInput.parse(await c.req.json());
				const result =
					action === "delete"
						? await deleteLinks(db, ids)
						: await setPaused(db, ids, action === "pause");
				return c.json(result);
			})
			// FR-03: preview (valid / duplicate / error per row), then commit ≤ 25 rows per call.
			.post("/import/preview", async (c) => {
				const { text } = ImportInput.parse(await c.req.json());
				return c.json(await previewImport(db, text));
			})
			.post("/import", async (c) => {
				const { text } = ImportInput.parse(await c.req.json());
				return c.json(await commitImport(db, text), 201);
			})
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
			// FR-04: partial edit.
			.patch("/:id", async (c) =>
				c.json(
					toLinkView(
						await updateLink(db, c.req.param("id"), await c.req.json()),
					),
				),
			)
			.get("/:id/checks", async (c) => {
				const { limit } = ChecksQuery.parse(c.req.query());
				return c.json({
					items: await linkChecks(db, c.req.param("id"), limit),
				});
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
			})
	);
}
