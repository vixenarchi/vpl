import { chromium } from 'playwright';
import { OWNER } from './_account.mjs';
const base = process.env.BASE || 'http://127.0.0.1:8104';
const br = await chromium.launch();
const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
const pg = await ctx.newPage();
pg.on('pageerror', (e) => console.log('PAGEERR', e.message));
pg.on('dialog', (d) => d.accept());
await pg.goto(base, { waitUntil: 'networkidle' });
if (await pg.locator('#gate').isVisible()) {
  await pg.fill('#email', OWNER.email); await pg.fill('#pass', OWNER.pass); await pg.click('#btn-login');
}
await pg.waitForSelector('#app:not([hidden])', { timeout: 30000 });
await pg.waitForTimeout(1500);
await pg.click('#btn-new');
await pg.waitForTimeout(2200);
const id = await pg.evaluate(() => document.querySelector('.proj-row.on')?.dataset.id);
console.log('new job', id);
// bin it
await pg.locator('.proj-row.on .kill').click({ force: true });
await pg.waitForTimeout(2000);
const afterKill = await pg.evaluate(() => ({ rows: document.querySelectorAll('#proj-list li').length, projNone: document.querySelector('#proj-none').textContent.trim() }));
console.log('after ✕', JSON.stringify(afterKill));
// open the bin
await pg.click('#btn-job-bin');
await pg.waitForTimeout(1500);
const binState = await pg.evaluate(() => ({
  pressed: document.querySelector('#btn-job-bin').getAttribute('aria-pressed'),
  banner: document.querySelector('#job-bin-banner').hidden ? 'hidden' : document.querySelector('#job-bin-note').textContent.trim(),
  rows: [...document.querySelectorAll('#proj-list li')].map((li) => li.textContent.trim().slice(0, 40)),
}));
console.log('bin', JSON.stringify(binState));
await pg.screenshot({ path: '/home/vergovic/vixen/.shots/job-bin.png' });
// restore it
await pg.locator('#proj-list [data-back]').first().click();
await pg.waitForTimeout(1500);
await pg.click('#btn-job-bin');
await pg.waitForTimeout(1500);
console.log('after restore', JSON.stringify(await pg.evaluate(() => ({ on: !!document.querySelector('.proj-row.on'), rows: document.querySelectorAll('#proj-list li').length }))));
// clean up: bin it and purge
await pg.locator('.proj-row.on .kill').click({ force: true });
await pg.waitForTimeout(1500);
await pg.click('#btn-job-bin');
await pg.waitForTimeout(1200);
await pg.locator('#proj-list [data-purge]').first().click();
await pg.waitForTimeout(1500);
console.log('purged', JSON.stringify(await pg.evaluate(() => ({
  binRows: document.querySelectorAll('#proj-list li').length,
  note: document.querySelector('#job-bin-note').textContent.trim() }))));
await br.close();
