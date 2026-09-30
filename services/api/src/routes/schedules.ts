import type { Db } from "@linkwatch/core/db";
import {
	createSchedule,
	deleteSchedule,
	listSchedules,
	updateSchedule,
} from "@linkwatch/core/usecases";
import { Hono } from "hono";

/** FR-11 / FR-12: schedule templates (the "default" one is the system default schedule). */
export function scheduleRoutes(db: Db) {
	return new Hono()
		.get("/", async (c) => c.json({ items: await listSchedules(db) }))
		.post("/", async (c) =>
			c.json(await createSchedule(db, await c.req.json()), 201),
		)
		.patch("/:id", async (c) =>
			c.json(await updateSchedule(db, c.req.param("id"), await c.req.json())),
		)
		.delete("/:id", async (c) => {
			await deleteSchedule(db, c.req.param("id"));
			return c.body(null, 204);
		});
}
