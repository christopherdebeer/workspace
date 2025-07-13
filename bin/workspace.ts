#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InlineLambdaStack } from '../lib/inline-lambda-stack';

const app = new cdk.App();
new InlineLambdaStack(app, 'InlineLambdaStack');
