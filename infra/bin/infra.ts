#!/usr/bin/env node
import * as cdk from "aws-cdk-lib/core";
import { ApiStack } from "../lib/api-stack";
import { CicdStack } from "../lib/cicd-stack";
import { config } from "../lib/config";
import { DataStack } from "../lib/data-stack";
import { WebStack } from "../lib/web-stack";
import { WorkersStack } from "../lib/workers-stack";

const app = new cdk.App();
const env = { account: config.account, region: config.region };

new CicdStack(app, "LinkWatch-Cicd", { env });
const data = new DataStack(app, "LinkWatch-Data", { env });
const workers = new WorkersStack(app, "LinkWatch-Workers", {
	env,
	table: data.table,
});
const api = new ApiStack(app, "LinkWatch-Api", {
	env,
	table: data.table,
	priorityQueue: workers.priorityQueue,
});
new WebStack(app, "LinkWatch-Web", {
	env,
	apiOriginDomain: api.apiDomainName,
	auth: {
		userPoolId: api.userPoolId,
		userPoolClientId: api.userPoolClientId,
	},
});

cdk.Tags.of(app).add("project", "linkwatch");
