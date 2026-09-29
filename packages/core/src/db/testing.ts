import {
	CreateTableCommand,
	DeleteTableCommand,
	type DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { createDb, createRawClient, type Db, tableDefinition } from "./index";

export const LOCAL_ENDPOINT =
	process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000";

export type TestDb = {
	db: Db;
	raw: DynamoDBClient;
	table: string;
	drop: () => Promise<void>;
};

/** Int test: tạo bảng riêng trên DynamoDB Local (`pnpm db:local`) cho mỗi file test. */
export async function createTestDb(): Promise<TestDb> {
	const table = `lw-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const raw = createRawClient({ endpoint: LOCAL_ENDPOINT, region: "local" });
	try {
		await raw.send(new CreateTableCommand(tableDefinition(table)));
	} catch (err) {
		throw new Error(
			`Không tạo được bảng trên ${LOCAL_ENDPOINT} — đã chạy "pnpm db:local" chưa? (${String(err)})`,
		);
	}
	const db = createDb({ endpoint: LOCAL_ENDPOINT, region: "local", table });
	return {
		db,
		raw,
		table,
		drop: async () => {
			await raw.send(new DeleteTableCommand({ TableName: table }));
		},
	};
}
