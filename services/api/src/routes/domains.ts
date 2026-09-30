import type { Db } from "@linkwatch/core/db";
import {
	getDomainDetail,
	listDomainSummaries,
	type SnapshotStore,
	updateDomain,
} from "@linkwatch/core/usecases";
import { Hono } from "hono";

/**
 * FR-08 / FR-09 / FR-10 / FR-13 / SRS 3.4: domain overview (from the links snapshot and the
 * hourly uptime cache, NFR-02), one domain with its 30-day uptime, and domain settings.
 */
export function domainRoutes(db: Db, snapshot?: SnapshotStore) {
	return new Hono()
		.get("/", async (c) => c.json(await listDomainSummaries(db, snapshot)))
		.get("/:name", async (c) =>
			c.json(await getDomainDetail(db, c.req.param("name"))),
		)
		.patch("/:name", async (c) => {
			await updateDomain(db, c.req.param("name"), await c.req.json());
			return c.json(await getDomainDetail(db, c.req.param("name")));
		});
}
