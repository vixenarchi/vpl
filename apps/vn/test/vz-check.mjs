/* vz — zed check. Plays a person with a project, a guest with a link, a
 * published service and a phone. Leaves nothing behind.
 *
 *   node vz-check.mjs                      # http://127.0.0.1:8103
 *   VZ_URL=https://vz.terg.hr node vz-check.mjs
 */
import { chromium } from 'playwright';
import { OWNER, GUEST } from './_account.mjs';

const B = process.env.VZ_URL || 'http://127.0.0.1:8103';
const REMOTE = !/127\.0\.0\.1|localhost/.test(B);
const STAMP = Math.random().toString(36).slice(2, 6);

let pass = 0; let fail = 0;
const ok = (cond, what) => {
  if (cond) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what); }
};
const errors = [];
async function until(fn, ms = 12000) {
  const t0 = Date.now();
  for (;;) {
    let v; try { v = await fn(); } catch { v = false; }
    if (v) return v;
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 80));
  }
}
async function login(pg, who) {
  await pg.goto(B, { waitUntil: 'networkidle' });
  await pg.fill('#email', who.email);
  await pg.fill('#pass', who.pass);
  await pg.click('#btn-login');
  await pg.waitForSelector('#app:not([hidden])');
  await pg.waitForTimeout(1200);
}

const br = await chromium.launch();
const ctx = await br.newContext({ viewport: { width: 1400, height: 950 } });
const pg = await ctx.newPage();
pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
pg.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
pg.on('dialog', (d) => d.accept());

await login(pg, OWNER);
ok(await pg.locator('#app').isVisible(), 'signed in, the app is up');

// ── a project, and three keys
if (await pg.locator('#welcome').isVisible()) await pg.click('#btn-first');
else await pg.click('#btn-new');
await pg.waitForTimeout(1200);
await pg.fill('#proj-title', 'vz-check ' + STAMP);
await pg.locator('#proj-title').blur();
await pg.waitForTimeout(700);

for (const [k, v] of [['db.host', 'db2.dev.local'], ['db.user', 'db2admin'], ['system.throttling', '30']]) {
  await pg.fill('#add-key', k);
  await pg.fill('#add-val', v);
  await pg.press('#add-val', 'Enter');
  ok(await until(async () => (await pg.textContent('#add-msg')).includes('added')), `“${k}” added`);
}
ok(await until(async () => (await pg.locator('#pairs .pair').count()) === 3), 'three keys on the sheet');
ok((await pg.locator('#pairs .key').first().textContent()).trim() === 'db.host', 'keys sit in alphabetical order');
ok((await pg.textContent('#proj-meta')).includes('3 keys'), 'the meta line counts them');
ok((await pg.locator('#pairs .val.folded').count()) === 3, 'values are folded by default');

// ── one value opens, and closes
await pg.locator('#pairs .key').first().click();
await pg.waitForTimeout(250);
ok((await pg.locator('#pairs .val.open').textContent()).trim() === 'db2.dev.local', 'a click unfolds one value');
await pg.locator('#pairs .key').first().click();
await pg.waitForTimeout(250);
ok((await pg.locator('#pairs .val.open').count()) === 0, 'and a second click folds it back');

// ── show values is a project switch and it survives a reload
await pg.click('#btn-values');
await pg.waitForTimeout(700);
ok((await pg.locator('#pairs .val.folded').count()) === 0, '“show values” puts them on the sheet');
await pg.reload({ waitUntil: 'networkidle' });
await pg.waitForTimeout(1800);
ok((await pg.locator('#pairs .pair').count()) === 3, 'after a reload the project is the one we left');
ok((await pg.locator('#pairs .val.folded').count()) === 0, 'and values stay shown');

// ── a name ignores case; a second write is a replace
await pg.fill('#add-key', 'DB.HOST');
await pg.fill('#add-val', 'db3.dev.local');
await pg.press('#add-val', 'Enter');
ok(await until(async () => (await pg.textContent('#add-msg')).includes('replaced')), 'DB.HOST replaces db.host instead of adding');
ok((await pg.locator('#pairs .pair').count()) === 3, 'the count did not grow');

// ── editing: key and value, saved as you type
await pg.locator('#pairs [data-edit]').first().click();
await pg.waitForTimeout(300);
await pg.fill('#pairs .e-val', 'line one\nline two');
ok(await until(async () => (await pg.locator('#pairs .e-foot .msg').first().textContent()).trim() === 'saved'),
  'the value saves by itself');
await pg.locator('#pairs [data-close]').first().click();
await pg.waitForTimeout(300);
ok((await pg.locator('#pairs .val.open').textContent()).includes('line two'), 'a value can be two lines');
await pg.locator('#pairs .key').first().click();
await pg.waitForTimeout(250);

