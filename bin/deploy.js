#!/usr/bin/env node
const { execSync } = require('child_process');

execSync('cdk deploy --all --require-approval never', { stdio: 'inherit' });
