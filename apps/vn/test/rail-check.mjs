/* The rail's edge is a handle.
 *
 * Every app puts the list of things on the left, and every app has one fixed
 * width for it. That width is a guess about somebody else's words: "untitled
 * spec" fits in 14 rem, "Kontrola pristupa — poglavlje 4.2" does not. So the
 * edge is draggable, the width is remembered, and the work column keeps its
 * share of the window.
 *
 * One suite, seven apps. What is checked here:
 *   1. there is exactly one grip, it lives inside the rail, on its right edge
 *   2. dragging it right makes the rail wider by the distance dragged
 *   3. the width survives a reload (a setting nobody keeps is not a setting)
 *   4. the arrow keys resize it too (a drag-only control is a mouse-only control)
 *   5. a double-click puts it back to the app's own default
 *   6. it is clamped: it cannot swallow the work column, and it cannot vanish
 *   7. on a phone there is no grip at all — the rail is a drawer there
 *   8. the page never gains a horizontal scrollbar because of it
 *
 *   APP=vr PORT=8101 VPL_EMAIL=… VPL_PASS=… node rail-check.mjs
 */
import { chromium } from 'playwright';

const APP = process.env.APP || 'vi';
const PORT = process.env.PORT || 8100;
const BASE = `http://127.0.0.1:${PORT}/`;
const EMAIL = process.env.VPL_EMAIL;
const PASS = process.env.VPL_PASS;

if (!EMAIL || !PASS) {
  console.log('set VPL_EMAIL and VPL_PASS to a test account');
  process.exit(78);      // not configured: skipped, never green
}

let pass = 0;
let fail = 0;
const check = (ok, label, extra = '') => {
  if (ok) { pass++; console.log(`  ok   ${label}`); return; }
  fail++; console.log(`  FAIL ${label}${extra ? ' — ' + extra : ''}`);
};
const near = (a, b, tol = 3) => Math.abs(a - b) <= tol;

/* vn calls its rail a list; every other app calls it projects */
const RAIL = APP === 'vn' ? '#list' : '#projects';

const br = await chromium.launch();
const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
const pg = await ctx.newPage();
const errs = [];
pg.on('pageerror', (e) => errs.push(e.message));

