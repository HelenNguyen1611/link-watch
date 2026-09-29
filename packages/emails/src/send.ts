import { type SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

/** FR-25: retry 3 times after the first attempt. */
export const MAX_RETRIES = 3;

/** SES errors that will not succeed on retry. */
const PERMANENT = new Set([
	"MessageRejected",
	"MailFromDomainNotVerifiedException",
	"NotFoundException",
	"BadRequestException",
	"AccountSuspendedException",
	"SendingPausedException",
]);

export type OutgoingEmail = {
	from: string;
	to: string;
	subject: string;
	html: string;
	text: string;
};

export type SendResult =
	| { status: "sent"; retries: number; messageId?: string }
	| { status: "failed"; retries: number; error: string };

export type SendDeps = {
	ses: SESv2Client;
	/** Backoff between attempts; tests pass a no-op. */
	sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

/** FR-25: sends one email through SES v2, retrying transient errors up to 3 times. */
export async function sendEmail(
	deps: SendDeps,
	email: OutgoingEmail,
): Promise<SendResult> {
	const sleep = deps.sleep ?? defaultSleep;
	let lastError = "";
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		if (attempt > 0) await sleep(200 * 2 ** attempt);
		try {
			const res = await deps.ses.send(
				new SendEmailCommand({
					FromEmailAddress: email.from,
					Destination: { ToAddresses: [email.to] },
					Content: {
						Simple: {
							Subject: { Data: email.subject, Charset: "UTF-8" },
							Body: {
								Html: { Data: email.html, Charset: "UTF-8" },
								Text: { Data: email.text, Charset: "UTF-8" },
							},
						},
					},
				}),
			);
			return {
				status: "sent",
				retries: attempt,
				...(res.MessageId && { messageId: res.MessageId }),
			};
		} catch (err) {
			const name = (err as { name?: string }).name ?? "Error";
			lastError = `${name}: ${(err as Error).message ?? String(err)}`;
			if (PERMANENT.has(name))
				return { status: "failed", retries: attempt, error: lastError };
		}
	}
	return { status: "failed", retries: MAX_RETRIES, error: lastError };
}
