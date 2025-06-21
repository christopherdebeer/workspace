# Workspace

_work in progress._

This project is an AWS CDK application with a React single page app (SPA) hosted
in an S3 bucket. The frontend can also be published to GitHub Pages using the
provided workflow.

## Prerequisites
- Node.js 18
- npm
- AWS CLI

## Install
Run `npm install` in the repository root. The root `postinstall` script automatically installs the frontend dependencies under `frontend/`.

## Build
Run `npm run build` to build the frontend and compile the CDK TypeScript sources.

## Deploy
Use `npm run deploy` to deploy the stack. This command deploys the CDK stack,
builds the frontend with the Lambda function URL injected as `VITE_FUNCTION_URL`
and uploads the compiled assets to the website bucket. After deployment, the SPA
is available at the CloudFormation output `WorkspaceWebsiteUrl`.

Before the first deploy you must bootstrap the environment so the CDK can
create asset buckets and roles:

```bash
npm run cdk -- bootstrap --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess
```

If this step is skipped the deployment fails when creating the AWS CLI layer
with an `AccessDenied` error.

GitHub Pages deployments are triggered automatically on pushes to `main` via the
`Deploy Frontend to GitHub Pages` workflow.

## AWS Credentials
The CDK commands require AWS credentials. Set the following environment variables
before deploying:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION` (for example `us-east-1`)
