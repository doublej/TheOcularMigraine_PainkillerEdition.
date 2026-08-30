import { chromium } from 'playwright';

const PORT = 5175;
const W = 390, H = 844;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

// Tune (default, full page)
await page.screenshot({ path: 'raw/tune.png', fullPage: true });

// Recording
await page.getByRole('button', { name: 'Recording' }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: 'raw/recording.png', fullPage: true });

// System
await page.getByRole('button', { name: 'System' }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: 'raw/system.png', fullPage: true });

await browser.close();
console.log('Done: tune.png, recording.png, system.png');
