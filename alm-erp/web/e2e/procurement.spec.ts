import { expect, test } from '@playwright/test';
import { login, logout, pickMaterial, trackErrors } from './helpers';

test('PO above the threshold: create → approval by Procurement Head → goods receipt updates stock', async ({ page }) => {
  const errors = trackErrors(page);

  // 1. Procurement consultant creates a ₹25.6 lakh PO (400 × ECHO02 at ₹6,400 cost).
  await login(page, 'consultant', '/procurement');
  await expect(page.getByText(/above ₹10,00,000 net need Procurement Head approval/)).toBeVisible();
  await page.getByRole('button', { name: 'Create Purchase Order' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create Purchase Order' });
  await dialog.getByRole('button', { name: 'Create purchase order' }).click();
  await expect(dialog.getByText('Select a vendor.')).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Vendor' }).selectOption({ index: 1 });
  await dialog.getByRole('combobox', { name: 'Plant' }).selectOption({ label: 'PUN – Pune DC (1000)' });
  await pickMaterial(page, 'Material', 'ECHO02');
  await dialog.getByRole('spinbutton', { name: 'Quantity' }).fill('400');
  await expect(dialog.getByText('₹25,60,000.00')).toBeVisible();
  await dialog.getByRole('button', { name: 'Create purchase order' }).click();
  await expect(page).toHaveURL(/\/procurement\/purchase-orders\/\d+$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Pending Approval');
  const poUrl = page.url();
  const poNumber = (await page.getByRole('heading', { level: 1 }).innerText()).match(/\d{10}/)![0];
  // The consultant can neither approve nor receive.
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Post Goods Receipt' })).toHaveCount(0);
  await logout(page);

  // 2. Procurement Head sees the approval to-do and approves.
  await login(page, 'head');
  await page.getByRole('link', { name: new RegExp(`Approve Purchase Order ${poNumber}`) }).click();
  await expect(page).toHaveURL(poUrl);
  await page.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText(`PO ${poNumber} approved.`)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Approved');
  await logout(page);

  // 3. Warehouse posts the goods receipt; stock at Pune rises by 400.
  await login(page, 'warehouse');
  const before = await page.request.get('/api/materials?q=ECHO02').then((r) => r.json());
  const materialId = before.items.find((m: { code: string }) => m.code === 'ECHO02').id;
  const stockBefore = await page.request.get(`/api/materials/${materialId}`).then((r) => r.json())
    .then((m) => m.plants.find((p: { plantCode: string }) => p.plantCode === 'PUN').onHand as number);
  await page.goto(poUrl);
  await page.getByRole('button', { name: 'Post Goods Receipt' }).click();
  const gr = page.getByRole('dialog', { name: new RegExp(`Goods Receipt for PO ${poNumber}`) });
  await expect(gr.getByRole('spinbutton')).toHaveValue('400');
  await gr.getByRole('spinbutton').fill('401');
  await expect(gr.getByRole('button', { name: 'Post goods receipt' })).toBeDisabled();
  await gr.getByRole('spinbutton').fill('400');
  await gr.getByRole('button', { name: 'Post goods receipt' }).click();
  await expect(page.getByText(/Goods receipt \d+: \+400 ECHO02/)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Received');
  await page.goto(`/inventory/materials/${materialId}`);
  const pun = page.getByRole('row', { name: /PUN – Pune DC/ });
  await expect(pun.getByRole('cell').nth(1)).toHaveText((stockBefore + 400).toLocaleString('en-IN'));
  await expect(page.getByRole('cell', { name: '+400' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('stock transfer rejects quantities above the available stock', async ({ page }) => {
  await login(page, 'warehouse', '/inventory');
  await page.getByRole('button', { name: 'Stock Transfer' }).click();
  const d = page.getByRole('dialog', { name: 'Stock Transfer between Plants' });
  await pickMaterial(page, 'Material', 'ECHO01');
  await d.getByRole('combobox', { name: 'From plant' }).selectOption({ label: 'MUM – Mumbai FC (1100)' });
  await d.getByRole('combobox', { name: 'To plant' }).selectOption({ label: 'PUN – Pune DC (1000)' });
  await d.getByRole('spinbutton', { name: 'Quantity' }).fill('61');
  await expect(d.getByText('Only 60 available.')).toBeVisible();
  await d.getByRole('button', { name: 'Post transfer' }).click();
  await expect(d.getByText(/Insufficient stock: 60 × ECHO01 available at MUM/)).toBeVisible();
  await d.getByRole('spinbutton', { name: 'Quantity' }).fill('25');
  await d.getByRole('button', { name: 'Post transfer' }).click();
  await expect(page.getByText(/Stock transfer \d+ posted: 25 × ECHO01 moved MUM → PUN/)).toBeVisible();
});
