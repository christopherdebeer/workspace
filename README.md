# Workspace

_work in progress._

This project is an AWS CDK application built around a **serverless multi-project
platform**: a shared library (`platform/`) of CDK constructs and an in-Lambda
runtime that host many independent service cells behind a single CloudFront
router. See [`docs/serverless-platform.md`](docs/serverless-platform.md). Service
cells live in `services/` (e.g. the `auth` primitive — passkeys + OAuth 2.1),
are wired together in `lib/platform-stack.ts`, and deploy as the independent
`PlatformStack`. User-facing UI is owned per-cell rather than by a single SPA;
see [`docs/valtown-mapping.md`](docs/valtown-mapping.md).

Other stacks: `WorkspaceEc2Stack` (a persistent dev instance).

## Prerequisites
- Node.js 20
- npm
- AWS CLI

## Install
Run `npm install` in the repository root.

## Build & test
- `npm run build` — compile the CDK TypeScript sources.
- `npm test` — run the unit tests (jest).
- `npm run synth` — synthesize CloudFormation.

## Deploy
Use `npm run deploy` to deploy the stacks (`cdk deploy --all`). Post-merge
deploys to `main` run via the `Deploy CDK` GitHub Actions workflow.

Before the first deploy you must bootstrap the environment:

```bash
npm run cdk -- bootstrap --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess
```

## AWS Credentials
The CDK commands require AWS credentials. Set the following environment variables
before deploying:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION` (for example `us-east-1`)
