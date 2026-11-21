// Dark Reader audit for slopswap.
//
// Loads every built page, records the colour of every visible element, switches on Dark Reader's
// dynamic engine (the same code the browser extension runs), records the colours again, and lists
// every saturated colour that came out grey, vanished, or changed hue. Pages carrying
// <meta name="darkreader-lock"> (build.py adds it to every page that is already dark) should report
// LOCKED and 0 bad; the light-only pages that Dark Reader is left to darken should report 0 bad too.
//
//   cd .tools && npm i darkreader playwright && npx playwright install chromium
//   python3 ../build.py && (python3 -m http.server -d ../_site 8123 &)
//   node darkreader-audit.js            # every page, light and dark system setting
//   node darkreader-audit.js V6/edge    # only pages whose path contains this; also saves screenshots
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const DR = fs.readFileSync(path.join(__dirname,'node_modules/darkreader/darkreader.js'),'utf8');
const ROOT = path.join(__dirname, '..', '_site');
const only = process.argv[2];
function pages(dir, out=[]){ for(const f of fs.readdirSync(dir)){ const p = path.join(dir,f); if(fs.statSync(p).isDirectory()) pages(p,out); else if(f.endsWith('.html')) out.push(path.relative(ROOT,p)); } return out; }
const COLLECT = () => {
  const P = ['color','backgroundColor','borderTopColor','borderLeftColor','borderBottomColor','borderRightColor','fill','stroke'];
  const parse = s => { const m = /rgba?\(([^)]+)\)/.exec(s||''); if(!m) return null; const v = m[1].split(/[ ,\/]+/).map(Number); return [v[0],v[1],v[2], v.length>3? v[3] : 1]; };
  const out = [];
  const all = [document.body, ...document.body.querySelectorAll('*')];
  all.forEach((el, i) => {
    const r = el.getBoundingClientRect(); if(r.width<1 || r.height<1) return;
    const cs = getComputedStyle(el); if(cs.visibility==='hidden' || cs.display==='none') return;
    const svg = el instanceof SVGElement; const rec = {i, tag: el.tagName.toLowerCase(), cls: (el.getAttribute('class')||'').slice(0,40), id: el.id||'', c:{} };
    for(const p of P){
      if((p==='fill'||p==='stroke') && !svg) continue;
      if(p.startsWith('border')){ const w = cs[p.replace('Color','Width')]; if(!w || parseFloat(w)===0) continue; }
      if(p==='color' && !(el.childNodes.length && [...el.childNodes].some(n=>n.nodeType===3 && n.textContent.trim()))) continue;
      const c = parse(cs[p]); if(c && c[3]>0.05) rec.c[p] = c;
    }
    // pseudo-elements with backgrounds
    for(const ps of ['::before','::after']){ const pc = getComputedStyle(el, ps); if(pc.content && pc.content!=='none'){ const c = parse(pc.backgroundColor); if(c && c[3]>0.05) rec.c['bg'+ps] = c; const bi = pc.backgroundImage; if(bi && bi!=='none') rec.c['img'+ps] = bi.slice(0,300); const cc = parse(pc.color); if(cc && pc.content.length>2) rec.c['color'+ps]=cc; } }
    const bi = cs.backgroundImage; if(bi && bi!=='none' && /gradient/.test(bi)) rec.c.bgImage = bi.slice(0,300);
    if(Object.keys(rec.c).length) out.push(rec);
  });
  return out;
};
const chroma = c => Math.max(c[0],c[1],c[2]) - Math.min(c[0],c[1],c[2]);
const hue = c => { const [r,g,b]=c.map(x=>x/255); const mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn; if(d===0) return 0; let h = mx===r ? ((g-b)/d)%6 : mx===g ? (b-r)/d+2 : (r-g)/d+4; return (h*60+360)%360; };
const gradChroma = s => { const m = [...s.matchAll(/rgba?\(([^)]+)\)/g)].map(x=>x[1].split(/[ ,\/]+/).map(Number)); return m.length ? Math.max(...m.map(chroma)) : 0; };
(async () => {
  const b = await chromium.launch();
  const list = pages(ROOT).filter(p => !only || p.includes(only)).sort();
  const summary = [];
  for (const scheme of ['light','dark']) for (const pg of list) {
    const ctx = await b.newContext({ viewport:{width:1300,height:1000}, colorScheme: scheme });
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message.slice(0,120)));
    try { await p.goto('http://localhost:8123/'+pg, {waitUntil:'load', timeout:30000}); } catch(e) { summary.push({pg,scheme,err:String(e).slice(0,80)}); await ctx.close(); continue; }
    await p.waitForLoadState('networkidle', {timeout:8000}).catch(()=>{});   // pages that draw themselves from fetched data must settle first
    await p.waitForTimeout(900);
    const before = await p.evaluate(COLLECT);
    const bodyBg = await p.evaluate(()=>getComputedStyle(document.body).backgroundColor+' / html '+getComputedStyle(document.documentElement).backgroundColor);
    await p.addScriptTag({content: DR});
    await p.evaluate(() => { DarkReader.setFetchMethod(window.fetch); DarkReader.enable({brightness:100, contrast:100, sepia:0}); });
    await p.waitForTimeout(1800);
    const active = await p.evaluate(()=>document.documentElement.getAttribute('data-darkreader-scheme') || (document.querySelector('meta[name="darkreader-lock"]') ? 'LOCKED' : 'off'));
    const after = await p.evaluate(COLLECT);
    const amap = new Map(after.map(r=>[r.i,r])); const bad = [];
    for (const r of before) { const a = amap.get(r.i); if(!a) continue;
      for (const [k,c] of Object.entries(r.c)) {
        const ac = a.c[k];
        if (typeof c === 'string') { const cb = gradChroma(c), ca = ac ? gradChroma(ac) : 0; if (cb>=70 && ca < cb*0.45) bad.push({el:r.tag+(r.id?'#'+r.id:'')+(r.cls?'.'+r.cls.split(' ')[0]:''), k, before:c.slice(0,60), after:(ac||'none').slice(0,60)}); continue; }
        const cb = chroma(c);
        if (cb < 70) continue;
        if (!ac) { bad.push({el:r.tag+(r.id?'#'+r.id:'')+(r.cls?'.'+r.cls.split(' ')[0]:''), k, before:c.join(','), after:'gone'}); continue; }
        const ca = chroma(ac); let dh = Math.abs(hue(c)-hue(ac)); if(dh>180) dh=360-dh;
        if (ca < cb*0.45 || (ca>40 && dh>45)) bad.push({el:r.tag+(r.id?'#'+r.id:'')+(r.cls?'.'+r.cls.split(' ')[0]:''), k, before:c.join(','), after:ac.join(','), dh:Math.round(dh)});
      } }
    const groups = {}; for (const x of bad) { const key = x.el+' '+x.k+' '+x.before+' -> '+x.after; groups[key] = (groups[key]||0)+1; }
    const coloured = before.reduce((n,r)=>n+Object.values(r.c).filter(c=>typeof c==='string'?gradChroma(c)>=70:chroma(c)>=70).length,0);
    summary.push({pg, scheme, active, bodyBg, coloured, bad: bad.length, top: Object.entries(groups).sort((a,b)=>b[1]-a[1]).slice(0, only?40:6), errs: errs.slice(0,2)});
    if (only || process.env.SHOTS) { await p.screenshot({path: path.join(__dirname, 'shot_'+pg.replace(/[\/.]/g,'_')+'_'+scheme+'.png')}); }
    await ctx.close();
  }
  for (const s of summary) { console.log(`${s.scheme.padEnd(5)} ${s.pg.padEnd(52)} DR=${s.active} coloured=${String(s.coloured).padStart(5)} bad=${String(s.bad).padStart(5)} ${s.err||''} ${s.errs&&s.errs.length?'ERR '+s.errs[0]:''}`);
    if (s.top) for (const [k,n] of s.top) console.log('        '+String(n).padStart(4)+' × '+k); }
  fs.writeFileSync(path.join(__dirname,'audit.json'), JSON.stringify(summary,null,1));
  await b.close();
})();
