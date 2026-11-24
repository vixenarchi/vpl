/* vi — sharing a funnel.
 *
 *   VI_URL=http://127.0.0.1:8100 node vi-share.mjs
 *
 * Proves the public link, which needs no second account: a code is minted in the
 * dialog, opened in a context with no session, and must read the funnel with
 * every verb taken out. The personal grant and its guard were checked against the
 * database directly (editor writes text, stage change refused with 23514); a test
 * that needs a second signed-in account is not worth maintaining for that.
 */
import { chromium } from 'playwright';
import { OWNER, GUEST } from './_account.mjs';

const B = process.env.VI_URL || 'http://127.0.0.1:8100';
let pass = 0, fail = 0;
const ok = (cond, what) => { cond ? pass++ : fail++; console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}`); };

const br = await chromium.launch();
const ctx = await br.newContext({ viewport: { width: 1200, height: 950 } });
const pg = await ctx.newPage();
pg.on('pageerror', (e) => console.log('  log ' + e.message));

await pg.goto(B, { waitUntil: 'networkidle' });
await pg.fill('#email', OWNER.email);
await pg.fill('#pass', OWNER.pass);
await pg.click('#btn-login');
await pg.waitForSelector('#app:not([hidden])');
await pg.waitForTimeout(1200);

await pg.click('#btn-new');
await pg.waitForTimeout(1200);
await pg.fill('#proj-title', 'vi-share test');
await pg.press('#proj-title', 'Enter');
await pg.waitForTimeout(400);

await pg.click('.step[data-stage="context"]');
await pg.waitForTimeout(300);
await pg.fill('#ctx-text', 'small roofing firms, price saturated, we build faster than we sell');
await pg.click('#ctx-save');
await pg.waitForTimeout(700);
await pg.click('.step[data-stage="ideation"]');
await pg.waitForTimeout(300);

await pg.fill('#note-input', 'a quote built from one measurement');
await pg.press('#note-input', 'Enter');
await pg.waitForTimeout(800);
ok((await pg.locator('.note').count()) === 1, 'the funnel has something to share');

// the dialog mints a link
await pg.click('#btn-share');
await pg.waitForTimeout(600);
await pg.click('#share-make');
await pg.waitForTimeout(1500);
const link = await pg.inputValue('#share-link');
ok(/^http.*\?s=\w{10,}$/.test(link), 'a public link was minted');
ok((await pg.locator('#share-list li').count()) >= 1, 'and it is listed with a revoke button');

// a guest with no session opens it
const g = await br.newContext({ viewport: { width: 1200, height: 950 } });
const gp = await g.newPage();
gp.on('pageerror', (e) => console.log('  guest log ' + e.message));
await gp.goto(link, { waitUntil: 'networkidle' });
await gp.waitForTimeout(2000);
ok(!(await gp.locator('#app').isHidden()), 'the link opens the funnel without an account');
ok((await gp.evaluate(() => document.body.dataset.role)) === 'view', 'a link is read-only');
ok(/shared funnel/i.test(await gp.textContent('#guest-banner')), 'the banner says it is a shared link');
ok((await gp.locator('.note').count()) === 1, 'the idea came with it');
ok(await gp.locator('#projects').isHidden(), 'no project rail for a guest');

await gp.click('.step[data-stage="context"]');
await gp.waitForTimeout(300);
ok(await gp.locator('#ctx-save').isHidden(), 'a reader has no save button');
ok((await gp.inputValue('#ctx-text')).length > 0, 'but the context is readable');

// revoking kills the link for everyone
await pg.click('#share-list li button');
await pg.waitForTimeout(1200);
await pg.reload({ waitUntil: 'networkidle' });
await gp.goto(link, { waitUntil: 'networkidle' });
await gp.waitForTimeout(1500);
ok(await gp.locator('#app').isHidden(), 'a revoked link shows the gate instead of the funnel');

// tidy up: the test owns one project and deletes it
pg.on('dialog', (d) => d.accept());
await pg.click('.proj-row.on .kill');
await pg.waitForTimeout(1200);
ok((await pg.inputValue('#proj-title').catch(() => '')) !== 'vi-share test', 'the test project was deleted again');

console.log(`\n${pass} passed, ${fail} failed`);
await br.close();
process.exit(fail ? 1 : 0);
