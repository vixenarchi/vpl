/* Screenshots of vz for the eyes of a reviewer. Not a test. */
import { chromium } from 'playwright';
import { OWNER, GUEST } from './_account.mjs';
const B = process.env.VZ_URL || 'http://127.0.0.1:8103';
const br = await chromium.launch();

const desk = await (await br.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
await desk.goto(B, { waitUntil: 'networkidle' });
await desk.fill('#email', OWNER.email); await desk.fill('#pass', OWNER.pass);
await desk.click('#btn-login'); await desk.waitForSelector('#app:not([hidden])');
await desk.waitForTimeout(1800);
await desk.screenshot({ path: '/home/vergovic/vixen/.shots/vz-desktop.png' });
await desk.locator('#pairs [data-edit]').first().click();
await desk.waitForTimeout(400);
await desk.screenshot({ path: '/home/vergovic/vixen/.shots/vz-edit.png' });

const phone = await (await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
await phone.goto(B, { waitUntil: 'networkidle' });
await phone.fill('#email', OWNER.email); await phone.fill('#pass', OWNER.pass);
await phone.click('#btn-login'); await phone.waitForSelector('#app:not([hidden])');
await phone.waitForTimeout(1800);
await phone.screenshot({ path: '/home/vergovic/vixen/.shots/vz-phone.png' });
console.log('wrote three screenshots');
await br.close();
