import { ResolveClaimInput } from "@linkwatch/core";
import type { Db } from "@linkwatch/core/db";
import {
	acknowledgeIncident,
	getIncident,
	listIncidents,
	type SendPriorityJob,
	submitClaim,
} from "@linkwatch/core/usecases";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables } from "../middleware/auth";

const ListQuery = z.object({
	state: z.enum(["active", "closed"]).default("active"),
	limit: z.coerce.number().int().min(1).max(100).default(50),
	cursor: z.string().min(1).optional(),
});

/** FR-19: incidents list, detail with the emails sent, Acknowledge + note. Ids are URL-encoded `<linkId>@<openedAt>`. */
export function incidentRoutes(db: Db, sendPriorityJob?: SendPriorityJob) {
	return (
		new Hono<{ Variables: AuthVariables }>()
			// FR-41: report one or several incidents as fixed from the app (signed-in user).
			.post("/resolve-claim", async (c) => {
				if (!sendPriorityJob)
					return c.json({ error: "check_now_unavailable" }, 503);
				const input = ResolveClaimInput.parse(await c.req.json());
				return c.json({
					items: await submitClaim(
						db,
						{
							incidentIds: input.incidentIds,
							byEmail: c.get("user").email,
							channel: "app",
							...(input.note && { note: input.note }),
						},
						{ send: sendPriorityJob },
					),
				});
			})
			.get("/", async (c) =>
				c.json(await listIncidents(db, ListQuery.parse(c.req.query()))),
			)
			.get("/:id", async (c) =>
				c.json(await getIncident(db, c.req.param("id"))),
			)
			.post("/:id/ack", async (c) => {
				const raw = await c.req.text();
				return c.json(
					await acknowledgeIncident(
						db,
						c.req.param("id"),
						raw ? JSON.parse(raw) : {},
						{
							by: c.get("user").email,
						},
					),
				);
			})
	);
}
