import type { Db } from "@linkwatch/core/db";
import {
	addRecipient,
	listRecipients,
	removeRecipient,
} from "@linkwatch/core/usecases";
import { Hono } from "hono";

/** FR-20: recipients of a domain or a link — `?scope=DOMAIN|LINK&target=<domain|linkId>`. */
export function recipientRoutes(db: Db) {
	return new Hono()
		.get("/", async (c) =>
			c.json({ items: await listRecipients(db, c.req.query()) }),
		)
		.post("/", async (c) =>
			c.json(await addRecipient(db, await c.req.json()), 201),
		)
		.delete("/", async (c) => {
			await removeRecipient(db, c.req.query());
			return c.body(null, 204);
		});
}
