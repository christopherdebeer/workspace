# lambda/

## Purpose
AWS Lambda function handlers for backend API and business logic. Implements WebAuthn authentication, MCP protocol, and OAuth flows.

## Files
- `index.ts` - Main Lambda handler implementing all HTTP endpoints
- `tools.ts` - Type definitions for MCP tool system

## Key Features
1. **WebAuthn Authentication**
   - Registration and login flows
   - Secure credential storage in DynamoDB
   - FIDO2 spec compliance

2. **MCP Protocol**
   - JSON-RPC 2.0 implementation
   - Tool discovery and execution
   - Per-user tool namespacing

3. **OAuth 2.0**
   - Authorization code flow
   - Token management
   - Secure bearer token validation

4. **KV Store**
   - Per-user namespaced key-value storage
   - Automatic user isolation

## Conventions
- All types must be properly defined - **no `any` types**
- Use interfaces for all data structures
- Implement proper error handling with try/catch
- Return proper HTTP status codes
- Include CORS headers in all responses
- Use base64url encoding for WebAuthn data
- Validate all input data before processing

## Types
- `LambdaEvent` - API Gateway event structure
- `LambdaResponse` - HTTP response format
- `JsonRpcRequest/Response` - MCP protocol types
- `UserRecord` - User data structure
- `StoredCredential` - WebAuthn credential format
- `Tool` - MCP tool interface from tools.ts

## Security
- Bearer token authentication for MCP endpoints
- Per-user data isolation
- Secure credential storage
- Challenge-based WebAuthn flows
- Token expiration handling
