import type { SESv2Client } from "@aws-sdk/client-sesv2";
import { groupByRecipient, incidentId } from "@linkwatch/core";
import type { Db, NotificationLogKind } from "@linkwatch/core/db";
import {
	claimOutageNotice,
	findRecentOutage,
	loadIncidents,
	type OutboxGroupKey,
	recipientsForLink,
	takeOutbox,
} from "@linkwatch/core/usecases";
import {
	type IncidentItem,
	type RecoveryItem,
	type RenderedEmail,
	renderIncidentEmail,
	renderOutageEmail,
	renderRecoveryEmail,
} from "@linkwatch/emails";
import { type SendResult, sendEmail } from "./send";

export type AlertConfig = {
	/** Base URL of the web app, used for incident links. */
	appUrl: string;
	/** FR-26 fallbacks when Settings has no value yet (from infra config). */
	defaultSenderEmail: string;
	defaultAdminEmail?: string;
};

export type AlertDeps = {
	db: Db;
	ses: SESv2Client;
	config: AlertConfig;
	sleep?: (ms: number) => Promise<void>;
	log?: (message: string, extra?: Record<string, unknown>) => void;
};

export type Incident = Awaited<ReturnType<typeof loadIncidents>>[number];
export type Sender = { from: string; adminEmail?: string };

/** FR-26: sender and default admin from Settings, falling back to the infra config. */
export async function resolveSender(deps: AlertDeps): Promise<Sender> {
	const { data } = await deps.db.Settings.get({}).go();
	const email = data?.senderEmail ?? deps.config.defaultSenderEmail;
	const name = data?.senderName ?? "LinkWatch";
	const adminEmail = data?.defaultAdminEmail ?? deps.config.defaultAdminEmail;
	return {
		from: `"${name.replaceAll('"', "")}" <${email}>`,
		...(adminEmail && { adminEmail }),
	};
}

const idOf = (i: Incident) => incidentId(i.linkId, i.openedAt);

export const toIncidentItem = (i: Incident): IncidentItem => ({
	incidentId: idOf(i),
	url: i.url,
	type: i.type,
	...(i.errorType && { errorType: i.errorType as IncidentItem["errorType"] }),
	...(i.httpCode !== undefined && { httpCode: i.httpCode }),
	detectedAt: i.openedAt,
});

const toRecoveryItem = (i: Incident): RecoveryItem => ({
	incidentId: idOf(i),
	url: i.url,
	recoveredAt: i.closedAt ?? i.openedAt,
	downtimeMs: i.downtimeMs ?? 0,
});

/**
 * FR-20 + FR-22: sends one email per recipient listing only their incidents,
 * logs every attempt (FR-25) and returns the incidents that reached at least one recipient.
 */
export async function sendGrouped(
	deps: AlertDeps,
	sender: Sender,
	incidents: Incident[],
	kind: NotificationLogKind,
	render: (items: Incident[]) => Promise<RenderedEmail>,
	now: Date,
): Promise<Incident[]> {
	const recipients = new Map<string, string[]>();
	for (const i of incidents)
		if (!recipients.has(i.linkId))
			recipients.set(
				i.linkId,
				await recipientsForLink(deps.db, i, sender.adminEmail),
			);

	const byRecipient = groupByRecipient(
		incidents,
		(i) => recipients.get(i.linkId) ?? [],
	);
	if (byRecipient.size === 0)
		deps.log?.("No recipients", { incidents: incidents.map(idOf) });

	const delivered = new Set<string>();
	const sentAt = now.toISOString();
	for (const [to, items] of byRecipient) {
		const email = await render(items);
		const result = await sendEmail(
			{ ses: deps.ses, ...(deps.sleep && { sleep: deps.sleep }) },
			{ from: sender.from, to, ...email },
		);
		await logNotification(deps, items, { to, kind, sentAt, result, email });
		if (result.status === "sent") for (const i of items) delivered.add(idOf(i));
		else deps.log?.("Email failed", { to, error: result.error });
	}
	return incidents.filter((i) => delivered.has(idOf(i)));
}

