import { Match, Template } from "aws-cdk-lib/assertions";
import * as cdk from "aws-cdk-lib/core";
import { beforeAll, describe, expect, it } from "vitest";
import { tableDefinition } from "../../packages/core/src/db/table";
import { config } from "../lib/config";
import { DataStack, TABLE_NAME_PARAM } from "../lib/data-stack";

type Gsi = {
	IndexName: string;
	KeySchema: { AttributeName: string; KeyType: string }[];
	Projection: { ProjectionType: string };
	ProvisionedThroughput: {
		ReadCapacityUnits: number;
		WriteCapacityUnits: number;
	};
};
type TableProps = {
	KeySchema: { AttributeName: string; KeyType: string }[];
	AttributeDefinitions: { AttributeName: string; AttributeType: string }[];
	GlobalSecondaryIndexes: Gsi[];
	ProvisionedThroughput: {
		ReadCapacityUnits: number;
		WriteCapacityUnits: number;
	};
};

describe("LinkWatch-Data", () => {
	let template: Template;
	let table: {
		Properties: TableProps;
		DeletionPolicy?: string;
		UpdateReplacePolicy?: string;
	};

	beforeAll(() => {
		const app = new cdk.App();
		const stack = new DataStack(app, "LinkWatch-Data", {
			env: { account: config.account, region: config.region },
		});
		template = Template.fromStack(stack);
		table = Object.values(
			template.findResources("AWS::DynamoDB::Table"),
		)[0] as typeof table;
	});

	it("SRS 6.2: exactly one single-table table with pk/sk keys", () => {
		template.resourceCountIs("AWS::DynamoDB::Table", 1);
		expect(table.Properties.KeySchema).toEqual([
			{ AttributeName: "pk", KeyType: "HASH" },
			{ AttributeName: "sk", KeyType: "RANGE" },
		]);
	});

	it("SRS 6.2: keys and GSIs match the core table definition used by ElectroDB", () => {
		const expected = tableDefinition("x");
		expect(
			new Set(
				table.Properties.AttributeDefinitions.map((a) => a.AttributeName),
			),
		).toEqual(
			new Set(expected.AttributeDefinitions?.map((a) => a.AttributeName)),
		);
		const gsis = table.Properties.GlobalSecondaryIndexes.map((g) => ({
			IndexName: g.IndexName,
			KeySchema: g.KeySchema,
			Projection: g.Projection,
		}));
		expect(gsis.sort((a, b) => a.IndexName.localeCompare(b.IndexName))).toEqual(
			expected.GlobalSecondaryIndexes?.map((g) => ({
				IndexName: g.IndexName,
				KeySchema: g.KeySchema,
				Projection: g.Projection,
			})),
		);
	});

	it("SRS 3.4: provisioned, total RCU and WCU of the table + all GSIs ≤ 25 (free tier)", () => {
		const all = [
			table.Properties.ProvisionedThroughput,
			...table.Properties.GlobalSecondaryIndexes.map(
				(g) => g.ProvisionedThroughput,
			),
		];
		const rcu = all.reduce((s, p) => s + p.ReadCapacityUnits, 0);
		const wcu = all.reduce((s, p) => s + p.WriteCapacityUnits, 0);
		expect(rcu).toBeLessThanOrEqual(25);
		expect(wcu).toBeLessThanOrEqual(25);
		expect(table.Properties).not.toHaveProperty(
			"BillingMode",
			"PAY_PER_REQUEST",
		);
		template.resourceCountIs("AWS::ApplicationAutoScaling::ScalableTarget", 0);
	});

	it("NFR-08: TTL on the ttl attribute", () => {
		template.hasResourceProperties("AWS::DynamoDB::Table", {
			TimeToLiveSpecification: { AttributeName: "ttl", Enabled: true },
		});
	});

	it("Alert (milestone 2) needs DynamoDB Streams NEW_AND_OLD_IMAGES — enabled now to avoid a later table update", () => {
		template.hasResourceProperties("AWS::DynamoDB::Table", {
			StreamSpecification: { StreamViewType: "NEW_AND_OLD_IMAGES" },
		});
	});

	it("real data: table retained on stack delete/replace, deletion protection on", () => {
		expect(table.DeletionPolicy).toBe("Retain");
		expect(table.UpdateReplacePolicy).toBe("Retain");
		template.hasResourceProperties("AWS::DynamoDB::Table", {
			DeletionProtectionEnabled: true,
		});
	});

	it("SSM Standard parameter (free) stores the table name for scripts and ops tools", () => {
		expect(TABLE_NAME_PARAM).toBe("/linkwatch/table-name");
		template.hasResourceProperties("AWS::SSM::Parameter", {
			Name: TABLE_NAME_PARAM,
			Type: "String",
			Tier: Match.absent(),
			Value: { Ref: Match.stringLikeRegexp("^Table") },
		});
	});

	it("creates no hourly-billed resources (NAT, EC2, RDS)", () => {
		for (const type of [
			"AWS::EC2::NatGateway",
			"AWS::EC2::Instance",
			"AWS::RDS::DBInstance",
		]) {
			template.resourceCountIs(type, 0);
		}
	});
});
