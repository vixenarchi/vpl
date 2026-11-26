import { chromium } from 'playwright';
import { OWNER } from './_account.mjs';
const br = await chromium.launch();
for (const [app, port, w, h, mobile] of [['vn', 8102, 1280, 900, false], ['vn', 8102, 390, 844, true],
  ['vz', 8103, 1280, 900, false], ['vz', 8103, 390, 844, true]]) {
  const ctx = await br.newContext({ viewport: { width: w, height: h }, hasTouch: mobile, isMobile: mobile });
  const pg = await ctx.newPage();
  await pg.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(1500);
  if (await pg.locator('#email').isVisible().catch(() => false)) {
    await pg.fill('#email', OWNER.email); await pg.fill('#pass', OWNER.pass);
    await pg.click('#btn-login');
  }
  await pg.waitForTimeout(4000);
  await pg.locator('#proj-list li').first().click().catch(() => {});
  await pg.waitForTimeout(1500);
  if (mobile) {
    await pg.evaluate(() => { const b = document.getElementById('btn-projects'); if (b) b.click(); });
    await pg.waitForTimeout(600);
    await pg.evaluate(() => { const l = document.querySelector('.list'); if (l && !l.classList.contains('open')) document.getElementById('btn-projects').click(); });
    await pg.waitForTimeout(800);
  }
  const r = await pg.evaluate(() => {
    const b = document.getElementById('btn-bin') || document.getElementById('btn-trash');
    if (!b) return { none: true };
    const box = b.getBoundingClientRect();
    const pts = [[0.5, 0.5], [0.5, 0.2]].map(([fx, fy]) => {
      const e = document.elementFromPoint(box.x + box.width * fx, box.y + box.height * fy);
      return e === b || b.contains(e) ? 'bin' : (e?.id || e?.className || e?.tagName);
    });
    const l = document.querySelector('.list');
    return { rect: [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)],
      text: b.textContent.replace(/\s+/g, ' ').trim().slice(0, 20), pts,
      listClass: l ? l.className : null, winH: innerHeight };
  });
  console.log(app, mobile ? 'phone' : 'desk ', JSON.stringify(r));
  await ctx.close();
}
await br.close();
