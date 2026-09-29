import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { Entity } from "electrodb";
import { CheckErrorType, HttpMethod, LinkStatus } from "../../schema/enums";

const now = () => new Date().toISOString();

/**
 * SRS 6.2: Link — PK DOMAIN#<domain>, SK LINK#<id>.
 * Convention: a paused or deleted link has NO `nextRunAt` → it drops out of GSI1 by itself (no index condition needed).
 */
export function linkEntity(client: DynamoDBDocumentClient, table: string) {
	return new Entity(
		{
			model: { entity: "link", version: "1", service: "linkwatch" },
			attributes: {
				domain: { type: "string", required: true, readOnly: true },
				id: { type: "string", required: true, readOnly: true },
				url: { type: "string", required: true },
				name: { type: "string" },
				tags: { type: "list", items: { type: "string" }, default: () => [] },
				method: { type: HttpMethod.options, required: true },
				expectedCodes: {
					type: "list",
					required: true,
					items: {
						type: "map",
						properties: {
							from: { type: "number", required: true },
							to: { type: "number", required: true },
						},
					},
				},
				timeoutS: { type: "number", required: true },
				keyword: { type: "string" },
				scheduleId: { type: "string" },
				status: { type: LinkStatus.options, default: "pending" },
				paused: { type: "boolean", default: false },
				nextRunAt: { type: "string" },
				lastCheckedAt: { type: "string" },
				lastHttpCode: { type: "number" },
				lastResponseMs: { type: "number" },
				lastErrorType: { type: CheckErrorType.options },
				createdAt: { type: "string", readOnly: true, default: now },
				updatedAt: { type: "string", watch: "*", set: now, default: now },
				deletedAt: { type: "string" },
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
						composite: ["id"],
						template: "LINK#${id}",
						casing: "none",
					},
				},
				due: {
					index: "gsi1",
					pk: {
						field: "gsi1pk",
						composite: [],
						template: "DUE",
						casing: "none",
					},
					sk: {
						field: "gsi1sk",
						composite: ["nextRunAt"],
						template: "${nextRunAt}",
						casing: "none",
					},
				},
				byId: {
					index: "gsi3",
					pk: {
						field: "gsi3pk",
						composite: [],
						template: "LINK",
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
