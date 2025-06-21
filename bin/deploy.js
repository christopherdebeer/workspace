#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');


const outputsFile = path.join(__dirname, '..', 'cdk-outputs.json');

execSync(`cdk deploy --outputs-file ${outputsFile} --require-approval never`, {
  stdio: 'inherit',
});

const outputs = JSON.parse(fs.readFileSync(outputsFile, 'utf8')).WorkspaceStack;
const fnUrl = outputs.FunctionUrl;

console.log('Building frontend with API URL:', fnUrl);
execSync('npm run build', {
  cwd: path.join(__dirname, '..', 'frontend'),
  stdio: 'inherit',
  env: { ...process.env, VITE_FUNCTION_URL: fnUrl },
});

console.log('Frontend build complete');
