import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Entity } from "electrodb";

const now = () => new Date().toISOString();

/**
 * FR-11 / FR-12: reusable schedule — PK SCHED#<id>, SK META; listed through GSI3 (pk SCHED).
 * `rule` is a `ScheduleRule` validated by the shared Zod schema before it is written.
 */
export function scheduleEntity(client: DynamoDBDocumentClient, table: string) {
	return new Entity(
		{
			model: { entity: "schedule", version: "1", service: "linkwatch" },
			attributes: {
				id: { type: "string", required: true, readOnly: true },
				name: { type: "string", required: true },
				rule: { type: "any", required: true },
				createdAt: { type: "string", readOnly: true, default: now },
				updatedAt: { type: "string", watch: "*", set: now, default: now },
			},
			indexes: {
				primary: {
					pk: {
						field: "pk",
						composite: ["id"],
						template: "SCHED#${id}",
						casing: "none",
					},
					sk: { field: "sk", composite: [], template: "META", casing: "none" },
				},
				all: {
					index: "gsi3",
					pk: {
						field: "gsi3pk",
						composite: [],
						template: "SCHED",
						casing: "none",
					},
					sk: {
						field: "gsi3sk",
						composite: ["id"],
						template: "${id}",
						casing: "none",
					},
				},
			},
		},
		{ client, table },
	);
}
