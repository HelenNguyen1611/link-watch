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

	it("giữ nguyên logical ID của tài nguyên đã deploy", () => {
		const ids = Object.keys(template.toJSON().Resources);
		expect(ids).toEqual(
			expect.arrayContaining([
				"GithubOidc",
				"GithubDeployRoleB0CF66A5",
				"GithubDeployRoleDefaultPolicyE8F540D1",
			]),
		);
	});

	it("OIDC provider của GitHub với audience STS", () => {
		template.hasResourceProperties("AWS::IAM::OIDCProvider", {
			Url: "https://token.actions.githubusercontent.com",
			ClientIdList: ["sts.amazonaws.com"],
		});
	});

	it("role chỉ cho nhánh main của đúng repo assume", () => {
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

	it("role chỉ được assume các role của cdk bootstrap", () => {
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
