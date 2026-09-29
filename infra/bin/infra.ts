#!/usr/bin/env node
import * as cdk from "aws-cdk-lib/core";
import { CicdStack } from "../lib/cicd-stack";
import { config } from "../lib/config";
import { DataStack } from "../lib/data-stack";
import { WebStack } from "../lib/web-stack";
import { WorkersStack } from "../lib/workers-stack";

const app = new cdk.App();
const env = { account: config.account, region: config.region };

new CicdStack(app, "LinkWatch-Cicd", { env });
new WebStack(app, "LinkWatch-Web", { env });
const data = new DataStack(app, "LinkWatch-Data", { env });
new WorkersStack(app, "LinkWatch-Workers", { env, table: data.table });

cdk.Tags.of(app).add("project", "linkwatch");
