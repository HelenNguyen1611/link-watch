import { Logger } from "@aws-lambda-powertools/logger";
import { createDb } from "@linkwatch/core/db";
import { createHandler } from "./handler";

const logger = new Logger({ serviceName: "checker" });

/** Lambda entry: SQS FIFO → Checker. */
export const handler = createHandler({
	db: createDb(),
	log: (message, extra) => logger.info(message, extra ?? {}),
});
