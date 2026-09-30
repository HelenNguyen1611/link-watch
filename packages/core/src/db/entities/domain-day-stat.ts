import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Entity } from "electrodb";

/**
 * FR-10 / NFR-02 / NFR-08: daily counters of a whole domain — PK DOMAIN#<name>, SK DAY#<date>
 * (Asia/Saigon day), kept 2 years (TTL). Added to by the Checker with every link check, so the
 * domain overview never needs to read every link's history.
 */
export function domainDayStatEntity(
	client: DynamoDBDocumentClient,
	table: string,
) {
	return new Entity(
		{
			model: { entity: "domainDayStat", version: "1", service: "linkwatch" },
			attributes: {
				domain: { type: "string", required: true, readOnly: true },
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
						composite: ["domain"],
						template: "DOMAIN#${domain}",
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
