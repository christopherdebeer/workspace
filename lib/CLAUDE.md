# lib/

## Purpose
AWS CDK infrastructure as code definitions. This folder contains all infrastructure stack definitions.

## Files
- `workspace-stack.ts` - Main application stack with Lambda, DynamoDB, and API Gateway
- `inline-lambda-stack.ts` - Stack for inline Lambda function deployments

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
