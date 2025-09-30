# bin/

## Purpose
Entry points and deployment scripts for the workspace application.

## Files
- `workspace.ts` - Main CDK app entry point that instantiates the infrastructure stack
- `deploy.js` - Deployment script that handles CDK deployment with proper configuration

## Conventions
- All executable scripts should be executable (chmod +x)
- Use TypeScript for CDK entry points
- Use JavaScript for deployment automation scripts
- Keep deployment logic simple - complex infrastructure should be in lib/

## Types
- All code must be properly typed - no `any` types
- Use CDK construct types from `aws-cdk-lib`
