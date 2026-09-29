import { Service } from "electrodb";
import {
	type ClientOptions,
	createDocumentClient,
	createRawClient,
} from "./client";
import { checkEntity } from "./entities/check";
import { dayStatEntity } from "./entities/day-stat";
import { domainEntity } from "./entities/domain";
import { incidentEntity } from "./entities/incident";
import { linkEntity } from "./entities/link";
import { notificationEntity } from "./entities/notification";
import { recipientEntity } from "./entities/recipient";
import { settingsEntity } from "./entities/settings";
import { urlLockEntity } from "./entities/url-lock";

export * from "./client";
export { CHECK_TTL_DAYS, checkTtl } from "./entities/check";
export { DAY_STAT_TTL_DAYS, dayStatTtl } from "./entities/day-stat";
export { CLOSED_REASONS } from "./entities/incident";
export {
	NOTIFICATION_KINDS,
	NOTIFICATION_STATUSES,
	type NotificationLogKind,
} from "./entities/notification";
export {
	RECIPIENT_SCOPES,
	type RecipientScope,
} from "./entities/recipient";
export { DEFAULT_REMINDER_INTERVAL_HOURS } from "./entities/settings";
export * from "./table";

export type DbOptions = ClientOptions & { table?: string };

/** Creates the ElectroDB entities sharing one table. Call once per cold start. */
export function createDb(opts: DbOptions = {}) {
	const table = opts.table ?? process.env.TABLE_NAME;
	if (!table) throw new Error("Missing DynamoDB table name (TABLE_NAME)");
	const client = createDocumentClient(createRawClient(opts));
	const entities = {
		Domain: domainEntity(client, table),
		Link: linkEntity(client, table),
		Check: checkEntity(client, table),
		UrlLock: urlLockEntity(client, table),
		Recipient: recipientEntity(client, table),
		Settings: settingsEntity(client, table),
		Incident: incidentEntity(client, table),
		DayStat: dayStatEntity(client, table),
		Notification: notificationEntity(client, table),
	};
	return {
		table,
		client,
		...entities,
		service: new Service(entities, { client, table }),
	};
}
export type Db = ReturnType<typeof createDb>;
