import { expect, test } from '@playwright/test';
import { login, pickMaterial, trackErrors } from './helpers';

test('order to cash: shortage is reported, goods issue is refused without stock, then billed exactly once', async ({ page }) => {
  const errors = trackErrors(page);
  await login(page, 'admin', '/sales');
  const mat = (await page.request.get('/api/materials?q=FTVC02').then((r) => r.json())).items[0];
  const onHand = (await page.request.get(`/api/materials/${mat.id}`).then((r) => r.json())).plants.find((p: { plantCode: string }) => p.plantCode === 'BLR').onHand as number;
  const qty = onHand + 5;

  await page.getByRole('button', { name: 'Create Sales Order' }).click();
  const d = page.getByRole('dialog', { name: 'Create Sales Order' });
  await d.getByRole('combobox', { name: 'Customer' }).selectOption({ index: 3 });
  await d.getByRole('combobox', { name: 'Delivering plant' }).selectOption({ label: 'BLR – Bengaluru FC (1300)' });
  await pickMaterial(page, 'Material', 'FTVC02');
  await d.getByRole('spinbutton', { name: 'Quantity' }).fill(String(qty));
  await d.getByRole('button', { name: 'Create sales order' }).click();
  await expect(page).toHaveURL(/\/sales\/orders\/\d+$/);
  await expect(page.getByText(/Shortage – FTVC02: short 5/)).toBeVisible();

  await page.getByRole('button', { name: 'Create Delivery' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create delivery' }).click();
  await expect(page.getByText(/Outbound delivery \d+ created/)).toBeVisible();
  await page.getByRole('link', { name: /^Delivery \d+$/ }).click();
  await page.getByRole('button', { name: 'Confirm Pick & Pack' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText(/picked and packed/)).toBeVisible();
  await expect(page.getByText(/Insufficient stock for FTVC02/)).toBeVisible();
  await page.getByRole('button', { name: 'Post Goods Issue' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Post goods issue' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /Insufficient stock/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Picked');
  const deliveryUrl = page.url();

  // Found stock is booked with a reason, then the goods issue goes through.
  await page.goto('/inventory');
  await page.getByRole('button', { name: 'Stock Adjustment' }).click();
  const adj = page.getByRole('dialog', { name: 'Stock Adjustment' });
  await pickMaterial(page, 'Material', 'FTVC02');
  await adj.getByRole('combobox', { name: 'Plant' }).selectOption({ label: 'BLR – Bengaluru FC (1300)' });
  await adj.getByRole('spinbutton', { name: 'Quantity change' }).fill('5');
  await adj.getByRole('textbox', { name: 'Reason' }).fill('Found in cycle count');
  await adj.getByRole('button', { name: 'Post adjustment' }).click();
  await expect(page.getByText(`Adjustment posted. FTVC02 stock at BLR is now ${qty}.`)).toBeVisible();

  await page.goto(deliveryUrl);
  await page.getByRole('button', { name: 'Post Goods Issue' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Post goods issue' }).click();
  await expect(page.getByText(new RegExp(`Goods issue posted for delivery \\d+: −${qty} FTVC02 \\(stock 0\\)`))).toBeVisible();
  await page.getByRole('button', { name: 'Create Invoice' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create invoice' }).click();
  await expect(page.getByText(/Invoice \d+: .* \+ 18% GST = /)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create Invoice' })).toHaveCount(0);
  await page.getByRole('link', { name: /^Invoice \d+$/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Tax Invoice');
  await expect(page.getByText('GST 18%')).toBeVisible();
  expect(errors).toEqual([]);
});
