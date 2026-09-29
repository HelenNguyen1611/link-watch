import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export type ClientOptions = {
	/** Set when running DynamoDB Local, e.g. http://localhost:8000. */
	endpoint?: string;
	region?: string;
};

/** Low-level client (table management) — the local endpoint uses dummy credentials. */
export function createRawClient(opts: ClientOptions = {}): DynamoDBClient {
	const endpoint = opts.endpoint ?? process.env.DYNAMODB_ENDPOINT;
	return new DynamoDBClient({
		// DynamoDB Local partitions data by region: every local tool shares the "local" region.
		region:
			opts.region ??
			(endpoint ? "local" : (process.env.AWS_REGION ?? "ap-southeast-1")),
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
