import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export type ClientOptions = {
	/** Đặt khi chạy DynamoDB Local, vd. http://localhost:8000. */
	endpoint?: string;
	region?: string;
};

/** Client thô (quản lý bảng) — endpoint Local dùng credentials giả. */
export function createRawClient(opts: ClientOptions = {}): DynamoDBClient {
	const endpoint = opts.endpoint ?? process.env.DYNAMODB_ENDPOINT;
	return new DynamoDBClient({
		region: opts.region ?? process.env.AWS_REGION ?? "ap-southeast-1",
		...(endpoint
			? {
					endpoint,
					credentials: { accessKeyId: "local", secretAccessKey: "local" },
				}
			: {}),
	});
}

export function createDocumentClient(
	raw: DynamoDBClient,
): DynamoDBDocumentClient {
	return DynamoDBDocumentClient.from(raw, {
		marshallOptions: { removeUndefinedValues: true },
	});
}
