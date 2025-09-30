# tests/

## Purpose
Unit and integration tests for backend Lambda functions using Jest. Focus on testing individual functions and WebAuthn flows in isolation.

## Files
- `setup.ts` - Test environment setup and mocks
- `webauthn-simple.test.ts` - Basic WebAuthn functionality tests
- `webauthn-comprehensive.test.ts` - Complete WebAuthn flow tests
- `webauthn-buffer-fix-simple.test.ts` - Buffer handling tests
- `webauthn-credid.test.ts` - Credential ID verification tests
- `webauthn.test.ts` - Full WebAuthn test suite

## Test Scope
Unit tests cover:
- Lambda handler functions
- WebAuthn registration and authentication
- Buffer encoding/decoding (critical for WebAuthn)
- Error handling
- DynamoDB interactions (mocked)
- Fido2 library integration

## Conventions

### Test Structure
- One test file per major feature area
- Use descriptive test names
- Group related tests with `describe`
- Setup mocks in `beforeEach`
- Clean up in `afterEach`

### TypeScript
- **No `any` types** - Define proper types for mocks
- Use `unknown` with type guards for error handling
- Type mock return values properly
- Define interfaces for mock objects

### Mocking
- Mock AWS SDK DynamoDB operations
- Mock fido2-lib for WebAuthn operations
- Keep mocks minimal and focused
- Reset mocks between tests

### Assertions
- Use Jest matchers appropriately
- Test both success and failure paths
- Verify error messages contain expected text
- Check response structure and types

### Best Practices
- Test one thing per test
- Make tests independent
- Use meaningful test data
- Comment complex test setups
- Keep tests maintainable

## Critical Areas

### Buffer Handling
WebAuthn requires careful buffer handling:
- Always use proper ArrayBuffer slicing
- Avoid using buffer.buffer directly (returns entire pool)
- Use `buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)`
- Test base64url encoding/decoding thoroughly

### WebAuthn Flows
- Test registration options generation
- Test attestation verification
- Test login options generation
- Test assertion verification
- Test credential ID matching

## Running Tests
```bash
# Run all unit tests
npm test

# Watch mode
npm run test:watch

# Run specific test file
npm test webauthn-simple.test.ts
```

## Configuration
See `jest.config.js` in project root for Jest configuration.
