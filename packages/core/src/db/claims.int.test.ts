import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashToken, newToken, tokenTtl } from "../token";
import { createTestDb, type TestDb } from "./testing";

let t: TestDb;
beforeAll(async () => {
	t = await createTestDb();
});
afterAll(() => t?.drop());

const NOW = new Date("2026-09-30T03:00:00.000Z");

describe("Token entity — FR-34", () => {
	it("FR-34: stores only the hash, with the recipient, incidents and a 7-day TTL", async () => {
		const token = newToken();
		await t.db.Token.create({
			tokenHash: hashToken(token),
			incidentIds: ["L1@2026-09-30T02:00:00.000Z"],
			recipientEmail: "lan@abc.com",
			issuedAt: NOW.toISOString(),
			ttl: tokenTtl(NOW),
		}).go();
		const raw = await t.raw.send(
			new GetItemCommand({
				TableName: t.table,
				Key: { pk: { S: `TOKEN#${hashToken(token)}` }, sk: { S: "META" } },
			}),
		);
		expect(raw.Item?.ttl?.N).toBe(String(tokenTtl(NOW)));
		expect(JSON.stringify(raw.Item)).not.toContain(token);
		const { data } = await t.db.Token.get({ tokenHash: hashToken(token) }).go();
		expect(data?.incidentIds).toEqual(["L1@2026-09-30T02:00:00.000Z"]);
	});
});

describe("Claim entity — FR-36, FR-41", () => {
	it("FR-41: claims are kept with the incident, oldest first, with their attempts", async () => {
		const incidentId = "L1@2026-09-30T02:00:00.000Z";
		await t.db.Claim.create({
			incidentId,
			claimedAt: "2026-09-30T03:00:00.000Z",
			linkId: "L1",
			domain: "abc.com",
			byEmail: "lan@abc.com",
			channel: "email",
			note: "Renewed SSL",
		}).go();
		await t.db.Claim.patch({
			incidentId,
			claimedAt: "2026-09-30T03:00:00.000Z",
		})
			.append({
				attempts: [
					{
						attempt: 1,
						at: "2026-09-30T03:00:05.000Z",
						result: "dead",
						httpCode: 404,
					},
				],
			})
			.go();
		await t.db.Claim.create({
			incidentId,
			claimedAt: "2026-09-30T04:00:00.000Z",
			linkId: "L1",
			domain: "abc.com",
			byEmail: "ops@abc.com",
			channel: "app",
		}).go();
		const { data } = await t.db.Claim.query.byIncident({ incidentId }).go();
		expect(data.map((c) => [c.byEmail, c.channel, c.outcome])).toEqual([
			["lan@abc.com", "email", "pending"],
			["ops@abc.com", "app", "pending"],
		]);
		expect(data[0]?.attempts).toEqual([
			{
				attempt: 1,
				at: "2026-09-30T03:00:05.000Z",
				result: "dead",
				httpCode: 404,
			},
		]);
	});
});
