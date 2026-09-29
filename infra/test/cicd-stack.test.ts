import { Match, Template } from "aws-cdk-lib/assertions";
import * as cdk from "aws-cdk-lib/core";
import { beforeAll, describe, expect, it } from "vitest";
import { CicdStack } from "../lib/cicd-stack";
import { config } from "../lib/config";

describe("LinkWatch-Cicd", () => {
	let template: Template;

	beforeAll(() => {
		const app = new cdk.App();
		const stack = new CicdStack(app, "LinkWatch-Cicd", {
			env: { account: config.account, region: config.region },
		});
		template = Template.fromStack(stack);
	});

	it("keeps the logical IDs of deployed resources", () => {
		const ids = Object.keys(template.toJSON().Resources);
		expect(ids).toEqual(
			expect.arrayContaining([
				"GithubOidc",
				"GithubDeployRoleB0CF66A5",
				"GithubDeployRoleDefaultPolicyE8F540D1",
			]),
		);
	});

	it("GitHub OIDC provider with the STS audience", () => {
		template.hasResourceProperties("AWS::IAM::OIDCProvider", {
			Url: "https://token.actions.githubusercontent.com",
			ClientIdList: ["sts.amazonaws.com"],
		});
	});

	it("role can only be assumed from the main branch of this repo", () => {
		const { owner, repo, branch, ownerId, repoId } = config.github;
		template.hasResourceProperties("AWS::IAM::Role", {
			RoleName: "linkwatch-github-deploy",
			MaxSessionDuration: 3600,
			AssumeRolePolicyDocument: {
				Statement: [
					Match.objectLike({
						Action: "sts:AssumeRoleWithWebIdentity",
						Condition: {
							StringEquals: {
								"token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
								"token.actions.githubusercontent.com:sub": [
									`repo:${owner}@${ownerId}/${repo}@${repoId}:ref:refs/heads/${branch}`,
									`repo:${owner}/${repo}:ref:refs/heads/${branch}`,
								],
							},
						},
					}),
				],
			},
		});
	});

	it("role can only assume the cdk bootstrap roles", () => {
		template.hasResourceProperties("AWS::IAM::Policy", {
			PolicyDocument: {
				Statement: [
					{
						Action: "sts:AssumeRole",
						Effect: "Allow",
						Resource: `arn:aws:iam::${config.account}:role/cdk-hnb659fds-*`,
					},
				],
			},
		});
	});
});
