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
const rows = () => pg.locator('#proj-list li').count();
const binOpen = () => pg.evaluate(() => document.querySelector('#btn-job-bin').getAttribute('aria-pressed') === 'true');
console.log('live rows at start', await rows());
await pg.click('#btn-new');
await pg.waitForTimeout(2000);
await pg.locator('.proj-row.on .kill').click({ force: true });
await pg.waitForTimeout(1800);
console.log('after ✕  live rows', await rows(), 'bin open?', await binOpen());
await pg.click('#btn-job-bin');
await pg.waitForTimeout(1400);
console.log('bin open?', await binOpen(), 'rows', await rows(), 'note:', await pg.textContent('#job-bin-note'));
await pg.locator('#proj-list [data-back]').first().click();
await pg.waitForTimeout(2000);
console.log('after restore: bin open?', await binOpen(), 'rows', await rows(),
  'open job title:', await pg.inputValue('#proj-title').catch(() => 'n/a'));
// tidy: bin+purge the job we made
await pg.locator('.proj-row.on .kill').click({ force: true });
await pg.waitForTimeout(1600);
await pg.click('#btn-job-bin');
await pg.waitForTimeout(1200);
await pg.locator('#proj-list [data-purge]').first().click();
await pg.waitForTimeout(1600);
console.log('after purge: rows', await rows(), 'note:', await pg.textContent('#job-bin-note'));
await br.close();
