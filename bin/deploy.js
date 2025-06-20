#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const AWS = require('aws-sdk');

const outputsFile = path.join(__dirname, '..', 'cdk-outputs.json');

execSync(`cdk deploy --outputs-file ${outputsFile} --require-approval never`, {
  stdio: 'inherit',
});

const outputs = JSON.parse(fs.readFileSync(outputsFile, 'utf8')).WorkspaceStack;
const fnUrl = outputs.FunctionUrl;
const bucketName = outputs.WebsiteBucketName;
const websiteUrl = outputs.WebsiteUrl;

console.log('Building frontend with API URL:', fnUrl);
execSync('npm run build', {
  cwd: path.join(__dirname, '..', 'frontend'),
  stdio: 'inherit',
  env: { ...process.env, VITE_FUNCTION_URL: fnUrl },
});

const distDir = path.join(__dirname, '..', 'frontend', 'dist');
const s3 = new AWS.S3();

function walk(dir, prefix = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const key = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...walk(full, key));
    } else {
      files.push({ path: full, key });
    }
  }
  return files;
}

(async () => {
  const files = walk(distDir);
  for (const file of files) {
    const Body = fs.readFileSync(file.path);
    const ContentType = mime.lookup(file.path) || 'application/octet-stream';
    await s3
      .putObject({ Bucket: bucketName, Key: `webapp/${file.key}`, Body, ContentType })
      .promise();
  }
  console.log('Website URL:', websiteUrl);
})();
