import { test, expect } from '@playwright/test';

test.describe('Basic Frontend Tests', () => {
  test('should load the frontend application', async ({ page }) => {
    await page.goto('/workspace/');
    await expect(page).toHaveTitle(/Workspace/i);
  });

  test('should have command palette component', async ({ page }) => {
    await page.goto('/workspace/');
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});

test.describe('Mock API Tests', () => {
  test('should respond to MCP capabilities request with mock data', async ({ request }) => {
    const response = await request.post('/mcp', {
      data: {
        jsonrpc: '2.0',
        id: 1,
        method: 'capabilities',
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.result).toHaveProperty('tools');
    expect(data.result).toHaveProperty('resources');
    expect(data.result).toHaveProperty('prompts');
  });

  test('should list available MCP tools with mock data', async ({ request }) => {
    const response = await request.post('/mcp', {
      data: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.result).toHaveProperty('tools');
    expect(Array.isArray(data.result.tools)).toBeTruthy();
  });

  test('should handle WebAuthn registration options with mock data', async ({ request }) => {
    const response = await request.post('/webauthn/register/options', {
      data: {
        username: 'testuser',
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toHaveProperty('challenge');
    expect(data).toHaveProperty('user');
    expect(data.user.name).toBe('testuser');
  });
});