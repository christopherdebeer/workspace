import { test, expect } from '@playwright/test';

test.describe('WebAuthn Login Tests', () => {
  test('should not throw error when clicking login button', async ({ page }) => {
    const errors: string[] = [];

    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/workspace/');

    const usernameInput = page.locator('input[placeholder="Username"]');
    await expect(usernameInput).toBeVisible();

    await usernameInput.fill('testuser@example.com');

    const loginButton = page.locator('button:has-text("Login")');
    await expect(loginButton).toBeVisible();

    await loginButton.click();

    await page.waitForTimeout(1000);

    const keyboardShortcutErrors = errors.filter(err =>
      err.includes('event.key') ||
      err.includes('toLowerCase') ||
      err.includes('undefined is not an object')
    );

    expect(keyboardShortcutErrors).toHaveLength(0);
  });

  test('should handle keyboard shortcuts during login process', async ({ page }) => {
    await page.goto('/workspace/');

    const usernameInput = page.locator('input[placeholder="Username"]');
    await usernameInput.fill('testuser@example.com');

    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

    await page.keyboard.press('Control+k');

    await page.waitForTimeout(500);

    const keyboardErrors = errors.filter(err => err.includes('event.key'));
    expect(keyboardErrors).toHaveLength(0);
  });
});