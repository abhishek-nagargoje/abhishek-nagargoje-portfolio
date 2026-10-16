import { expect, test } from '@playwright/test';
import { login, trackErrors } from './helpers';

test('requirement → test case → failed execution raises a defect; sign-off stays blocked', async ({ page }) => {
  const errors = trackErrors(page);
  await login(page, 'pm', '/requirements');

  await page.getByRole('button', { name: 'Create Requirement' }).click();
  const create = page.getByRole('dialog', { name: 'Create Requirement' });
  await create.getByRole('button', { name: 'Create' }).click();
  await expect(create.getByText('Title is required.')).toBeVisible();
  await create.getByRole('textbox', { name: 'Title' }).fill('Three-way match on supplier invoices');
  await create.getByRole('combobox', { name: 'Business process' }).selectOption({ label: 'Source to Pay' });
  await create.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/requirements\/\d+$/);
  const reqUrl = page.url();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Three-way match on supplier invoices');

  for (const s of ['Fit-to-Standard', 'In Realization', 'In Test']) {
    await page.getByRole('button', { name: `Set to ${s}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Change status' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(s);
  }

  // Test case with two steps, linked to the requirement.
  await page.getByRole('link', { name: 'Add test case' }).click();
  const tc = page.getByRole('dialog', { name: 'Create Test Case' });
  await tc.getByRole('textbox', { name: 'Title' }).fill('Invoice blocked on price variance');
  await tc.getByRole('textbox', { name: 'Step 1 action' }).fill('Post invoice 10% above PO price');
  await tc.getByRole('textbox', { name: 'Step 1 expected result' }).fill('Invoice is blocked for payment');
  await tc.getByRole('button', { name: 'Add step' }).click();
  await tc.getByRole('textbox', { name: 'Step 2 action' }).fill('Release block');
  await tc.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/tests\/\d+$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Ready');

  await page.getByRole('button', { name: 'Start execution' }).click();
  await page.getByRole('button', { name: 'Fail step 1' }).click();
  await expect(page.getByText('Describe the actual result when a step fails.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Actual result for step 1' }).fill('Invoice posted without block');
  await page.getByRole('button', { name: 'Fail step 1' }).click();
  await expect(page.getByText(/Step failed – defect DEF-\d+ recorded and assigned/)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Failed');

  // Business sign-off is blocked by the failed test (server rule surfaced in the UI).
  await page.goto(reqUrl);
  await page.getByRole('button', { name: 'Sign off (Approve)' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sign off' }).click();
  await expect(page.getByText(/Sign-off blocked: 1 of 1 linked test cases have not passed/)).toBeVisible();
  await expect(page.getByRole('link', { name: /^DEF-\d+$/ })).toBeVisible();
  expect(errors).toEqual([]);
});
