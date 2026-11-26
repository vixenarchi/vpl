/* the same bin, on a phone: in the rail, one word wide, still a 30 px target */
import { chromium } from 'playwright';
import { OWNER } from './_account.mjs';
const APPS = [['vn', 8102], ['vi', 8100], ['vr', 8101], ['vz', 8103], ['vd', 8104], ['vc', 8105], ['va', 8107]];
const br = await chromium.launch();
for (const [app, port] of APPS) {
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pg = await ctx.newPage();
  await pg.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(1500);
  if (await pg.locator('#email').isVisible().catch(() => false)) {
    await pg.fill('#email', OWNER.email); await pg.fill('#pass', OWNER.pass);
    await pg.click('#btn-login');
  }
  await pg.waitForTimeout(4000);
  const hasToggle = await pg.locator('#btn-projects').count();
  if (hasToggle) { await pg.click('#btn-projects'); await pg.waitForTimeout(900); }
  await pg.locator('#proj-list li').first().click().catch(() => {});
  await pg.waitForTimeout(1500);
  if (hasToggle) {
    const open = await pg.evaluate(() => document.body.dataset.rail === 'open');
    if (!open) { await pg.click('#btn-projects'); await pg.waitForTimeout(900); }
  }
  const r = await pg.evaluate(() => {
    const bin = [...document.querySelectorAll('#btn-bin, #btn-trash, #btn-job-bin')].filter((e) => e.offsetParent);
    const b = bin[0];
    const box = b ? b.getBoundingClientRect() : null;
    const at = box ? document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) : null;
    return {
      sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bins: bin.map((e) => ({ t: e.textContent.replace(/\s+/g, ' ').trim().slice(0, 18),
        x: Math.round(e.getBoundingClientRect().x), y: Math.round(e.getBoundingClientRect().y),
        w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height) })),
      hit: b ? (at === b || b.contains(at)) : null,
    };
  });
  console.log(app.padEnd(3), 'sideways', r.sideways, 'reachable', r.hit, JSON.stringify(r.bins));
  await ctx.close();
}
await br.close();
