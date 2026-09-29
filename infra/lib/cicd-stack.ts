import * as iam from "aws-cdk-lib/aws-iam";
import * as cdk from "aws-cdk-lib/core";
import type { Construct } from "constructs";
import { config } from "./config";

/**
 * Cầu nối GitHub Actions ↔ AWS bằng OIDC (không cần access key).
 * Role chỉ được assume các role mà "cdk bootstrap" đã tạo, và chỉ từ nhánh main của repo.
 */
export class CicdStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);

		const provider = new iam.CfnOIDCProvider(this, "GithubOidc", {
			url: "https://token.actions.githubusercontent.com",
			clientIdList: ["sts.amazonaws.com"],
		});

		const { owner, repo, branch, ownerId, repoId } = config.github;
		// GitHub hiện gửi "sub" dạng có ID bất biến: repo:owner@id/repo@id:ref:...
		// Chấp nhận cả dạng cũ (không ID) để không hỏng nếu GitHub/cấu hình thay đổi.
		const allowedSubs = [
			`repo:${owner}@${ownerId}/${repo}@${repoId}:ref:refs/heads/${branch}`,
			`repo:${owner}/${repo}:ref:refs/heads/${branch}`,
		];
		const role = new iam.Role(this, "GithubDeployRole", {
			roleName: "linkwatch-github-deploy",
			description: `GitHub Actions deploy cho ${owner}/${repo}@${branch}`,
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