const signIn = async () => {
  await pg.goto(BASE, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(900);
  const email = pg.locator('#email');
  if (await email.isVisible().catch(() => false)) {
    await email.fill(EMAIL);
    await pg.fill('#pass', PASS);
    await pg.click('#btn-login');
    await pg.waitForTimeout(2600);
  }
  await pg.waitForTimeout(1200);
};

const width = () => pg.evaluate((sel) => {
  const el = document.querySelector(sel);
  return el ? Math.round(el.getBoundingClientRect().width) : 0;
}, RAIL);

await signIn();

console.log(`\n${APP} · the rail's edge\n`);

/* ── 1. one grip, inside the rail, on its right edge ──────────────────── */
const grips = pg.locator('.rail-grip');
check(await grips.count() === 1, 'there is one grip, not none and not two');
const geom = await pg.evaluate((sel) => {
  const rail = document.querySelector(sel);
  const g = document.querySelector('.rail-grip');
  if (!rail || !g) return null;
  const r = rail.getBoundingClientRect();
  const gr = g.getBoundingClientRect();
  return {
    inside: g.parentElement === rail || rail.contains(g),
    rightGap: Math.round(r.right - gr.right),
    h: Math.round(gr.height),
    railH: Math.round(r.height),
    cursor: getComputedStyle(g).cursor,
    role: g.getAttribute('role'),
    label: g.getAttribute('aria-label') || '',
    tab: g.tabIndex,
  };
}, RAIL);
check(!!geom && geom.inside, 'the grip belongs to the rail');
check(!!geom && Math.abs(geom.rightGap) <= 6, 'it sits on the rail\'s right edge', geom ? `gap ${geom.rightGap}px` : 'no geometry');
check(!!geom && geom.h >= geom.railH - 2, 'it runs the rail\'s full height', geom ? `${geom.h}/${geom.railH}` : '');
check(!!geom && geom.cursor === 'col-resize', 'the pointer says what it does');
check(!!geom && geom.role === 'separator', 'a screen reader hears a separator');
check(!!geom && geom.tab === 0, 'and it can be reached with Tab');

const defaultW = await width();
check(defaultW > 150 && defaultW < 300, 'the rail starts at a readable width', `${defaultW}px`);

/* ── 2. drag right, and by the distance dragged ───────────────────────── */
const box = await pg.locator('.rail-grip').boundingBox();
await pg.mouse.move(box.x + box.width / 2, box.y + 200);
await pg.mouse.down();
await pg.mouse.move(box.x + box.width / 2 + 80, box.y + 200, { steps: 8 });
await pg.mouse.up();
await pg.waitForTimeout(250);
const dragged = await width();
check(near(dragged, defaultW + 80, 6), 'dragging 80px right widens the rail by 80', `${defaultW} → ${dragged}`);

/* the work column must still be the bigger share of the window */
const shares = await pg.evaluate((sel) => {
  const rail = document.querySelector(sel);
  return { rail: Math.round(rail.getBoundingClientRect().width), win: window.innerWidth };
}, RAIL);
check(shares.rail < shares.win * 0.5, 'the work keeps most of the window', `${shares.rail} of ${shares.win}`);

/* ── 3. the width is remembered ───────────────────────────────────────── */
await pg.reload({ waitUntil: 'networkidle' });
await pg.waitForTimeout(1600);
const afterReload = await width();
check(near(afterReload, dragged, 4), 'the width survives a reload', `${afterReload}px after reload`);

/* ── 4. the keyboard resizes it too ──────────────────────────────────── */
await pg.locator('.rail-grip').focus();
await pg.keyboard.press('ArrowRight');
await pg.keyboard.press('ArrowRight');
await pg.waitForTimeout(220);
const byKeys = await width();
check(byKeys > afterReload + 20, 'two ArrowRight presses widen it by two steps', `${afterReload} → ${byKeys}`);
await pg.keyboard.press('ArrowLeft');
await pg.waitForTimeout(200);
check(near(await width(), byKeys - 16, 4), 'ArrowLeft narrows it again');

/* ── 5. clamped, both ways ───────────────────────────────────────────── */
for (let i = 0; i < 12; i++) await pg.keyboard.press('End');
await pg.waitForTimeout(250);
const widest = await width();
check(widest <= Math.max(460, Math.round(shares.win * 0.46)) + 2, 'it cannot swallow the work column', `${widest}px`);
for (let i = 0; i < 20; i++) await pg.keyboard.press('Home');
await pg.waitForTimeout(250);
const narrowest = await width();
check(narrowest >= 168, 'and it cannot shrink past the row it holds', `${narrowest}px`);

/* ── 6. a double-click goes back to the default ──────────────────────── */
await pg.locator('.rail-grip').dblclick();
await pg.waitForTimeout(300);
const reset = await width();
check(near(reset, defaultW, 4), 'double-click resets it to the app\'s own width', `${reset}px vs ${defaultW}px`);

/* ── 8. no horizontal overflow, ever ─────────────────────────────────── */
const overflow = await pg.evaluate(() => {
  const de = document.documentElement;
  return Math.max(0, de.scrollWidth - de.clientWidth);
});
check(overflow === 0, 'the page does not scroll sideways', `${overflow}px`);

/* ── 7. a phone has no grip ──────────────────────────────────────────── */
const phone = await ctx.newPage();
await phone.setViewportSize({ width: 390, height: 780 });
await phone.goto(BASE, { waitUntil: 'networkidle' });
await phone.waitForTimeout(2000);
const phoneGrip = await phone.evaluate(() => {
  const g = document.querySelector('.rail-grip');
  if (!g) return 'absent';
  const r = g.getBoundingClientRect();
  const cs = getComputedStyle(g);
  return r.width > 0 && cs.display !== 'none' ? `${Math.round(r.width)}px visible` : 'hidden';
});
check(phoneGrip !== 'absent' && phoneGrip === 'hidden', 'on a phone the grip is hidden, not just small', String(phoneGrip));
await phone.close();

check(errs.length === 0, 'no page errors', errs.slice(0, 2).join(' · '));

await br.close();
console.log(`\n  ${pass} ok, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
