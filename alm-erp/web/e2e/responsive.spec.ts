import { expect, test } from '@playwright/test';
import { login, trackErrors } from './helpers';

test('phone layout: no horizontal overflow and an overlay navigation', async ({ page }) => {
  const errors = trackErrors(page);
  await login(page, 'admin');
  for (const path of ['/', '/overview', '/requirements', '/procurement', '/inventory']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeAttached();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
  }
  await page.goto('/overview');
  const nav = page.getByRole('navigation', { name: 'Applications' });
  await expect(nav.getByRole('link', { name: 'Requirements' })).not.toBeInViewport();
  await page.getByRole('button', { name: 'Expand navigation' }).click();
  await nav.getByRole('link', { name: 'Requirements' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Requirements' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Requirements' })).not.toBeInViewport();
  expect(errors).toEqual([]);
});
