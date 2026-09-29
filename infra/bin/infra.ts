#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { config } from '../lib/config';
import { CicdStack } from '../lib/cicd-stack';
import { WebStack } from '../lib/web-stack';

const app = new cdk.App();
const env = { account: config.account, region: config.region };

new CicdStack(app, 'LinkWatch-Cicd', { env });
new WebStack(app, 'LinkWatch-Web', { env });

cdk.Tags.of(app).add('project', 'linkwatch');
