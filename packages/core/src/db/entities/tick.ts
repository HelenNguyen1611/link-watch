import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Entity } from "electrodb";

/** Ticks are only needed for the 80% rule of the last half hour. */
const TICK_TTL_S = 2 * 86_400;

/**
 * SRS 5.2 step 5 + PLAN Q4: one Dispatcher run ("lượt") — PK TICK, SK <dispatchedAt>.
 * Written by the Dispatcher only for runs with ≥ 20 links; the Checker adds failures.
 */
export function tickEntity(client: DynamoDBDocumentClient, table: string) {
	return new Entity(
		{
			model: { entity: "tick", version: "1", service: "linkwatch" },
			attributes: {
				dispatchedAt: { type: "string", required: true, readOnly: true },
				checked: { type: "number", required: true },
				failed: { type: "number", default: 0 },
				/** Set once the single admin email of a system-wide outage was sent. */
				adminNotifiedAt: { type: "string" },
				ttl: {
					type: "number",
					readOnly: true,
					watch: ["dispatchedAt"],
					set: (_, item) =>
						Math.floor(Date.parse(item.dispatchedAt as string) / 1000) +
						TICK_TTL_S,
				},
			},
			indexes: {
				primary: {
					pk: { field: "pk", composite: [], template: "TICK", casing: "none" },
					sk: {
						field: "sk",
						composite: ["dispatchedAt"],
						template: "${dispatchedAt}",
						casing: "none",
					},
				},
			},
		},
		{ client, table },
	);
}
