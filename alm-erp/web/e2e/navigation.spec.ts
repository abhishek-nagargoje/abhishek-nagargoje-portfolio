import { expect, test } from '@playwright/test';
import { login, trackErrors } from './helpers';

const ROUTES: [string, string][] = [
  ['/overview', 'Project Overview'], ['/processes', 'Business Processes'], ['/requirements', 'Requirements'], ['/tasks', 'Tasks'],
  ['/tests', 'Test Management'], ['/defects', 'Defects'], ['/deployment', 'Landscape & Deployment'], ['/monitoring', 'Operations Monitoring'],
  ['/procurement', 'Procurement'], ['/inventory', 'Inventory'], ['/mrp', 'Supply Planning (MRP)'], ['/sales', 'Sales & Delivery'],
  ['/documents', 'Document Flow'], ['/companies', 'Customers & Vendors'], ['/team', 'Team & Activity'], ['/notifications', 'Notifications'],
  ['/account', 'Account settings'], ['/admin/users', 'Users & Roles'], ['/admin/settings', 'Configuration'], ['/admin/audit', 'Security Audit Log'],
];

test('every application page renders without errors', async ({ page }) => {
  const errors = trackErrors(page);
  await login(page, 'admin');
  await expect(page.getByRole('heading', { name: /To Dos/ })).toBeVisible();
  for (const [path, title] of ROUTES) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: title }), path).toBeVisible();
    await expect(page.getByText('An unexpected error occurred')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('side navigation, global search and dialogs are keyboard accessible', async ({ page }) => {
  await login(page, 'admin', '/requirements');
  await page.getByRole('link', { name: 'Inventory', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Inventory' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Inventory', exact: true })).toHaveAttribute('aria-current', 'page');

  await page.getByRole('textbox', { name: /^Search requirements/ }).fill('REQ-001');
  await page.getByRole('option', { name: /^requirement REQ-001/ }).click();
  await expect(page).toHaveURL(/\/requirements\/\d+$/);

  const edit = page.getByRole('button', { name: 'Edit' });
  await edit.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('textbox', { name: 'Title' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(edit).toBeFocused();
});

test('tables paginate and filter on the server', async ({ page }) => {
  await login(page, 'admin', '/inventory');
  await expect(page.getByText('540 materials')).toBeVisible();
  await expect(page.getByText('1–25 of 540')).toBeVisible();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText('26–50 of 540')).toBeVisible();
  await page.getByRole('combobox', { name: 'Category' }).selectOption('Kindle');
  await expect(page.getByText('72 materials')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search', exact: true }).fill('KPW0');
  await expect(page.getByText('9 materials')).toBeVisible();
});
