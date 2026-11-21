import { chromium } from 'playwright';
const B = process.env.VI_URL || 'https://vi.terg.hr';
const br = await chromium.launch();
const ctx = await br.newContext({ viewport: { width: 1280, height: 940 } });
const pg = await ctx.newPage();
pg.on('pageerror', (e) => console.log('E', e.message));
await pg.goto(B, { waitUntil: 'networkidle' });
await pg.fill('#email', 'vpl-agent@terg.hr');
await pg.fill('#pass', 'agent-vpl-2026!');
await pg.click('#btn-login');
await pg.waitForSelector('#app:not([hidden])');
await pg.waitForTimeout(1600);
for (const st of ['ideation', 'exploration', 'selection', 'simulation']) {
  await pg.click(`.step[data-stage="${st}"]`);
  await pg.waitForTimeout(450);
  await pg.screenshot({ path: `/tmp/f-${st}.png` });
}
await pg.click('.step[data-stage="exploration"]');
await pg.click('#btn-theme');
await pg.waitForTimeout(500);
await pg.screenshot({ path: '/tmp/f-dark.png' });
await pg.click('#btn-theme');

const m = await br.newContext({ viewport: { width: 375, height: 780 }, deviceScaleFactor: 2,
  storageState: await ctx.storageState() }).then((c) => c.newPage());
await m.goto(B, { waitUntil: 'networkidle' });
await m.waitForTimeout(1600);
await m.click('.step[data-stage="ideation"]');
await m.waitForTimeout(400);
await m.screenshot({ path: '/tmp/f-phone.png' });
console.log('overflow phone:', await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
await br.close();
