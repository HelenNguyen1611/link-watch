import { Logger } from "@aws-lambda-powertools/logger";
import { SSMClient } from "@aws-sdk/client-ssm";
import { handle } from "hono/aws-lambda";
import { createApp } from "./app";
import { createSecretLoader } from "./secret";

const logger = new Logger({ serviceName: "api" });
const secretName = process.env.API_KEY_PARAM ?? "/linkwatch/api-shared-secret";

const app = createApp({
	getApiKey: createSecretLoader({ ssm: new SSMClient({}), name: secretName }),
	log: (message, extra) => logger.error(message, extra ?? {}),
});

/** Lambda entry: API Gateway HTTP API → Hono. */
export const handler = handle(app);
