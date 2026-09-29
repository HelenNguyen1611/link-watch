import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Entity } from "electrodb";
import { DEFAULT_REMINDER_INTERVAL_MS } from "../../notify";

const now = () => new Date().toISOString();

/** FR-23: default reminder interval in hours. */
export const DEFAULT_REMINDER_INTERVAL_HOURS =
	DEFAULT_REMINDER_INTERVAL_MS / (60 * 60_000);

/**
 * FR-20, FR-23, FR-26: system-wide email settings — a single item, PK SETTINGS, SK META.
 * The item may not exist yet (fresh install): callers fall back to the attribute defaults.
 */
export function settingsEntity(client: DynamoDBDocumentClient, table: string) {
	return new Entity(
		{
			model: { entity: "settings", version: "1", service: "linkwatch" },
			attributes: {
				/** FR-26: sender address, must be verified on SES. */
				senderEmail: { type: "string" },
				senderName: { type: "string", default: "LinkWatch" },
				/** FR-20: used when a link and its domain have no recipients. */
				defaultAdminEmail: { type: "string" },
				/** FR-23: reminders for unacknowledged open incidents. */
				remindersEnabled: { type: "boolean", default: true },
				reminderIntervalHours: {
					type: "number",
					default: DEFAULT_REMINDER_INTERVAL_HOURS,
					validate: (h) => Number.isFinite(h) && h > 0,
				},
				updatedAt: { type: "string", watch: "*", set: now, default: now },
			},
			indexes: {
				primary: {
					pk: {
						field: "pk",
						composite: [],
						template: "SETTINGS",
						casing: "none",
					},
					sk: { field: "sk", composite: [], template: "META", casing: "none" },
				},
			},
		},
		{ client, table },
	);
}