/** FR-25: one MAIL# row per incident listed in the email. */
async function logNotification(
	deps: AlertDeps,
	items: Incident[],
	row: {
		to: string;
		kind: NotificationLogKind;
		sentAt: string;
		result: SendResult;
		email: RenderedEmail;
	},
): Promise<void> {
	const { result } = row;
	await deps.db.Notification.put(
		items.map((i) => ({
			incidentId: idOf(i),
			sentAt: row.sentAt,
			to: row.to,
			kind: row.kind,
			status: result.status,
			retries: result.retries,
			subject: row.email.subject,
			...(result.status === "sent" && result.messageId
				? { messageId: result.messageId }
				: {}),
			...(result.status === "failed" && { error: result.error }),
		})),
	).go();
}

/**
 * PLAN Q3 + FR-21/22: flushes the outbox of one domain and kind.
 * - down: incidents still not closed and not notified yet; suppressed during a
 *   system-wide outage (5.2 step 5), where the admin gets one email per run instead.
 * - recovery: closed incidents whose incident email went out and whose recovery email has not.
 */
export async function flushOutbox(
	deps: AlertDeps,
	key: OutboxGroupKey,
	now: Date,
): Promise<void> {
	const taken = await takeOutbox(deps.db, key);
	const incidents = await loadIncidents(deps.db, taken.incidentIds);
	const sender = await resolveSender(deps);

	if (key.kind === "down") {
		const pending = incidents.filter(
			(i) => i.state !== "closed" && !i.downNotifiedAt,
		);
		if (pending.length > 0) {
			const outage = await findRecentOutage(deps.db, now);
			if (outage) {
				await notifyOutage(deps, sender, outage, now);
				deps.log?.("Domain emails suppressed (system-wide outage)", {
					domain: key.domain,
					incidents: pending.length,
				});
			} else {
				const delivered = await sendGrouped(
					deps,
					sender,
					pending,
					"down",
					(items) =>
						renderIncidentEmail({
							domain: key.domain,
							appUrl: deps.config.appUrl,
							items: items.map(toIncidentItem),
						}),
					now,
				);
				await markIncidents(deps, delivered, {
					downNotifiedAt: now.toISOString(),
				});
			}
		}
	} else {
		const pending = incidents.filter(
			(i) => i.state === "closed" && i.downNotifiedAt && !i.recoveryNotifiedAt,
		);
		if (pending.length > 0) {
			const delivered = await sendGrouped(
				deps,
				sender,
				pending,
				"recovery",
				(items) =>
					renderRecoveryEmail({
						domain: key.domain,
						appUrl: deps.config.appUrl,
						items: items.map(toRecoveryItem),
					}),
				now,
			);
			await markIncidents(deps, delivered, {
				recoveryNotifiedAt: now.toISOString(),
			});
		}
	}
	await taken.done();
}

export async function markIncidents(
	deps: AlertDeps,
	incidents: Incident[],
	set:
		| { downNotifiedAt: string }
		| { recoveryNotifiedAt: string }
		| { lastReminderAt: string },
): Promise<void> {
	await Promise.all(
		incidents.map((i) =>
			deps.db.Incident.patch({ linkId: i.linkId, openedAt: i.openedAt })
				.set(set)
				.go(),
		),
	);
}

/** 5.2 step 5: one admin email per outage run (claimed with a conditional write). */
async function notifyOutage(
	deps: AlertDeps,
	sender: Sender,
	outage: { dispatchedAt: string; checked: number; failed: number },
	now: Date,
): Promise<void> {
	if (!sender.adminEmail) {
		deps.log?.("System-wide outage but no admin email configured", outage);
		return;
	}
	if (!(await claimOutageNotice(deps.db, outage.dispatchedAt, now))) return;
	const email = await renderOutageEmail(outage);
	const result = await sendEmail(
		{ ses: deps.ses, ...(deps.sleep && { sleep: deps.sleep }) },
		{ from: sender.from, to: sender.adminEmail, ...email },
	);
	deps.log?.("Outage notice", { ...outage, status: result.status });
}
