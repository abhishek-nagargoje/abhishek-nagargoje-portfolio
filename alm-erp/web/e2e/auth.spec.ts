import { expect, test } from '@playwright/test';
import { login, logout, trackErrors } from './helpers';
import { USERS } from './users';

test('unauthenticated users are redirected to the login page', async ({ page }) => {
  await page.goto('/procurement');
  await expect(page).toHaveURL(/\/login\?next=%2Fprocurement/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('shows validation and a generic error for wrong credentials', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Enter a valid email address.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Email' }).fill(USERS.pm.email);
  await page.getByRole('textbox', { name: 'Password' }).fill('definitely-wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Invalid email or password.' })).toBeVisible();
});

test('password visibility can be toggled', async ({ page }) => {
  await page.goto('/login');
  const pw = page.getByRole('textbox', { name: 'Password' });
  await pw.fill('secret-value');
  await expect(pw).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(pw).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(pw).toHaveAttribute('type', 'password');
});

test('login keeps the session across reloads, returns to the requested page, and logout ends it', async ({ page }) => {
  const errors = trackErrors(page);
  await login(page, 'pm', '/requirements');
  await expect(page).toHaveURL(/\/requirements$/);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Requirements' })).toBeVisible();
  const cookies = await page.context().cookies();
  const sid = cookies.find((c) => c.name === 'alm_sid');
  expect(sid?.httpOnly).toBe(true);
  expect(sid?.sameSite).toBe('Lax');
  expect(await page.evaluate(() => document.cookie)).not.toContain('alm_sid');
  await logout(page);
  await page.goto('/requirements');
  await expect(page).toHaveURL(/\/login/);
  expect(errors).toEqual([]);
});

for (const next of ['//evil.example/', '/\\evil.example/', 'https://evil.example/']) {
  test(`ignores off-site redirect target ${next}`, async ({ page }) => {
    await page.goto(`/login?next=${encodeURIComponent(next)}`);
    await page.getByRole('textbox', { name: 'Email' }).fill(USERS.pm.email);
    await page.getByRole('textbox', { name: 'Password' }).fill(process.env.E2E_PASSWORD!);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('http://localhost:4100/');
  });
}

test('administration is hidden from non-administrators', async ({ page }) => {
  await login(page, 'tester');
  await expect(page.getByRole('link', { name: 'Users & Roles' })).toHaveCount(0);
  await page.goto('/admin/users');
  await expect(page).toHaveURL('http://localhost:4100/');
});
