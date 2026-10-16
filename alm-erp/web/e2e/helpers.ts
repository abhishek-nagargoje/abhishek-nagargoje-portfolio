import { expect, type Page } from '@playwright/test';
import { USERS } from './users';

export async function login(page: Page, who: keyof typeof USERS, next = '/') {
  await page.goto(`/login${next === '/' ? '' : `?next=${encodeURIComponent(next)}`}`);
  await page.getByRole('textbox', { name: 'Email' }).fill(USERS[who].email);
  await page.getByRole('textbox', { name: 'Password' }).fill(process.env.E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: /User menu/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
}

/** Collect console errors and uncaught exceptions for the page's lifetime. */
export function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    // Expected 4xx responses from deliberate negative tests are reported by the browser as console errors; ignore those.
    if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

export async function pickMaterial(page: Page, label: string, code: string) {
  const box = page.getByRole('combobox', { name: label });
  await box.fill(code);
  await page.getByRole('option', { name: new RegExp(`^${code}\\b`) }).click();
}
