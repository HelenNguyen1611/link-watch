import type { SESv2Client } from "@aws-sdk/client-sesv2";
import {
	effectiveSettings,
	fromHeader,
	isSenderAllowed,
	type SettingsDefaults,
	SettingsInput,
} from "@linkwatch/core";
import type { Db } from "@linkwatch/core/db";
import { renderTestEmail, sendEmail } from "@linkwatch/emails";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables } from "../middleware/auth";

export type EmailDeps = {
	ses: SESv2Client;
	/** FR-26: deployment defaults (SES identity, sender, admin) from infra config. */
	defaults: SettingsDefaults;
	sleep?: (ms: number) => Promise<void>;
};

const TestEmailInput = z
	.object({ to: z.string().trim().toLowerCase().pipe(z.email()) })
	.partial();

/** FR-20, FR-23, FR-26: SCR-08 email settings and the test email. */
export function settingsRoutes(db: Db, email: EmailDeps) {
	const current = async () =>
		effectiveSettings((await db.Settings.get({}).go()).data, email.defaults);

	return new Hono<{ Variables: AuthVariables }>()
		.get("/", async (c) => c.json(await current()))
		.patch("/", async (c) => {
			const input = SettingsInput.parse(await c.req.json());
			if (
				input.senderEmail &&
				!isSenderAllowed(input.senderEmail, email.defaults.sesIdentity)
			)
				return c.json(
					{
						error: "sender_not_verified",
						message: `The sender must be an address of ${email.defaults.sesIdentity}`,
					},
					400,
				);
			const { data } = await db.Settings.get({}).go();
			if (data) await db.Settings.patch({}).set(input).go();
			else await db.Settings.put(input).go();
			return c.json(await current());
		})
		.post("/test-email", async (c) => {
			const raw = await c.req.text();
			const { to } = TestEmailInput.parse(raw ? JSON.parse(raw) : {});
			const settings = await current();
			const recipient = to ?? c.get("user").email;
			const rendered = await renderTestEmail({
				sender: settings.senderEmail,
				requestedBy: c.get("user").email,
			});
			const result = await sendEmail(
				{ ses: email.ses, ...(email.sleep && { sleep: email.sleep }) },
				{ from: fromHeader(settings), to: recipient, ...rendered },
			);
			if (result.status === "failed")
				return c.json(
					{ status: "failed", to: recipient, error: result.error },
					502,
				);
			return c.json({ status: "sent", to: recipient });
		});
}
