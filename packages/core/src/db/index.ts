import { Service } from "electrodb";
import {
	type ClientOptions,
	createDocumentClient,
	createRawClient,
} from "./client";
import { checkEntity } from "./entities/check";
import { domainEntity } from "./entities/domain";
import { linkEntity } from "./entities/link";
import { urlLockEntity } from "./entities/url-lock";

export * from "./client";
export { CHECK_TTL_DAYS, checkTtl } from "./entities/check";
export * from "./table";

export type DbOptions = ClientOptions & { table?: string };

/** Tạo các entity ElectroDB dùng chung một bảng. Gọi 1 lần mỗi cold start. */
export function createDb(opts: DbOptions = {}) {
	const table = opts.table ?? process.env.TABLE_NAME;
	if (!table) throw new Error("Thiếu tên bảng DynamoDB (TABLE_NAME)");
	const client = createDocumentClient(createRawClient(opts));
	const entities = {
		Domain: domainEntity(client, table),
		Link: linkEntity(client, table),
		Check: checkEntity(client, table),
		UrlLock: urlLockEntity(client, table),
	};
	return {
		table,
		client,
		...entities,
		service: new Service(entities, { client, table }),
	};
}
export type Db = ReturnType<typeof createDb>;
