/**
 * AWS wiring of the smoke test (runs with the operator's credentials, e.g. AWS_PROFILE=linkwatch):
 * Cognito sign-in, read-only table access and the web bucket.
 */
import {
	CloudFormationClient,
	DescribeStackResourceCommand,
	DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import {
	AdminInitiateAuthCommand,
	CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import {
	DeleteObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { createDb } from "@linkwatch/core/db";
import type { SmokeSite, SmokeStore } from "./smoke-incident";

const REGION = process.env.AWS_REGION ?? "ap-southeast-1";
/** Must match infra: LinkWatch-Web SiteBucket logical ID and the data stack SSM parameter. */
const SITE_BUCKET_LOGICAL_ID = "SiteBucket397A1860";
const TABLE_NAME_PARAM = "/linkwatch/table-name";

export async function loadAwsEnvironment() {
	const cfn = new CloudFormationClient({ region: REGION });
	const { Stacks } = await cfn.send(
		new DescribeStacksCommand({ StackName: "LinkWatch-Api" }),
	);
	const output = (key: string) => {
		const value = Stacks?.[0]?.Outputs?.find(
			(o) => o.OutputKey === key,
		)?.OutputValue;
		if (!value)
			throw new Error(`LinkWatch-Api has no output ${key} — deployed?`);
		return value;
	};
	const userPoolId = output("UserPoolId");
	const clientId = output("SmokeClientId");

	const bucket = (
		await cfn.send(
			new DescribeStackResourceCommand({
				StackName: "LinkWatch-Web",
				LogicalResourceId: SITE_BUCKET_LOGICAL_ID,
			}),
		)
	).StackResourceDetail?.PhysicalResourceId;
	if (!bucket) throw new Error("Web bucket not found in LinkWatch-Web");

	const table = (
		await new SSMClient({ region: REGION }).send(
			new GetParameterCommand({ Name: TABLE_NAME_PARAM }),
		)
	).Parameter?.Value;
	if (!table) throw new Error(`SSM ${TABLE_NAME_PARAM} is empty`);
	const db = createDb({ table, region: REGION });

	const cognito = new CognitoIdentityProviderClient({ region: REGION });
	const s3 = new S3Client({ region: REGION });

	/** FR-28: ID token of a Cognito user (AdminInitiateAuth through the smoke client). */
	async function signIn(email: string, password: string): Promise<string> {
		const res = await cognito.send(
			new AdminInitiateAuthCommand({
				UserPoolId: userPoolId,
				ClientId: clientId,
				AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
				AuthParameters: { USERNAME: email, PASSWORD: password },
			}),
		);
		const token = res.AuthenticationResult?.IdToken;
		if (!token)
			throw new Error(
				`Cognito sign-in did not return a token (challenge: ${res.ChallengeName ?? "none"}) — set a permanent password first (RUNBOOK §2)`,
			);
		return token;
	}

	const store: SmokeStore = {
		latestIncident: async (linkId) => {
			const { data } = await db.Incident.query
				.primary({ linkId })
				.go({ order: "desc", limit: 1 });
			return data[0];
		},
		mails: async (incidentId) => {
			const { data } = await db.Notification.query
				.byIncident({ incidentId })
				.go();
			return data;
		},
	};

	const site: SmokeSite = {
		put: async (key, body) => {
			await s3.send(
				new PutObjectCommand({
					Bucket: bucket,
					Key: key,
					Body: body,
					ContentType: "text/plain; charset=utf-8",
				}),
			);
		},
		remove: async (key) => {
			await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
		},
	};

	return { signIn, store, site };
}
