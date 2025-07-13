#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');

execSync('cdk deploy --require-approval never', { stdio: 'inherit' });

console.log('Building frontend');
execSync('npm run build', {
  cwd: path.join(__dirname, '..', 'frontend'),
  stdio: 'inherit',
});

console.log('Frontend build complete');
