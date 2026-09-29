import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Entity } from "electrodb";

/** NFR-08: daily aggregates are kept for 2 years (deleted automatically by DynamoDB TTL). */
export const DAY_STAT_TTL_DAYS = 2 * 366;

/** Epoch seconds at which DynamoDB TTL deletes the daily stat of `day` (YYYY-MM-DD). */
export function dayStatTtl(day: string): number {
	return (
		Math.floor(Date.parse(`${day}T00:00:00.000Z`) / 1000) +
		DAY_STAT_TTL_DAYS * 86_400
	);
}

/**
 * SRS 6.2: daily uptime counters — PK LINK#<linkId>, SK DAY#<YYYY-MM-DD> (Asia/Saigon day).
 * The Checker adds to the counters with an atomic `add` on every check.
 */
export function dayStatEntity(client: DynamoDBDocumentClient, table: string) {
	return new Entity(
		{
			model: { entity: "dayStat", version: "1", service: "linkwatch" },
			attributes: {
				linkId: { type: "string", required: true, readOnly: true },
				day: { type: "string", required: true, readOnly: true },
				checks: { type: "number", default: 0 },
				up: { type: "number", default: 0 },
				slow: { type: "number", default: 0 },
				dead: { type: "number", default: 0 },
				down: { type: "number", default: 0 },
				totalResponseMs: { type: "number", default: 0 },
				ttl: { type: "number" },
			},
			indexes: {
				primary: {
					pk: {
						field: "pk",
						composite: ["linkId"],
						template: "LINK#${linkId}",
						casing: "none",
					},
					sk: {
						field: "sk",
						composite: ["day"],
						template: "DAY#${day}",
						casing: "none",
					},
				},
			},
		},
		{ client, table },
	);
}
