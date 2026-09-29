import * as iam from "aws-cdk-lib/aws-iam";
import type * as lambda from "aws-cdk-lib/aws-lambda";
import * as cdk from "aws-cdk-lib/core";
import { config } from "./config";

/**
 * FR-26: lets a function send email through the manually created SES identity (never
 * creates AWS::SES::EmailIdentity). The resource is identity/* because, in the SES sandbox,
 * SES also authorizes the verified recipient identities; the From address is pinned to the
 * verified domain (or its subdomains) with `ses:FromAddress`.
 */
export function grantSendEmail(fn: lambda.IFunction): void {
	const stack = cdk.Stack.of(fn);
	fn.addToRolePolicy(
		new iam.PolicyStatement({
			actions: ["ses:SendEmail"],
			resources: [`arn:aws:ses:${stack.region}:${stack.account}:identity/*`],
			conditions: {
				StringLike: {
					"ses:FromAddress": [
						`*@${config.sesIdentity}`,
						`*@*.${config.sesIdentity}`,
					],
				},
			},
		}),
	);
}
