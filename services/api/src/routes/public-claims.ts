import type { Db } from "@linkwatch/core/db";
import {
	readTokenClaim,
	type SendPriorityJob,
	submitTokenClaim,
} from "@linkwatch/core/usecases";
import { Hono } from "hono";
import { z } from "zod";

const SubmitInput = z
	.object({
		token: z.string().min(1).max(200),
		note: z.string().max(1000).optional(),
		incidentIds: z.array(z.string().min(1)).max(100).optional(),
	})
	.strict();

/**
 * FR-35 / FR-36 / FR-39 / FR-42: "Fixed — check again" through the email token, no sign-in.
 * GET only reads (link scanners, AC-11); POST starts the verification. Never cached.
 */
export function publicClaimRoutes(db: Db, sendPriorityJob?: SendPriorityJob) {
	return new Hono()
		.use("*", async (c, next) => {
			await next();
			c.header("Cache-Control", "no-store, max-age=0");
			c.header("Pragma", "no-cache");
			c.header("X-Robots-Tag", "noindex, nofollow");
		})
		.get("/", async (c) =>
			c.json(await readTokenClaim(db, c.req.query("token") ?? "")),
		)
		.post("/", async (c) => {
			if (!sendPriorityJob)
				return c.json({ error: "check_now_unavailable" }, 503);
			const input = SubmitInput.parse(await c.req.json());
			return c.json(
				await submitTokenClaim(db, input, { send: sendPriorityJob }),
			);
		});
}
