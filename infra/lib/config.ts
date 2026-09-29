/** Cấu hình cố định của môi trường LinkWatch (không chứa bí mật). */
export const config = {
	account: "131746731277",
	region: "ap-southeast-1",
	domainName: "watch.hueai.net",
	/** Chứng chỉ ACM ở us-east-1 (bắt buộc cho CloudFront), đã Issued 29/09/2026 */
	certificateArn:
		"arn:aws:acm:us-east-1:131746731277:certificate/2a904427-bfec-4ac1-9970-34b8d41cf26f",
	/** Repo + nhánh được phép deploy qua GitHub Actions OIDC */
	github: {
		owner: "HelenNguyen1611",
		repo: "link-watch",
		branch: "main",
		/** ID bất biến GitHub gắn vào claim "sub" (lấy từ CloudTrail 29/09/2026) */
		ownerId: "126633948",
		repoId: "1394505495",
	},
	/**
	 * DynamoDB provisioned (PLAN Bước 35, phương án c). Hạn mức miễn phí 25 RCU / 25 WCU
	 * dùng chung cho bảng và mọi GSI; test chặn tổng vượt 25.
	 * GSI1 ghi nhiều vì mỗi lần giữ chỗ / cập nhật next_run_at đều ghi vào GSI1.
	 */
	dynamodb: {
		table: { read: 10, write: 15 },
		gsi1: { read: 5, write: 8 },
		gsi2: { read: 2, write: 1 },
		gsi3: { read: 8, write: 1 },
	},
} as const;
