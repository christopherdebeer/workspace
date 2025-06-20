# Workspace

This project is an AWS CDK application with a React single page app (SPA) hosted in an S3 bucket.

## Prerequisites
- Node.js 18
- npm

## Install
Run `npm install` in the repository root. The root `postinstall` script automatically installs the frontend dependencies under `frontend/`.

## Build
Run `npm run build` to build the frontend and compile the CDK TypeScript sources.

## Deploy
Use `npm run deploy` to deploy the stack. After deployment, the SPA is available at the CloudFormation output `WorkspaceWebsiteUrl`.
