# lib/

## Purpose
AWS CDK infrastructure as code definitions. This folder contains all infrastructure stack definitions.

## Files
- `inline-lambda-stack.ts` - Serverless backend: Lambda + DynamoDB (auth & KV tables), Function URL
- `workspace-ec2-stack.ts` - Compute: EC2 (t3.medium Ubuntu 24.04), 100GB data volume, Tailscale-only access
- `platform-stack.ts` - Serverless multi-project platform: example service cells (`services/*`) behind a CloudFront `ServiceRouter`, sharing a `PlatformEventBus`. Built on the `platform/` library. See `docs/serverless-platform.md`.

## Conventions
- Use AWS CDK L2 constructs whenever possible
- Keep stacks modular and composable
- Follow AWS best practices for resource naming
- Use environment variables for configuration, not hardcoded values
- Tag all resources appropriately

## Types
- All code must be properly typed - no `any` types
- Use CDK construct types from `aws-cdk-lib`
- Define interfaces for custom construct props

## Architecture
- DynamoDB tables for auth and KV storage
- Lambda functions for backend logic
- API Gateway for HTTP endpoints
- Follow serverless best practices
