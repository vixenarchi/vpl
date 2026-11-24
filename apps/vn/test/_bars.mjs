import { chromium } from 'playwright';
import { OWNER } from './_account.mjs';
const APPS = [['vn',8102],['vi',8100],['vz',8103],['vr',8101],['vd',8104],['vc',8105],['vp',8106],['va',8107]];
const br = await chromium.launch();
for (const [app, port] of APPS) {
  const ctx = await br.newContext({ viewport: { width: 1280, height: 800 } });
  const pg = await ctx.newPage();
  await pg.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' }).catch(()=>{});
  try {
    await pg.fill('#email', OWNER.email); await pg.fill('#pass', OWNER.pass);
    await pg.click('#btn-login'); await pg.waitForSelector('#app:not([hidden])', { timeout: 15000 });
  } catch (e) { console.log(app, 'login issue', e.message.slice(0,60)); }
  await pg.waitForTimeout(1200);
  const bar = await pg.evaluate(() => {
    const b = document.querySelector('header.bar');
    if (!b) return null;
    return [...b.children].map((c) => ({
      tag: c.tagName.toLowerCase(),
      id: c.id || '',
      cls: String(c.className || '').slice(0, 24),
      txt: (c.textContent || '').trim().slice(0, 14),
      vis: c.offsetParent !== null && !c.hidden,
      w: Math.round(c.getBoundingClientRect().width),
    }));
  });
  console.log(app, JSON.stringify(bar));
  await pg.locator('header.bar').screenshot({ path: `/home/vergovic/vixen/.shots/bar-${app}.png` }).catch(()=>{});
  await ctx.close();
}
await br.close();