// ── search looks at keys and at values
await pg.fill('#q', 'thrott');
await pg.waitForTimeout(300);
ok((await pg.locator('#pairs .pair').count()) === 1, 'search finds a key');
await pg.fill('#q', 'db2admin');
await pg.waitForTimeout(300);
ok((await pg.locator('#pairs .pair').count()) === 1, 'search finds a value');
await pg.fill('#q', '');
await pg.waitForTimeout(300);

// ── twenty rows a page
const bulk = Array.from({ length: 20 }, (_, i) => `bulk.${String(i + 1).padStart(2, '0')}=v${i + 1}`).join('\n');
await pg.click('#btn-paste');
await pg.waitForTimeout(300);
await pg.fill('#paste-text', bulk);
await pg.click('#paste-do');
ok(await until(async () => /added/.test(await pg.textContent('#toast')), 'twenty keys at once, by paste'), 'a paste adds twenty keys');
ok(await until(async () => (await pg.textContent('#proj-meta')).includes('23 keys')), 'twenty-three keys in all');
ok(await until(async () => (await pg.locator('#pairs .pair').count()) === 20), 'twenty rows to a page');
ok((await pg.textContent('#pager')).includes('page 1 / 2'), 'the pager says where we are');
await pg.click('#pager button[data-pg="1"]');
await pg.waitForTimeout(300);
ok((await pg.locator('#pairs .pair').count()) === 3, 'the second page holds the rest');
await pg.click('#pager button[data-pg="-1"]');
await pg.waitForTimeout(300);

// ── copy builds markdown from what is on the sheet
await pg.click('#btn-copy');
ok(await until(async () => (await pg.textContent('#toast')).includes('clipboard')), 'copy says the sheet is on the clipboard');

// ── the bin
await pg.locator('#pairs .pair').first().hover();
await pg.locator('#pairs [data-bin]').first().click();
ok(await until(async () => (await pg.textContent('#proj-meta')).includes('22 keys')), 'a row moves to the bin');
await pg.click('#btn-bin');
ok(await until(async () => (await pg.locator('#bin-list .pair').count()) >= 1), 'the bin has it');
await pg.locator('#bin-list [data-restore]').first().click();
ok(await until(async () => (await pg.locator('#bin-list .pair').count()) === 0), 'restore empties the bin');
await pg.click('#btn-bin-back');
await pg.waitForTimeout(500);
ok(await until(async () => (await pg.textContent('#proj-meta')).includes('23 keys')), 'and the row is back on the sheet');

// ── paste: .env, and a JSON object on its own line
await pg.click('#btn-paste');
await pg.waitForTimeout(300);
await pg.fill('#paste-text', 'export PASTE_A=one\nPASTE_B="two"\n{"paste.c": 3}');
await pg.click('#paste-do');
ok(await until(async () => /added/.test(await pg.textContent('#toast'))), 'paste reports what it added');
await pg.fill('#q', 'paste');
await pg.waitForTimeout(400);
ok((await pg.locator('#pairs .pair').count()) === 3, 'three pasted keys, quoted and JSON alike');
await pg.fill('#q', '');
await pg.waitForTimeout(300);

// ── sharing: a link that reads, a person who writes
await pg.click('#btn-share');
await pg.waitForTimeout(400);
await pg.click('#share-make');
ok(await until(async () => /\?s=\w{10,}/.test(await pg.inputValue('#share-link'))), 'a public link is minted');
const link = await pg.inputValue('#share-link');
await pg.fill('#share-email', GUEST.email);
await pg.selectOption('#share-role', 'edit');
await pg.click('#share-add');
ok(await until(async () => (await pg.textContent('#share-msg')).includes('can write')), 'one person may write');

// ── publishing, and the service it makes
await pg.check('#publish-on');
ok(await until(async () => !(await pg.locator('#publish-urls').isHidden())), 'publishing shows the service addresses');
ok((await pg.inputValue('#pub-map')).includes('/p/'), 'the map lives at /p/<code>');
ok((await pg.inputValue('#pub-one')).includes('/p/'), 'one key lives under it');
const pubMap = await pg.inputValue('#pub-map');
const pubOne = await pg.inputValue('#pub-one');
await pg.click('#share-x');
await pg.waitForTimeout(400);

if (REMOTE) {
  const map = await fetch(pubMap).then((r) => r.json());
  const oneKey = decodeURIComponent(pubOne.split('/').pop());
  ok(map['bulk.01'] === 'v1' && map['system.throttling'] === '30', 'the service answers with the whole map');
  const one = await fetch(pubOne);
  ok(one.status === 200 && (await one.text()) === map[oneKey], 'and one key answers as plain text');
  const upper = await fetch(pubMap + '/' + oneKey.toUpperCase());
  ok(upper.status === 200 && (await upper.text()) === map[oneKey], 'the service ignores case in a key');
  const miss = await fetch(pubOne.replace(/\/[^/]+$/, '/no.such.key'));
  ok(miss.status === 404, 'a key that is not there is 404');
  const gone = await fetch(pubMap.replace(/p\/\w+/, 'p/aaaaaaaaaaaaaaaaaaaa'));
  ok(gone.status === 404, 'a code that is not published is 404 too');
  ok((one.headers.get('access-control-allow-origin') || '') === '*', 'the service says * on CORS');
} else {
  console.log('  skip  the REST service needs the deployed origin');
}

