import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Entity } from "electrodb";

/** FR-21: kinds of grouped email (reminders are not grouped). */
export const OUTBOX_KINDS = ["down", "recovery"] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];

/** Outbox rows are removed by the flush; the TTL only cleans up leftovers. */
const OUTBOX_TTL_S = 7 * 86_400;
const ttlFrom = (iso: string) =>
	Math.floor(Date.parse(iso) / 1000) + OUTBOX_TTL_S;

const outboxPk = {
	field: "pk",
	composite: ["domain", "kind"],
	template: "OUTBOX#${domain}#${kind}",
	casing: "none",
} as const;

/**
 * PLAN Q3 / FR-22: one incident event waiting for the grouped email of its domain —
 * PK OUTBOX#<domain>#<kind>, SK EVT#<at>#<incidentId>.
 */
export function outboxEntity(client: DynamoDBDocumentClient, table: string) {
	return new Entity(
		{
			model: { entity: "outbox", version: "1", service: "linkwatch" },
			attributes: {
				domain: { type: "string", required: true, readOnly: true },
				kind: { type: OUTBOX_KINDS, required: true, readOnly: true },
				at: { type: "string", required: true, readOnly: true },
				incidentId: { type: "string", required: true, readOnly: true },
				ttl: {
					type: "number",
					readOnly: true,
					watch: ["at"],
					set: (_, item) => ttlFrom(item.at as string),
				},
			},
			indexes: {
				byGroup: {
					pk: outboxPk,
					sk: {
						field: "sk",
						composite: ["at", "incidentId"],
						template: "EVT#${at}#${incidentId}",
						casing: "none",
					},
				},
			},
		},
		{ client, table },
	);
}

/**
 * PLAN Q3: marks an open 5-minute window — PK OUTBOX#<domain>#<kind>, SK WINDOW.
 * Created conditionally by the first event; only that event queues the delayed flush.
 */
export function outboxWindowEntity(
	client: DynamoDBDocumentClient,
	table: string,
) {
	return new Entity(
		{
			model: { entity: "outboxWindow", version: "1", service: "linkwatch" },
			attributes: {
				domain: { type: "string", required: true, readOnly: true },
				kind: { type: OUTBOX_KINDS, required: true, readOnly: true },
				windowStart: { type: "string", required: true },
				ttl: {
					type: "number",
					watch: ["windowStart"],
					set: (_, item) => ttlFrom(item.windowStart as string),
				},
			},
			indexes: {
				primary: {
					pk: outboxPk,
					sk: {
						field: "sk",
						composite: [],
						template: "WINDOW",
						casing: "none",
					},
				},
			},
		},
		{ client, table },
	);
}
