import type { Db } from "@linkwatch/core/db";
import { getDomainRow, updateDomain } from "@linkwatch/core/usecases";
import { Hono } from "hono";

/** FR-08 / FR-13 / SRS 3.4: one domain and its settings. The overview list comes with step 20b-2. */
export function domainRoutes(db: Db) {
	return new Hono()
		.get("/:name", async (c) =>
			c.json(await getDomainRow(db, c.req.param("name"))),
		)
		.patch("/:name", async (c) =>
			c.json(await updateDomain(db, c.req.param("name"), await c.req.json())),
		);
}
