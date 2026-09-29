/** Fixed configuration of the LinkWatch environment (no secrets). */
export const config = {
	account: "131746731277",
	region: "ap-southeast-1",
	domainName: "watch.hueai.net",
	/** ACM certificate in us-east-1 (required by CloudFront), issued 29/09/2026 */
	certificateArn:
		"arn:aws:acm:us-east-1:131746731277:certificate/2a904427-bfec-4ac1-9970-34b8d41cf26f",
	/** Repo + branch allowed to deploy via GitHub Actions OIDC */
	github: {
		owner: "HelenNguyen1611",
		repo: "link-watch",
		branch: "main",
		/** Immutable GitHub IDs included in the "sub" claim (taken from CloudTrail 29/09/2026) */
		ownerId: "126633948",
		repoId: "1394505495",
	},
	/**
	 * DynamoDB provisioned capacity (PLAN step 35, option c). The free tier of 25 RCU / 25 WCU
	 * is shared by the table and all GSIs; a test fails if the total exceeds 25.
	 * GSI1 is write-heavy because every lease / next_run_at update also writes to GSI1.
	 */
	dynamodb: {
		table: { read: 10, write: 15 },
		gsi1: { read: 5, write: 8 },
		gsi2: { read: 2, write: 1 },
		gsi3: { read: 8, write: 1 },
	},
} as const;
