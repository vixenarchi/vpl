/* Where is the bin, in every app, and is it a place with a word? */
import { chromium } from 'playwright';
import { OWNER } from './_account.mjs';

const APPS = [
  ['vn', 8102], ['vi', 8100], ['vr', 8101], ['vz', 8103],
  ['vd', 8104], ['vc', 8105], ['vp', 8106], ['va', 8107],
];
const br = await chromium.launch();
const rows = [];
for (const [app, port] of APPS) {
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(1800);
  if (await pg.locator('#email').isVisible().catch(() => false)) {
    await pg.fill('#email', OWNER.email); await pg.fill('#pass', OWNER.pass);
    await pg.click('#btn-login');
  }
  await pg.waitForTimeout(4200);
  /* open the first thing in the rail so a project-scoped bin has something */
  await pg.locator('#proj-list li').first().click().catch(() => {});
  await pg.waitForTimeout(1800);
  const info = await pg.evaluate(() => {
    const rect = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const rail = document.getElementById('projects');
    const railR = rail ? rail.getBoundingClientRect() : null;
    const bins = [...document.querySelectorAll('#btn-bin, #btn-job-bin, #btn-trash')].filter((e) => e.offsetParent);
    return {
      railRight: railR ? Math.round(railR.right) : null,
      bins: bins.map((e) => ({ id: e.id, ...rect(e), text: e.textContent.replace(/\s+/g, ' ').trim().slice(0, 22),
        inRail: rail ? rail.contains(e) : false })),
      foot: !!document.querySelector('.bin-foot'),
      footVisible: (() => { const f = document.querySelector('.bin-foot'); return !!(f && f.offsetParent); })(),
    };
  });
  rows.push({ app, ...info, errors: errs.slice(0, 2) });
  await ctx.close();
}
for (const r of rows) {
  console.log(`\n${r.app}  railRight=${r.railRight}  foot=${r.footVisible}`);
  for (const b of r.bins) console.log(`   ${b.id.padEnd(13)} ${String(b.x).padStart(4)},${String(b.y).padStart(3)} ${String(b.w).padStart(3)}x${b.h} rail=${b.inRail} “${b.text}”`);
  if (!r.bins.length) console.log('   (no bin button visible)');
  if (r.errors.length) console.log('   errors:', r.errors);
}
await br.close();
