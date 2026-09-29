/** Tạo bảng "linkwatch" trên DynamoDB Local để chạy API/worker ở máy: `pnpm db:init`. */
import {
	CreateTableCommand,
	ResourceInUseException,
} from "@aws-sdk/client-dynamodb";
import { createRawClient, tableDefinition } from "../src/db/index";

const table = process.env.TABLE_NAME ?? "linkwatch";
const endpoint = process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000";
const raw = createRawClient({ endpoint, region: "local" });
try {
	await raw.send(new CreateTableCommand(tableDefinition(table)));
	console.log(`Đã tạo bảng ${table} trên ${endpoint}`);
} catch (err) {
	if (err instanceof ResourceInUseException) console.log(`Bảng ${table} đã có`);
	else throw err;
}
