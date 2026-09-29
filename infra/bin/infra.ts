#!/usr/bin/env node
import * as cdk from "aws-cdk-lib/core";
import { CicdStack } from "../lib/cicd-stack";
import { config } from "../lib/config";
import { DataStack } from "../lib/data-stack";
import { WebStack } from "../lib/web-stack";

const app = new cdk.App();
const env = { account: config.account, region: config.region };

new CicdStack(app, "LinkWatch-Cicd", { env });
new WebStack(app, "LinkWatch-Web", { env });
new DataStack(app, "LinkWatch-Data", { env });

cdk.Tags.of(app).add("project", "linkwatch");
