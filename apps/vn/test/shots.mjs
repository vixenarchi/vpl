/* Screenshots of the three surfaces, for a visual check. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, ''), PORT = 8093;
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const srv=createServer((q,r)=>{const u=new URL(q.url,'http://x').pathname;const n=u==='/'?'/index.html':u;
try{const b=readFileSync(join(ROOT,n));r.writeHead(200,{'content-type':MIME[n.slice(n.lastIndexOf('.'))]||'text/plain'});r.end(b)}catch{r.writeHead(404).end('x')}});
await new Promise(r=>srv.listen(PORT,'127.0.0.1',r));
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1280,height:860},deviceScaleFactor:1});
const p=await ctx.newPage();
const st=Date.now();
await p.goto(`http://127.0.0.1:${PORT}/`);
await p.screenshot({path:'/home/vergovic/vixen/v2/test/shot-gate.png'});
await p.fill('#email',`shot-${st}@example.com`); await p.fill('#pass','secret123');
await p.click('#btn-register'); await p.waitForSelector('#app',{state:'visible',timeout:20000});
await p.click('#btn-new'); await p.waitForFunction(()=>location.hash.startsWith('#/n/'));
await p.fill('#title','Why the funnel narrows');
await p.fill('#body',`## A note with structure

The funnel is not decoration. **Fewer** things should survive each gate.

- inbox: everything
- explore: worth thinking about
- build: we said yes

> A decision with no reason is not a decision.

\`\`\`mermaid
graph TD
  A[inbox] -->|gate 1| B[explore]
  B -->|gate 2| C[build]
\`\`\`

\`\`\`js
const stages = ['inbox', 'explore', 'build'];
\`\`\`
`);
await p.waitForTimeout(1500);
await p.keyboard.press('Control+e');
await p.waitForSelector('#rendered .mermaid-figure svg',{timeout:20000});
await p.waitForTimeout(400);
await p.screenshot({path:'/home/vergovic/vixen/v2/test/shot-note.png'});
// funnel
await p.click('#btn-send'); await p.waitForSelector('#gate-dialog[open]');
await p.fill('#gate-note','because narrowing is the method'); await p.click('#gate-ok');
await p.waitForTimeout(1500);
await p.click('#btn-funnel'); await p.waitForSelector('.stage');
await p.screenshot({path:'/home/vergovic/vixen/v2/test/shot-funnel.png'});
// phone
const ph=await ctx.newPage(); await ph.setViewportSize({width:375,height:720});
await ph.goto(`http://127.0.0.1:${PORT}/`); await ph.waitForSelector('#app',{state:'visible',timeout:20000});
await ph.waitForTimeout(900);
await ph.screenshot({path:'/home/vergovic/vixen/v2/test/shot-phone.png'});
await b.close(); srv.close();
console.log('shots written');
