/* vr — screenshots for a human to look at. Not a test; a contact sheet.
 *
 *   VR_URL=http://127.0.0.1:8101 node vr-shots.mjs
 *
 * Seeds one document straight into the database as the agent account, then
 * photographs the sheet: light, a row open, all columns, dark, and a phone.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { OWNER, GUEST } from './_account.mjs';

/* The theme left the bar: it is one press inside settings now (◐ next to the
 * word), and the palette tab underneath has all three. This is the same press. */
async function darkMode(pgOrPage) {
  const pg = pgOrPage;
  await pg.click('#btn-ai');
  await pg.waitForSelector('#ai-dialog[open]');
  await pg.click('#ai-dialog [data-a=mode]');
  await pg.waitForTimeout(150);
  await pg.click('#ai-dialog [data-a=close]');
  await pg.waitForTimeout(150);
}

const B = process.env.VR_URL || 'http://127.0.0.1:8101';
const cfg = readFileSync(new URL('../../../apps/vr/config.local.js', import.meta.url), 'utf8');
const URL_ = /url:\s*'([^']+)'/.exec(cfg)[1];
const KEY = /anon:\s*'([^']+)'/.exec(cfg)[1];

async function token() {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: OWNER.email, password: OWNER.pass }),
  });
  return (await r.json()).access_token;
}
const T = await token();
const H = { apikey: KEY, Authorization: 'Bearer ' + T, 'Content-Type': 'application/json', Prefer: 'return=representation' };
const api = async (path, method = 'GET', body) => {
  const r = await fetch(URL_ + '/rest/v1/' + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(await r.text());
  return r.status === 204 ? null : r.json();
};

const me = JSON.parse(Buffer.from(T.split('.')[1], 'base64url').toString()).sub;
// one document, so a second run does not leave a crowd behind it
const old = await api('vr_projects?select=id,title');
for (const p of old) if (p.title === 'roofing quote · autumn') await api('vr_projects?id=eq.' + p.id, 'DELETE');
const [p] = await api('vr_projects', 'POST', {
  user_id: me,
  title: 'roofing quote · autumn',
  brief: 'Every quote for a roof replacement leaves the same four numbers in the same order, '
       + 'and every crew fills them in differently. This sheet is the quote one screen deep, '
       + 'for Croatian and Austrian firms of twenty to eighty people.',
  assumptions: 'a measuring visit happens before a quote\nphotos come from the phone that did the visit',
  scope: 'no invoicing, no accounting, no scheduling of crews',
});
const row = (r) => ({
  project_id: p.id, user_id: me, kind: 'functional', strength: 'must', theme: '', category: '',
  title: '', statement: '', detail: '', asis: '', tobe: '', horizon: '', source: '',
  verification: '', metric: '', target: '', conditions: '', clause: '', status: 'draft', pos: 0, ...r,
});
await api('vr_reqs', 'POST', [
  row({ pos: 1, kind: 'functional', strength: 'must', theme: 'the visit',
    title: 'measure once, in one place',
    statement: 'The surveyor shall record every measurement of one roof in a single visit form.',
    verification: 'demo on a phone, on a real roof', source: 'Damir, crew lead', horizon: 'short',
    asis: 'paper, photographed and typed again', tobe: 'one form, offline, on the phone',
    detail: 'Pitch, area, dormers, chimneys and gutters. Today these live in three notebooks.' }),
  row({ pos: 2, kind: 'functional', strength: 'must', theme: 'the visit',
    title: 'photograph with the measurement',
    statement: 'Each measurement shall carry the photo it was taken from.',
    verification: 'review with two surveyors', source: 'Damir', horizon: 'short' }),
  row({ pos: 3, kind: 'nonfunctional', strength: 'must', theme: 'the visit',
    title: 'works without signal',
    statement: 'The visit form shall accept entries and photos with no network connection.',
    metric: 'offline entry', target: '100 % of the form', conditions: 'on a phone with no signal for 30 minutes',
    verification: 'flight mode for half an hour, then sync', horizon: 'short' }),
  row({ pos: 4, kind: 'functional', strength: 'must', theme: 'the price',
    title: 'the same four numbers',
    statement: 'A quote shall print material, labour, access and waste as four separate lines.',
    verification: 'compare twenty past quotes', source: 'the 2025 price sheet', horizon: 'short' }),
  row({ pos: 5, kind: 'nonfunctional', strength: 'must', theme: 'the price',
    title: 'price in under a minute',
    statement: 'Turning a finished visit into a priced quote shall take under sixty seconds.',
    metric: 'quote time', target: 'under 60 s', conditions: 'a visit with 30 measurements',
    verification: 'stopwatch, ten times', horizon: 'mid' }),
  row({ pos: 6, kind: 'constraint', strength: 'must', theme: 'the price',
    title: 'VAT and the law',
    statement: 'Every quote shall show VAT separately and keep the wording the law requires.',
    clause: 'Zakon o PDV-u, čl. 79 — the invoice and quote wording', source: 'the accountant',
    verification: 'the accountant reads one quote', horizon: 'short' }),
  row({ pos: 7, kind: 'functional', strength: 'optional', theme: 'the customer',
    title: 'send it as a link',
    statement: 'The customer shall be able to open the quote in a browser without an account.',
    verification: 'one real customer, one link', horizon: 'mid' }),
  row({ pos: 8, kind: 'rule', strength: 'optional', theme: 'the customer',
    title: 'a quote is valid 14 days',
    statement: 'A quote shall stop being valid fourteen days after it is issued.',
    source: 'practice, not law', horizon: 'mid' }),
  row({ pos: 9, kind: 'functional', strength: 'wish', theme: 'the customer',
    title: 'order from the quote',
    statement: 'The customer could accept the quote with one tap and see the crew date.',
    horizon: 'long' }),
]);
const term = (t, meaning) => ({ project_id: p.id, user_id: me, term: t, meaning });
await api('vr_terms', 'POST', [
  term('dormer', 'a window box that sticks out of the roof plane.'),
  term('access', 'how the crew and material get to the roof: scaffolding, lift or ladder.'),
  term('waste', 'cut-offs and damaged tiles, priced as a percentage of material.'),
]);

const br = await chromium.launch();
const shot = async (name, opts = {}, steps = []) => {
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, ...opts });
  await ctx.addInitScript((id) => { try { localStorage.setItem('vpl.vr.last', id); } catch {} }, p.id);
  const page = await ctx.newPage();
  await page.goto(B, { waitUntil: 'networkidle' });
  await page.fill('#email', OWNER.email);
  await page.fill('#pass', OWNER.pass);
  await page.click('#btn-login');
  await page.waitForSelector('#app:not([hidden])');
  await page.waitForTimeout(1600);
  for (const s of steps) { await s(page); await page.waitForTimeout(500); }
  await page.screenshot({ path: `/tmp/${name}.png`, fullPage: false });
  await ctx.close();
  console.log('shot', name);
};

await shot('vr-sheet');
await shot('vr-open', {}, [async (page) => page.locator('#rows tr[data-id]').nth(2).locator('.req-open').click()]);
await shot('vr-dark', { colorScheme: 'dark' }, [async (page) => darkMode(page)]);
await shot('vr-print', {}, [async (page) => page.emulateMedia({ media: 'print' })]);
await shot('vr-phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

await br.close();
console.log('document id', p.id);
