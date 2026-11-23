/* One picture for a shared link (1200×630), drawn with the site's own palette
 * rather than asked for: a link preview should look like the page it points at.
 *
 *   node og-card.mjs         # writes ../../www/og.png
 *
 * No fonts are downloaded and nothing is invented — it is the hero set in the
 * same serif over the same paper, with the eight letters along the bottom.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../www/og.png');

const cards = ['vn', 'vi', 'vr', 'vz', 'vd', 'vc', 'vp', 'va'];
const html = `<!doctype html><meta charset="utf-8">
<style>
  @page { size: 1200px 630px; margin: 0 }
  html, body { margin: 0; width: 1200px; height: 630px }
  body {
    background: #faf8f4; color: #1f1d1a;
    font-family: 'Newsreader', ui-serif, Georgia, serif;
    padding: 78px 84px; box-sizing: border-box;
    display: flex; flex-direction: column; justify-content: space-between;
  }
  .mark { display: flex; align-items: center; gap: 12px; font-size: 30px }
  .glyph {
    width: 46px; height: 46px; border-radius: 10px; background: #1f1d1a; color: #faf8f4;
    display: grid; place-items: center; font-size: 30px; line-height: 1;
  }
  .kicker {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 15px; letter-spacing: 0.16em; text-transform: uppercase;
    color: #8a8378; margin: 46px 0 18px;
  }
  h1 { font-size: 76px; line-height: 1.03; font-weight: 400; letter-spacing: -0.02em; margin: 0; max-width: 900px }
  .sub { font-size: 26px; color: #55504a; margin: 22px 0 0; max-width: 820px; line-height: 1.35 }
  .row { display: flex; gap: 10px; align-items: center }
  .row span {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 18px;
    color: #55504a; border: 1px solid #e0d9cd; border-radius: 6px; padding: 6px 12px;
  }
  .rule { height: 1px; background: #e0d9cd; margin: 0 0 22px }
  .foot { display: flex; justify-content: space-between; align-items: center }
  .addr { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 19px; color: #8a8378 }
</style>
<div class="mark"><div class="glyph">t</div><div>terg</div></div>
<div>
  <p class="kicker">eight small applications</p>
  <h1>Software small enough to understand</h1>
  <p class="sub">Notes, ideas, requirements, a dictionary, documents, controls, keys
    and architecture — one account, one look, one database.</p>
</div>
<div>
  <div class="rule"></div>
  <div class="foot">
    <div class="row">${cards.map((c) => `<span>${c}</span>`).join('')}</div>
    <div class="addr">www.terg.hr</div>
  </div>
</div>`;

const br = await chromium.launch();
const pg = await br.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await pg.setContent(html, { waitUntil: 'load' });
await pg.screenshot({ path: OUT });
await br.close();
const size = readFileSync(OUT).length;
console.log(`og.png — 1200×630, ${Math.round(size / 1024)} KB`);
