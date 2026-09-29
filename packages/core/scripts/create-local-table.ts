/** Creates the "linkwatch" table on DynamoDB Local for running the API/workers locally: `pnpm db:init`. */
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
	console.log(`Created table ${table} on ${endpoint}`);
} catch (err) {
	if (err instanceof ResourceInUseException)
		console.log(`Table ${table} already exists`);
	else throw err;
}
