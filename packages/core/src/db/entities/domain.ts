import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Entity } from "electrodb";
import { DomainStatus } from "../../schema/enums";

const now = () => new Date().toISOString();

/** SRS 6.2: Domain — PK DOMAIN#<tên>, SK META (FR-08). */
export function domainEntity(client: DynamoDBDocumentClient, table: string) {
	return new Entity(
		{
			model: { entity: "domain", version: "1", service: "linkwatch" },
			attributes: {
				name: { type: "string", required: true, readOnly: true },
				displayName: { type: "string" },
				description: { type: "string" },
				owner: { type: "string" },
				scheduleId: { type: "string" },
				enabled: { type: "boolean", default: true },
				slowAlert: { type: "boolean", default: false },
				ignoreWaf403: { type: "boolean", default: false },
				/** FR-09: trạng thái tổng hợp. */
				status: { type: DomainStatus.options, default: "normal" },
				createdAt: { type: "string", readOnly: true, default: now },
				updatedAt: { type: "string", watch: "*", set: now, default: now },
			},
			indexes: {
				primary: {
					pk: {
						field: "pk",
						composite: ["name"],
						template: "DOMAIN#${name}",
						casing: "none",
					},
					sk: { field: "sk", composite: [], template: "META", casing: "none" },
				},
				all: {
					index: "gsi3",
					pk: {
						field: "gsi3pk",
						composite: [],
						template: "DOMAIN",
						casing: "none",
					},
					sk: {
						field: "gsi3sk",
						composite: ["name"],
						template: "${name}",
						casing: "none",
					},
				},
			},
		},
		{ client, table },
	);
}
