import * as iam from "aws-cdk-lib/aws-iam";
import * as cdk from "aws-cdk-lib/core";
import type { Construct } from "constructs";
import { config } from "./config";

/**
 * GitHub Actions ↔ AWS bridge via OIDC (no access keys).
 * The role can only assume the roles created by "cdk bootstrap", and only from the repo's main branch.
 */
export class CicdStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);

		const provider = new iam.CfnOIDCProvider(this, "GithubOidc", {
			url: "https://token.actions.githubusercontent.com",
			clientIdList: ["sts.amazonaws.com"],
		});

		const { owner, repo, branch, ownerId, repoId } = config.github;
		// GitHub now sends "sub" with immutable IDs: repo:owner@id/repo@id:ref:...
		// Also accept the old form (without IDs) so it keeps working if GitHub or the settings change.
		const allowedSubs = [
			`repo:${owner}@${ownerId}/${repo}@${repoId}:ref:refs/heads/${branch}`,
			`repo:${owner}/${repo}:ref:refs/heads/${branch}`,
		];
		const role = new iam.Role(this, "GithubDeployRole", {
			roleName: "linkwatch-github-deploy",
			description: `GitHub Actions deploy for ${owner}/${repo}@${branch}`,
			maxSessionDuration: cdk.Duration.hours(1),
			assumedBy: new iam.WebIdentityPrincipal(provider.attrArn, {
				StringEquals: {
					"token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
					"token.actions.githubusercontent.com:sub": allowedSubs,
				},
			}),
		});

		role.addToPolicy(
			new iam.PolicyStatement({
				actions: ["sts:AssumeRole"],
				resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*`],
			}),
		);

		new cdk.CfnOutput(this, "GithubDeployRoleArn", { value: role.roleArn });
	}
}