// ── a guest with the link
const gctx = await br.newContext({ viewport: { width: 900, height: 800 } });
const gp = await gctx.newPage();
gp.on('pageerror', (e) => errors.push('guest: ' + e.message));
gp.on('dialog', (d) => d.accept());
await gp.goto(link, { waitUntil: 'networkidle' });
await gp.waitForTimeout(1600);
/* one shape for the reader's banner in all seven apps that can share:
 * *what this is — what you can do* (packages/shell/words.js) */
const guestBanner = (await gp.locator('#guest-banner').textContent()).trim();
ok(/shared sheet/.test(guestBanner) && /copy/.test(guestBanner),
  'a guest sees what the link is, and what they can do: ' + guestBanner);
ok((await gp.locator('#pairs .pair').count()) > 0, 'and the keys');
ok(await gp.locator('#projects').isHidden(), 'a guest has no rail of projects');
ok(await gp.locator('#add').isHidden(), 'and no add box');

// ── the same link, signed in with a grant: the add box is back
const ownerKeys = Number((await pg.textContent('#proj-meta')).match(/(\d+) keys/)[1]);
await gp.goto(B, { waitUntil: 'networkidle' });
await gp.fill('#email', GUEST.email); await gp.fill('#pass', GUEST.pass);
await gp.click('#btn-login'); await gp.waitForSelector('#app:not([hidden])');
await gp.waitForTimeout(1000);
await gp.goto(link, { waitUntil: 'networkidle' });
await gp.waitForTimeout(1800);
console.log('    banner:', (await gp.textContent('#guest-banner')).trim());
ok((await gp.locator('#guest-banner').textContent()).includes('may write'), 'a grant says: you may write');
ok(await gp.locator('#add').isVisible(), 'and the add box is there');
await gp.fill('#add-key', 'by.guest');
await gp.fill('#add-val', 'written by the guest');
await gp.press('#add-val', 'Enter');
ok(await until(async () => (await gp.textContent('#proj-meta')).includes(`${ownerKeys + 1} keys`)),
  'an editor may add a key');

// ── copy to mine: the reader becomes the owner of a copy
await gp.click('#btn-own');
ok(await until(async () => (await gp.locator('#guest-banner').isHidden())), 'copy to mine makes the reader the owner');
ok(await gp.locator('#projects').isVisible(), 'and the rail comes back');
ok(await until(async () => (await gp.textContent('#proj-meta')).includes(`${ownerKeys + 1} keys`)),
  'the copy has every key, including the guest one');

// ── the published page, read by a person
const pp = await gctx.newPage();
await pp.goto(B + '/?p=' + new URL(pubMap).pathname.split('/').pop(), { waitUntil: 'networkidle' });
await pp.waitForTimeout(1500);
ok((await pp.locator('#guest-banner').textContent()).includes('published'), 'a published page says so');
ok((await pp.locator('#pairs .pair').count()) > 0, 'and shows the keys');

// ── a phone
const phone = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const mp = await phone.newPage();
mp.on('pageerror', (e) => errors.push('phone: ' + e.message));
await login(mp, OWNER);
await mp.waitForTimeout(800);
ok((await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0,
  'a phone does not scroll sideways');
ok(await mp.locator('#btn-projects').isVisible(), 'a phone gets the rail button');
await mp.click('#btn-projects');
await mp.waitForTimeout(300);
ok((await mp.evaluate(() => document.body.dataset.rail)) === 'open', 'the rail opens as a drawer');
await phone.close();

// ── tidy up: both projects the check made go away
await gp.goto(B, { waitUntil: 'networkidle' });
await gp.waitForTimeout(1500);
const copyRow = gp.locator('.proj-row', { hasText: '(copy)' }).first();
if (await copyRow.count()) {
  await copyRow.hover();
  await copyRow.locator('.kill').click();
  await gp.waitForTimeout(800);
}
await gctx.close();
await pg.click('#btn-bin');
await pg.waitForTimeout(400);
if (await pg.locator('#bin-list .pair').count() === 0) {
  await pg.click('#btn-bin-back');
  await pg.waitForTimeout(300);
}
await pg.locator('.proj-row.on .kill').click();
ok(await until(async () => !(await pg.textContent('#proj-list')).includes('vz-check ' + STAMP)),
  'the check leaves no project behind');

ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors[0] : ''));

console.log(`\n${pass} passed, ${fail} failed`);
await br.close();
process.exit(fail ? 1 : 0);
