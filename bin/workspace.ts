#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { WorkspaceStack } from '../lib/workspace-stack';

const app = new cdk.App();
new WorkspaceStack(app, 'WorkspaceStack');
