import { Logger } from "@aws-lambda-powertools/logger";
import { createDb } from "@linkwatch/core/db";
import { handle } from "hono/aws-lambda";
import { createApp } from "./app";

const logger = new Logger({ serviceName: "api" });

const app = createApp({
	db: createDb(),
	auth: { kind: "apiGateway" },
	log: (message, extra) => logger.error(message, extra ?? {}),
});

/** Lambda entry: API Gateway HTTP API (Cognito JWT authorizer) → Hono. */
export const handler = handle(app);
