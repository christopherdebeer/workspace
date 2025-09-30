# e2e/

## Purpose
End-to-end tests using Playwright to verify complete user workflows and integration between frontend, backend, and infrastructure.

## Files
- `basic.spec.ts` - Basic application smoke tests
- `webauthn-login.spec.ts` - WebAuthn authentication flow tests

## Test Scope
E2E tests cover:
- Complete user journeys from UI to database
- Frontend-backend integration
- WebAuthn registration and login flows
- API endpoint responses
- Error handling and edge cases

## Conventions

### Test Structure
- Use descriptive test names that explain what is being tested
- Group related tests in `describe` blocks
- Use proper setup and teardown with `beforeEach`/`afterEach`
- Test both happy paths and error cases

### TypeScript
- **No `any` types** - Use `unknown` for truly unknown data
- Properly type page locators and responses
- Cast API responses with proper interfaces or `unknown`

### Best Practices
- Use `waitForTimeout` sparingly - prefer `waitFor` conditions
- Test user-visible behavior, not implementation details
- Keep tests independent - no test should depend on another
- Clean up test data to avoid pollution
- Use meaningful assertions with clear error messages

### Page Object Pattern
Consider using page objects for complex UIs to:
- Reduce duplication
- Make tests more maintainable
- Abstract implementation details

## Running Tests
```bash
# Run all e2e tests
npm run test:e2e

# Run with UI mode
npm run test:e2e:ui

# Debug mode
npm run test:e2e:debug
```

## Configuration
See `playwright.config.ts` in project root for Playwright configuration.
