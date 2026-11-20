(function(){
'use strict';
document.documentElement.classList.add('js');

const $main = document.getElementById('main');
const store = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const enc = encodeURIComponent;
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const rid = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
const sha256 = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2,'0')).join('');
const deviceId = () => { let d = store.get('landlog.device', ''); if(!d){ d = rid(20); store.set('landlog.device', d); } return d; };
const tokens = () => store.get('landlog.tokens', {});
const CFG = window.LANDLOG_CONFIG || {};
const base = (CFG.url || '').replace(/\/$/, '');
const USC = {lat: 34.0224, lon: -118.2851};
const LL = window.LL = { routes: {} };

/* ---------- theme ---------- */
const theme = {
  get(){ return store.get('landlog.theme', 'auto'); },
  apply(){
    const t = theme.get();
    const dark = t === 'dark' || (t === 'auto' && !matchMedia('(prefers-color-scheme: light)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const b = document.getElementById('themeBtn'); if(b){ b.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode'); b.dataset.mode = dark ? 'dark' : 'light'; }
  },
  toggle(){ store.set('landlog.theme', document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); theme.apply(); }
};
theme.apply();
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', theme.apply);

/* ---------- shared database + accounts (Supabase) ---------- */
const remote = { on: !!(CFG.url && CFG.anonKey), ll: [], rev: [], photos: {}, owners: {}, aliases: [], mine: new Set(), myLL: new Set(), admin: false, loaded: false };
const session = () => store.get('landlog.session', null);
function parseJWT(t){ try{ return JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); }catch(e){ return {}; } }
function saveSession(p){
  const c = parseJWT(p.access_token);
  store.set('landlog.session', {access_token: p.access_token, refresh_token: p.refresh_token, exp: c.exp || (Math.floor(Date.now()/1000) + (+p.expires_in || 3600)), email: c.email || '', id: c.sub || ''});
}
async function accessToken(){
  const s = session(); if(!s) return null;
  if(s.exp - 60 > Date.now()/1000) return s.access_token;
  try{
    const r = await fetch(base + '/auth/v1/token?grant_type=refresh_token', {method:'POST', headers:{apikey: CFG.anonKey, 'Content-Type':'application/json'}, body: JSON.stringify({refresh_token: s.refresh_token})});
    if(!r.ok) throw new Error('refresh');
    saveSession(await r.json()); return session().access_token;
  }catch(e){ store.set('landlog.session', null); return null; }
}
async function sb(path, opts = {}){
  const tok = await accessToken();
  const r = await fetch(base + '/rest/v1/' + path, Object.assign({}, opts, {headers: Object.assign({apikey: CFG.anonKey, Authorization: 'Bearer ' + (tok || CFG.anonKey), 'Content-Type':'application/json'}, opts.headers || {})}));
  const t = await r.text();
  if(!r.ok){ let m = t; try{ m = JSON.parse(t).message || t; }catch(e){} throw new Error(m); }
  return t ? JSON.parse(t) : null;
}
const sbInsert = (table, row, q = '') => sb(table + q, {method:'POST', body: JSON.stringify(row), headers: {Prefer: 'return=minimal' + (q ? ',resolution=ignore-duplicates' : '')}});
const rpc = (name, args) => sb('rpc/' + name, {method:'POST', body: JSON.stringify(args || {})});
async function signIn(email){
  const r = await fetch(base + '/auth/v1/otp?redirect_to=' + enc(location.origin + location.pathname), {method:'POST', headers:{apikey: CFG.anonKey, 'Content-Type':'application/json'}, body: JSON.stringify({email, create_user: true})});
  if(!r.ok){ let m = 'Could not send the link. Try again in a minute.'; try{ const j = await r.json(); m = j.msg || j.message || j.error_description || m; }catch(e){} throw new Error(m); }
}
function signOut(){ store.set('landlog.session', null); remote.mine = new Set(); remote.myLL = new Set(); remote.admin = false; }
// magic-link return: the session arrives in the URL hash
(function(){
  const h = location.hash;
  if(/access_token=/.test(h)){ saveSession(Object.fromEntries(new URLSearchParams(h.replace(/^#\/?/, '')))); history.replaceState(null, '', location.pathname + location.search + '#/account'); }
  else if(/error_description=/.test(h)){ store.set('landlog.autherr', new URLSearchParams(h.replace(/^#\/?/, '')).get('error_description')); history.replaceState(null, '', location.pathname + '#/account'); }
})();
const photoUrl = p => base + '/storage/v1/object/public/review-photos/' + p;
const mapRev = r => ({id:r.id, ll:r.ll, prop:r.prop, unit:r.unit || '', year:r.year || new Date(r.created_at).getFullYear(), overall:r.overall, resp:r.resp, repairs:r.repairs, deposit:r.deposit, again:r.again,
  tags:r.tags || [], issues:r.issues || [], text:r.text || '', reply:r.reply, replyAt:r.reply_at, date:r.created_at, rent:r.rent, beds:r.beds, depAmt:r.deposit_amount, depDays:r.deposit_days,
  verified:!!r.verified, helpful:r.helpful || 0, hidden:!!r.hidden, edited:r.edited_at, mine: remote.mine.has(r.id) || !!tokens()[r.id], remote:true});
async function loadRemote(){
  const get = p => sb(p).catch(() => []);
  const [lls, props, revs, photos, owners, aliases] = await Promise.all([
    sb('landlords?select=*&order=created_at'), sb('ll_props?select=ll,prop'), sb('reviews?select=*&order=created_at.desc&limit=5000'),
    get('review_photos?select=review_id,path&approved=eq.true'), get('addr_owners?select=slug,owner,source'), get('aliases?select=name,slug')]);
  if(session()){
    const [pr, lo, adm] = await Promise.all([get('review_private?select=review_id'), get('landlord_owners?select=ll'), rpc('is_admin').catch(() => false)]);
    remote.mine = new Set(pr.map(x => x.review_id)); remote.myLL = new Set(lo.map(x => x.ll)); remote.admin = adm === true;
  }
  const byId = new Map(lls.map(l => [l.id, {id:l.id, name:l.name, type:l.type, city:l.city, state:l.state, parent:l.parent || '', properties:[]}]));
  const seed = new Map(window.LANDLORDS.map(l => [l.id, l]));
  props.forEach(p => { const l = byId.get(p.ll) || seed.get(p.ll); if(l && !l.properties.includes(p.prop)) l.properties.push(p.prop); });
  remote.ll = [...byId.values()];
  remote.rev = revs.map(mapRev).filter(r => !r.hidden || r.mine);
  remote.photos = {}; photos.forEach(p => (remote.photos[p.review_id] = remote.photos[p.review_id] || []).push(photoUrl(p.path)));
  remote.owners = Object.fromEntries(owners.map(o => [o.slug, o]));
  remote.aliases = aliases.map(a => ({name:a.name, slug:a.slug, t:norm(a.name)}));
  remote.loaded = true;
  return lls.length + revs.length + owners.length + aliases.length + 1;
}

/* ---------- analytics (no cookies, no ids; only what was searched or viewed) ---------- */
function track(name, path, q){
  if(!remote.on || remote.admin) return;
  try{ fetch(base + '/rest/v1/events', {method:'POST', keepalive:true, headers:{apikey: CFG.anonKey, 'Content-Type':'application/json', Prefer:'return=minimal'}, body: JSON.stringify({name, path: (path||'').slice(0,120) || null, q: (q||'').slice(0,80) || null})}).catch(() => {}); }catch(e){}
}

/* ---------- data ---------- */
const hideSamples = !!CFG.hideSamples;
const SEED_LL = hideSamples ? [] : window.LANDLORDS;
(function(){ const extra = store.get('landlog.props', {}); window.LANDLORDS.forEach(l => (extra[l.id]||[]).forEach(p => { if(!l.properties.includes(p)) l.properties.push(p); })); })();
const isSample = l => !String(l.id).startsWith('u-');
function allLandlords(){ return SEED_LL.concat(remote.on ? remote.ll : store.get('landlog.ll', [])); }
function allReviews(){
  const seed = hideSamples ? [] : window.REVIEWS.map((r,i) => ({id:'s'+i, ll:r[0], prop:r[1], unit:'', year:r[2], overall:r[3], resp:r[4], repairs:r[5], deposit:r[6], again:r[7], tags:r[8], issues:[], text:r[9], reply:r[10], date:r[2]+'-'+String(((i*5)%12)+1).padStart(2,'0'), mine:false, helpful:0, verified:false, sample:true}));
  if(remote.on) return seed.concat(remote.rev);
  return seed.concat(store.get('landlog.rev', []).map(r => Object.assign({mine:true, issues:[], unit:'', helpful:0}, r)));
}
const avg = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0;
function stats(ll){
  const rs = allReviews().filter(r => r.ll === ll.id);
  const n = rs.length;
  const dep = rs.filter(r => r.deposit !== 'living' && r.deposit !== 'na');
  const rents = rs.map(r => r.rent).filter(Boolean), days = rs.map(r => r.depDays).filter(v => v != null), held = rs.map(r => r.depAmt).filter(v => v != null && v > 0);
  return {
    n, rs,
    overall: avg(rs.map(r=>r.overall)), resp: avg(rs.map(r=>r.resp)), repairs: avg(rs.map(r=>r.repairs)),
    again: n ? Math.round(rs.filter(r=>r.again).length / n * 100) : 0,
    depFull: dep.length ? Math.round(dep.filter(r=>r.deposit==='full').length / dep.length * 100) : 0,
    dist: [5,4,3,2,1].map(k => rs.filter(r=>r.overall===k).length),
    tags: topTags(rs), rent: rents.length ? Math.round(avg(rents)) : 0, depDays: days.length ? Math.round(avg(days)) : null, held: held.length ? Math.round(avg(held)) : 0,
    issues: issueStats(rs), trend: trend(rs)
  };
}
function topTags(rs){ const m = {}; rs.forEach(r => r.tags.forEach(t => m[t] = (m[t]||0)+1)); return Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,5).map(e=>e[0]); }
const ISSUES = {heat:'No heat', hotwater:'No hot water', pests:'Pests', mold:'Mold', leaks:'Leaks', noise:'Noise', parking:'Parking', packages:'Package theft', safety:'Safety', ac:'AC broken', appliances:'Broken appliances', entry:'Entry without notice'};
function issueStats(rs){
  if(!rs.length) return [];
  const m = {}; rs.forEach(r => (r.issues||[]).forEach(i => m[i] = (m[i]||0)+1));
  return Object.entries(m).map(([k,c]) => ({k, c, pct: Math.round(c / rs.length * 100)})).sort((a,b) => b.c - a.c).slice(0,6);
}
function trend(rs){
  const m = {}; rs.forEach(r => { const y = String(r.year).slice(0,4); if(/^\d{4}$/.test(y)) (m[y] = m[y] || []).push(r.overall); });
  return Object.keys(m).sort().map(y => ({y, v: avg(m[y]), n: m[y].length}));
}
const propStats = (l, p, unit) => { const rs = allReviews().filter(r => r.ll===l.id && r.prop===p && (!unit || (r.unit||'').toLowerCase() === unit.toLowerCase())); return {n:rs.length, overall:avg(rs.map(r=>r.overall)), rs}; };
const cls = v => v >= 4 ? 'good' : v >= 2.5 ? 'mid' : 'bad';
const fmt = v => (Math.round(v*10)/10).toFixed(1);
const tile = (v, size='') => `<span class="tile ${size} ${v ? cls(v) : ''}" aria-label="${v ? fmt(v)+' out of 5' : 'No ratings'}">${v ? fmt(v) : '–'}</span>`;
const depositLabel = {full:'Returned in full', partial:'Partly returned', withheld:'Withheld', living:'Still living here', na:'Not applicable'};
const getLL = id => allLandlords().find(l => l.id === id);
const propHref = (l, p, u) => `#/landlord/${l.id}?p=${enc(p)}${u ? '&u='+enc(u) : ''}`;
const money = n => '$' + Number(n).toLocaleString('en-US');
const sampleTag = l => isSample(l) ? '<span class="sample" title="Invented example data">Sample</span>' : '';
const when = d => { const t = new Date(d); return isNaN(t) ? '' : t.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'}); };

/* plain-English housing violation names */
const VIOL = {'SMOKE DETECTORS':'Smoke detector problems','INTER-WALLS/CEILING':'Wall or ceiling damage','WINDOW/DOOR MAINT':'Broken windows or doors','CARBON MONOXIDE DETECTORS':'Carbon monoxide detector problems','FLOOR COVERING':'Damaged flooring','FIXTURE DEF/LEAK':'Leaking fixtures','INSECT SCREENS':'Missing window screens','CAULKING':'Failing caulking','GENERAL MAINTENANCE':'General maintenance','PLMG FIXTURE SURFACE':'Damaged plumbing fixtures','COVERS-SWITCH/RECEP':'Missing outlet covers','LIGHT FIXTURE':'Light fixture problems','VENTING SYSTEM':'Faulty venting','EXTERIOR PAINT':'Peeling exterior paint','HEATING APPLIANCE':'Heater problems','DAMPNESS IN ROOMS':'Dampness or mold','DRY-ROT/TERMITES':'Dry rot or termites','HOT/COLD WATER':'Hot or cold water problems','EXPOSED WIRING':'Exposed wiring','UNAPPROVED ELECTRIC':'Unapproved electrical work','GENERAL FIRE SAFETY':'Fire safety','FIRE EXTINGUISHERS':'Fire extinguisher problems','STAIR/WALK/DECK':'Unsafe stairs or walkways','VENTILATION-BATHS':'Bathroom ventilation','GENERAL PLUMBING':'Plumbing problems','EXTERIOR WALLS':'Exterior wall damage','GFI RECEPTACLES':'Electrical outlet safety','LOOSE FIXTURES':'Loose fixtures','VENT-KITCHEN':'Kitchen ventilation','WINDOW/DOOR GLASS':'Broken glass','OPEN STORAGE':'Cluttered storage','PREMISES MAINTENANCE':'Property upkeep'};
const plainViol = t => VIOL[String(t).toUpperCase()] || String(t).toLowerCase().replace(/(^|[ /-])([a-z])/g, (m, a, b) => a + b.toUpperCase());

/* ---------- distance to campus ---------- */
const miles = (lat, lon) => {
  const R = 3958.8, r = Math.PI / 180;
  const a = Math.sin((lat - USC.lat) * r / 2) ** 2 + Math.cos(USC.lat * r) * Math.cos(lat * r) * Math.sin((lon - USC.lon) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};
const walkMin = mi => Math.max(1, Math.round(mi * 20 * 1.2));
const distLabel = (lat, lon) => { const mi = miles(lat, lon); return `${walkMin(mi)} min walk to campus · ${mi.toFixed(1)} mi`; };

/* ---------- toasts + modal ---------- */
function toast(msg){
  let t = $('#toast'); if(!t){ t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2600);
}
function modal(title, body, opts = {}){
  return new Promise(resolve => {
    const d = document.createElement('dialog'); d.className = 'dlg';
    d.innerHTML = `<form class="f" method="dialog"><h2>${esc(title)}</h2>${body}<p class="err" role="alert"></p><div class="dlg-act"><button type="button" class="pill pill-out pill-sm" data-x>Cancel</button><button class="pill pill-blue pill-sm" type="submit">${esc(opts.submit || 'Save')}</button></div></form>`;
    document.body.appendChild(d); d.showModal();
    const done = v => { d.close(); d.remove(); resolve(v); };
    $('[data-x]', d).addEventListener('click', () => done(null));
    d.addEventListener('cancel', e => { e.preventDefault(); done(null); });
    $('form', d).addEventListener('submit', async e => {
      e.preventDefault(); const err = $('.err', d), btn = $('[type=submit]', d); btn.disabled = true;
      try{ const r = opts.onSubmit ? await opts.onSubmit(new FormData(e.target), d) : true; done(r === undefined ? true : r); }
      catch(x){ err.textContent = x.message || 'Something went wrong.'; btn.disabled = false; }
    });
    opts.onMount && opts.onMount(d);
  });
}

/* ---------- saved addresses ---------- */
const savedList = () => store.get('landlog.saved', []);
const isSaved = key => savedList().some(s => s.key === key);
function toggleSaved(item){
  let a = savedList();
  if(a.some(s => s.key === item.key)){ a = a.filter(s => s.key !== item.key); toast('Removed from saved'); }
  else { a.push(item); toast('Saved. Compare saved places any time.'); }
  store.set('landlog.saved', a);
}
const starBtn = (key, label, href) => `<button class="pill pill-out pill-sm star" type="button" data-star="${esc(key)}" data-label="${esc(label)}" data-href="${esc(href)}" aria-pressed="${isSaved(key)}"><span aria-hidden="true">${isSaved(key) ? '★' : '☆'}</span> ${isSaved(key) ? 'Saved' : 'Save'}</button>`;
function bindStars(root = $main){
  $$('[data-star]', root).forEach(b => b.addEventListener('click', () => {
    toggleSaved({key: b.dataset.star, label: b.dataset.label, href: b.dataset.href});
    const on = isSaved(b.dataset.star); b.setAttribute('aria-pressed', String(on)); b.innerHTML = `<span aria-hidden="true">${on ? '★' : '☆'}</span> ${on ? 'Saved' : 'Save'}`;
  }));
}

/* ---------- public-record registry, loaded on demand (0.7 MB) ---------- */
let REG = [], REG_BY = new Map(), REG_KEY = new Map(), REG_READY = false, regLoading = null;
function buildReg(){
  REG = (window.ADDRESSES || []).map(a => ({a, slug: slug(a[0]+' '+a[1]), t: norm(a[0]+' '+a[1])}));
  REG_BY = new Map(REG.map(r => [r.slug, r]));
  REG_KEY = new Map(REG.map(r => [addrKey(r.a[0]), r]));
  REG_READY = true;
}
function loadRegistry(){
  if(REG_READY) return Promise.resolve();
  if(regLoading) return regLoading;
  regLoading = new Promise(res => {
    if(window.ADDRESSES){ buildReg(); return res(); }
    const s = document.createElement('script'); s.src = 'addresses.js?v=202611191910';
    s.onload = () => { buildReg(); res(); }; s.onerror = () => res();
    document.head.appendChild(s);
  }).then(() => { if(REG_READY && /^#\/(search|addr|map|saved|$)/.test(location.hash || '#/') && !/^#\/rate/.test(location.hash)) route(); });
  return regLoading;
}
const addrKey = s => norm(s).join(' ');
const regHref = (r, u) => '#/addr/' + r.slug + (u ? '?u=' + enc(u) : '');
const regOf = addr => REG_KEY.get(addrKey(addr));

/* ---------- address-aware search (typo tolerant, units, building names) ---------- */
const ABBR = {st:'street',ave:'avenue',av:'avenue',blvd:'boulevard',rd:'road',dr:'drive',ln:'lane',pkwy:'parkway',ter:'terrace',terr:'terrace',ct:'court',pl:'place',hwy:'highway',apt:'',apartment:'',unit:'',ste:'',suite:'',no:''};
const norm = s => String(s).toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(Boolean).map(t => ABBR[t] !== undefined ? ABBR[t] : t).filter(Boolean);
function lev(a, b, max){
  if(Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({length: b.length + 1}, (_, i) => i);
  for(let i = 1; i <= a.length; i++){
    const cur = [i]; let min = i;
    for(let j = 1; j <= b.length; j++){ const v = Math.min(prev[j] + 1, cur[j-1] + 1, prev[j-1] + (a[i-1] === b[j-1] ? 0 : 1)); cur.push(v); if(v < min) min = v; }
    if(min > max) return max + 1; prev = cur;
  }
  return prev[b.length];
}
function matchAll(qt, targets, fuzzy){
  let s = 0;
  for(let i = 0; i < qt.length; i++){
    const t = qt[i], last = i === qt.length-1, num = /^\d+$/.test(t);
    let hit = targets.some(x => num ? (last ? x.startsWith(t) : x === t) : x.startsWith(t));
    if(hit) s += targets.includes(t) ? 3 : 1;
    else if(fuzzy && !num && t.length >= 5){
      const max = t.length >= 9 ? 2 : 1;
      hit = targets.some(x => !/^\d+$/.test(x) && x.length >= 4 && lev(t, x.slice(0, t.length + 1), max) <= max);
      if(hit) s += .5;
    }
    if(!hit) return 0;
  }
  return s;
}
function splitUnit(q){
  const m = String(q).match(/(?:\b(?:apt|apartment|unit|ste|suite)\b\.?\s*#?\s*|#\s*)([a-z0-9-]{1,6})\b/i);
  return m ? {q: q.replace(m[0], ' ').replace(/\s+/g, ' ').trim(), unit: m[1].toUpperCase()} : {q: String(q).trim(), unit: ''};
}
function findReg(qt, known, fuzzy, limit){
  if(!REG_READY || !(qt.some(t => /^\d+$/.test(t)) || qt.join('').length >= 5)) return [];
  const out = [];
  for(const r of REG){
    const s = matchAll(qt, r.t, fuzzy);
    if(s && !known.has(addrKey(r.a[0]))) out.push({r, score: s + (r.t[0] === qt[0] ? 2 : 0)});
  }
  return out.sort((x, y) => y.score - x.score || x.r.a[0].localeCompare(y.r.a[0])).slice(0, limit);
}
function find(q, limit = 12){
  const qt = norm(q);
  const out = {props:[], lls:[], reg:[], alias:[], own:[], qt, fuzzy:false};
  if(!qt.length) return out;
  const run = fuzzy => {
    out.props = []; out.lls = []; out.alias = []; out.own = [];
    allLandlords().forEach(l => {
      const nameT = norm(l.name), cityT = norm(l.city+' '+l.state);
      const ls = matchAll(qt, nameT.concat(cityT, norm(l.parent || '')), fuzzy);
      if(ls) out.lls.push({l, score: ls});
      l.properties.forEach(p => {
        const at = norm(p);
        const s = matchAll(qt, at.concat(cityT, nameT), fuzzy);
        if(s) out.props.push({l, p, score: s + (matchAll(qt, at, fuzzy) ? 4 : 0)});
      });
    });
    remote.aliases.forEach(a => { const s = matchAll(qt, a.t, fuzzy); if(s && REG_BY.get(a.slug)) out.alias.push({a, r: REG_BY.get(a.slug), score: s}); });
    if(REG_READY && !qt.some(t => /^\d+$/.test(t))){
      for(const slugKey in remote.owners){ const o = remote.owners[slugKey], r = REG_BY.get(slugKey); if(!r) continue; const s = matchAll(qt, norm(o.owner), fuzzy); if(s) out.own.push({r, o, score: s}); }
      out.own = out.own.sort((a, b) => b.score - a.score).slice(0, limit * 2);
    }
    out.props.sort((a,b) => b.score - a.score); out.lls.sort((a,b) => b.score - a.score);
    const known = new Set(allLandlords().flatMap(l => l.properties.map(addrKey)));
    out.reg = findReg(qt, known, fuzzy, limit * 6);
  };
  run(false);
  if(out.props.length + out.lls.length + out.reg.length + out.alias.length + out.own.length < 3){
    const strict = out.props.length + out.lls.length + out.reg.length + out.alias.length + out.own.length;
    run(true); out.fuzzy = (out.props.length + out.lls.length + out.reg.length + out.alias.length + out.own.length) > strict;
  }
  return out;
}
function go(q){
  const raw = (q||'').trim();
  if(!raw){ location.hash = '#/search?q='; return; }
  const {q: qq, unit} = splitUnit(raw);
  const r = find(qq), hasNum = /\d/.test(qq);
  track('search', '', raw);
  const exact = r.props[0] && (r.props.length === 1 || r.props[0].score > r.props[1].score);
  if(r.props.length && hasNum && exact) { location.hash = propHref(r.props[0].l, r.props[0].p, unit); return; }
  if(r.props.length === 1 && !r.lls.length && !r.reg.length){ location.hash = propHref(r.props[0].l, r.props[0].p, unit); return; }
  if(!hasNum && r.lls.length === 1 && r.props.every(x => x.l.id === r.lls[0].l.id) && !r.alias.length){ location.hash = '#/landlord/' + r.lls[0].l.id; return; }
  if(!hasNum && r.alias.length === 1 && !r.lls.length){ location.hash = regHref(r.alias[0].r, unit); return; }
  if(hasNum && !r.props.length && r.reg.length && (r.reg.length === 1 || r.reg[0].score > r.reg[1].score) && !r.fuzzy){ location.hash = regHref(r.reg[0].r, unit); return; }
  location.hash = '#/search?q=' + enc(raw);
}

/* omnibox: live suggestions on any search input */
function mountOmni(input){
  const wrap = input.closest('.omni-wrap');
  if(!wrap) return;
  const list = document.createElement('ul');
  list.className = 'omni'; list.hidden = true; list.setAttribute('role','listbox'); list.setAttribute('aria-label','Suggestions');
  list.id = 'omni-' + Math.random().toString(36).slice(2,7);
  wrap.appendChild(list);
  input.setAttribute('role','combobox'); input.setAttribute('aria-autocomplete','list');
  input.setAttribute('aria-controls', list.id); input.setAttribute('aria-expanded','false');
  let items = [], active = -1;
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded','false'); active = -1; };
  const setActive = i => {
    active = i;
    [...list.children].forEach((li, k) => { li.classList.toggle('on', k === i); li.setAttribute('aria-selected', String(k === i)); });
    if(i >= 0) input.setAttribute('aria-activedescendant', list.children[i].id); else input.removeAttribute('aria-activedescendant');
  };
  const render = () => {
    const raw = input.value.trim();
    if(!raw){ close(); return; }
    const {q, unit} = splitUnit(raw), r = find(q, 12);
    items = r.props.slice(0,4).map(x => ({href: propHref(x.l, x.p, unit), kind:'Address', title: x.p + (unit ? ' #'+unit : ''), sub: `${x.l.name} · ${x.l.city}, ${x.l.state}`, v: propStats(x.l, x.p).overall || stats(x.l).overall}))
      .concat(r.alias.slice(0,2).map(x => ({href: regHref(x.r, unit), kind:'Building', title: x.a.name, sub: `${x.r.a[0]} · ${x.r.a[1]}`, v:0})))
      .concat(r.reg.slice(0, Math.max(1, 6 - r.props.length)).map(x => ({href: regHref(x.r, unit), kind:'Address', title: x.r.a[0] + (unit ? ' #'+unit : ''), sub: `Los Angeles, CA ${x.r.a[1]} · ${x.r.a[4]} ${x.r.a[4]===1?'unit':'units'}${x.r.a[7] ? ' · open violations' : ''}`, v:0})))
      .concat(r.lls.slice(0,3).map(x => ({href:'#/landlord/'+x.l.id, kind:'Landlord', title:x.l.name, sub:`${x.l.type} · ${x.l.city}, ${x.l.state}`, v: stats(x.l).overall})));
    if(!items.length && /\d/.test(q)) items.push({href:'#/rate?addr='+enc(q)+(unit?'&u='+enc(unit):''), kind:'New', title:`No ratings for “${raw}” yet`, sub:'Be the first to rate this address', v:0, plus:true});
    if(!REG_READY && /\d/.test(q)) loadRegistry().then(() => { if(document.activeElement === input) render(); });
    list.innerHTML = items.length ? items.map((it,i) => `<li role="option" aria-selected="false" id="${list.id}-${i}" data-i="${i}"><span class="omni-k">${it.kind}</span><span class="omni-t"><b>${esc(it.title)}</b><small>${esc(it.sub)}</small></span>${it.plus ? '<span class="omni-plus">+</span>' : tile(it.v,'sm')}</li>`).join('') : `<li class="omni-empty" role="option" aria-selected="false">No matches. Try a street address or a name.</li>`;
    list.hidden = false; input.setAttribute('aria-expanded','true'); active = -1;
  };
  input.addEventListener('input', render);
  input.addEventListener('focus', () => { loadRegistry(); render(); });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', e => {
    if(e.key === 'ArrowDown'){ if(!list.hidden && items.length){ e.preventDefault(); setActive((active+1) % items.length); } }
    else if(e.key === 'ArrowUp'){ if(!list.hidden && items.length){ e.preventDefault(); setActive((active-1+items.length) % items.length); } }
    else if(e.key === 'Escape'){ close(); }
    else if(e.key === 'Enter' && active >= 0 && items[active]){ e.preventDefault(); location.hash = items[active].href; close(); }
  });
  list.addEventListener('mousedown', e => {
    const li = e.target.closest('li[data-i]'); if(!li) return;
    e.preventDefault(); location.hash = items[+li.dataset.i].href; close();
  });
}
function bindSearchForm(form, input){
  form.addEventListener('submit', e => { e.preventDefault(); input.blur(); loadRegistry().then(() => go(input.value)); });
  mountOmni(input);
}

/* ---------- views ---------- */
function home(){
  const rows = allLandlords().map(l => ({l, s: stats(l)})).filter(x => x.s.n);
  const worst = rows.slice().sort((a,b)=>a.s.overall-b.s.overall).slice(0,3);
  const best = rows.slice().sort((a,b)=>b.s.overall-a.s.overall).slice(0,3);
  const total = allReviews().length;
  const props = allLandlords().reduce((n,l) => n + l.properties.length, 0);
  const exA = worst[0], exB = best[0];
  const row = x => `<a class="row" href="#/landlord/${x.l.id}">${tile(x.s.overall,'sm')}<span><span class="row-name">${esc(x.l.name)}</span> ${sampleTag(x.l)}<br><span class="row-sub">${esc(x.l.city)}, ${esc(x.l.state)}</span></span><span class="row-n">${x.s.n} ratings</span></a>`;
  const chips = [];
  if(exA) chips.push(`<a class="chip" href="${propHref(exA.l, exA.l.properties[0])}">${esc(exA.l.properties[0])}</a>`);
  if(exB) chips.push(`<a class="chip" href="${propHref(exB.l, exB.l.properties[0])}">${esc(exB.l.properties[0])}</a>`);
  if(exA) chips.push(`<a class="chip" href="#/landlord/${exA.l.id}">${esc(exA.l.name)}</a>`);
  const board = (title, note, list) => `<div class="board rv"><h3>${title}</h3><p class="note">${note}</p>${list.length ? list.map(row).join('') : '<p class="note">Nothing here yet. Be the first to rate a landlord.</p>'}</div>`;
  return `
  <section class="slab hero center">
    <div class="slab-in">
      <h1 class="rv">Type the address. Know the landlord.</h1>
      <p class="sub rv" style="--i:1">Ratings from people who paid the rent, tied to the exact place you’re looking at.</p>
      <div class="omni-wrap rv" style="--i:2">
        <form class="hero-search" id="heroSearch" autocomplete="off" role="search">
          <label class="sr" for="heroQ">Address, landlord or company</label>
          <input id="heroQ" type="search" placeholder="Address, landlord or company" autocomplete="off" enterkeyhint="search">
          <button class="pill pill-blue" type="submit">Look up</button>
        </form>
      </div>
      <div class="ex rv" style="--i:3">
        ${chips.length ? '<span>Try</span>' + chips.join('') : ''}
        <a class="chip" href="#/map">Browse the map</a>
      </div>
    </div>
  </section>

  <section class="slab">
    <div class="slab-in">
      <h2 class="h2 wide rv">Who tenants are warning each other about.</h2>
      <div class="boards">
        ${board('Lowest rated', 'Read before you tour.', worst)}
        ${board('Highest rated', 'What a good landlord looks like.', best)}
      </div>
    </div>
  </section>

  <section class="slab">
    <div class="slab-in">
      <h2 class="h2 wide rv">One search box. No country, state or city to click through.</h2>
      <div class="claims">
        <div class="claim rv"><h3>Paste the address from the listing.</h3><p>We match it to the property, even with a typo, and show what the city has on file.</p></div>
        <div class="claim rv" style="--i:1"><h3>See what happened there.</h3><p>Repairs, deposits, notice before entry, rent hikes. Reviews for that exact address come first.</p></div>
        <div class="claim rv" style="--i:2"><h3>Leave yours when you move out.</h3><p>Two minutes, and the next person at the door knows what they’re signing.</p></div>
      </div>
    </div>
  </section>

  <section class="slab">
    <div class="slab-in band">
      <div class="big rv">${total}</div>
      <div class="rv" style="--i:1">
        <h2 class="h2">Tenant ratings across ${props} addresses.</h2>
        <p class="lede">Every one of them is a person deciding whether to stay.</p>
        <p style="margin-top:32px;display:flex;gap:12px;flex-wrap:wrap"><a class="pill pill-blue" href="#/rate">Rate a landlord</a><a class="pill pill-out" href="#/invite">Invite your building</a></p>
      </div>
    </div>
  </section>`;
}

/* result cards + filters */
const FILTERS = [['good','Rated 4+'],['bad','Rated under 3'],['viol','Has violations'],['walk','Under 15 min walk'],['house','Houses and small'],['big','Large buildings']];
function attrsFor(addr, l){
  const r = regOf(addr), ps = l ? propStats(l, addr) : {n:0, overall:0};
  return {rating: ps.overall || (l ? stats(l).overall : 0), viol: r ? r.a[7] > 0 || r.a[6] > 0 : false, walk: r ? walkMin(miles(r.a[2], r.a[3])) : null, units: r ? r.a[4] : null};
}
function passes(at){
  const f = state.f; if(!f.size) return true;
  if(f.has('good') && !(at.rating >= 4)) return false;
  if(f.has('bad') && !(at.rating && at.rating < 3)) return false;
  if(f.has('viol') && !at.viol) return false;
  if(f.has('walk') && !(at.walk != null && at.walk <= 15)) return false;
  if(f.has('house') && !(at.units != null && at.units <= 4)) return false;
  if(f.has('big') && !(at.units != null && at.units >= 5)) return false;
  return true;
}
const regCard = x => {
  const a = x.r.a, own = remote.owners[x.r.slug], ps = null;
  return `<a class="result rv" href="${regHref(x.r)}">${tile(0,'lg')}<div><h2>${esc(a[0])}</h2><p class="meta">Los Angeles, CA ${esc(a[1])} · ${a[4]} ${a[4]===1?'unit':'units'}${a[5] ? ' · built '+esc(a[5]) : ''}${own ? ' · Owner: '+esc(own.owner) : ''}</p><p class="meta">${distLabel(a[2], a[3])}</p></div><div class="stat"><b>${a[6]}</b><span>Violation cases</span></div><div class="stat"><b>0</b><span>Ratings</span></div></a>`;
};

function search(q){
  q = (q||'').trim();
  const {q: qq, unit} = splitUnit(q);
  const r = find(qq, 30);
  const browse = !q;
  let body = '';
  const propCard = x => { const ps = propStats(x.l, x.p, unit), ls = stats(x.l), r0 = regOf(x.p); return `<a class="result rv" href="${propHref(x.l, x.p, unit)}">${tile(ps.overall,'lg')}<div><h2>${esc(x.p)}${unit ? ' #'+esc(unit) : ''}</h2><p class="meta">${esc(x.l.name)} ${sampleTag(x.l)} · ${esc(x.l.city)}, ${esc(x.l.state)}</p>${r0 ? `<p class="meta">${distLabel(r0.a[2], r0.a[3])}</p>` : ''}</div><div class="stat"><b>${ps.n}</b><span>At this address</span></div><div class="stat"><b>${ls.n ? fmt(ls.overall) : '–'}</b><span>Landlord overall</span></div></a>`; };
  const llCard = x => { const s = stats(x.l); return `<a class="result rv" href="#/landlord/${x.l.id}">${tile(s.overall,'lg')}<div><h2>${esc(x.l.name)} ${sampleTag(x.l)}</h2><p class="meta">${esc(x.l.type)} · ${esc(x.l.city)}, ${esc(x.l.state)}</p></div><div class="stat"><b>${s.n ? s.again+'%' : '–'}</b><span>Would rent again</span></div><div class="stat"><b>${s.n}</b><span>Ratings</span></div></a>`; };
  if(browse){
    const list = allLandlords().map(l => ({l, s: stats(l)}));
    list.sort((a,b) => state.sort==='low' ? a.s.overall-b.s.overall : state.sort==='most' ? b.s.n-a.s.n : b.s.overall-a.s.overall);
    body = `<div class="filters" role="group" aria-label="Sort">${[['high','Highest rated'],['low','Lowest rated'],['most','Most ratings']].map(([k,t]) => `<button class="chip" data-sort="${k}" aria-pressed="${state.sort===k}">${t}</button>`).join('')}</div>
      <div class="results">${list.length ? list.map(x => llCard(x)).join('') : '<div class="empty"><h2>No landlords yet.</h2><p>Be the first to add one.</p><a class="pill pill-blue" href="#/rate">Rate a landlord</a></div>'}</div>`;
  } else {
    const props = r.props.filter(x => passes(attrsFor(x.p, x.l))), reg = r.reg.filter(x => passes(attrsFor(x.r.a[0], null)));
    const any = r.props.length || r.lls.length || r.reg.length || r.alias.length || r.own.length;
    const filters = (r.props.length + r.reg.length) ? `<div class="filters" role="group" aria-label="Filter addresses">${FILTERS.map(([k,t]) => `<button class="chip" data-f="${k}" aria-pressed="${state.f.has(k)}">${t}</button>`).join('')}</div>` : '';
    if(!any){
      const hasNum = /\d/.test(qq);
      if(!REG_READY && hasNum) body = `<div class="empty"><h2>Searching the address list…</h2><p>One moment.</p></div>`;
      else { track('zero', '', q); body = `<div class="empty rv"><h2>Nothing for “${esc(q)}” yet.</h2><p>${hasNum ? 'No one has rated this address, and it isn’t in the public address list we use. Check the spelling, or add it yourself and warn the next tenant.' : 'Try a street address, a building name, a landlord’s name or a company.'}</p><div class="actions" style="justify-content:center"><a class="pill pill-blue" href="#/rate${hasNum ? '?addr='+enc(qq) : ''}${unit ? '&u='+enc(unit) : ''}">${hasNum ? 'Rate this address' : 'Rate a landlord'}</a><a class="pill pill-out" href="#/map">Browse the map</a></div></div>`; }
    } else {
      if(r.fuzzy) body += `<p class="count">Showing close matches for “${esc(q)}”.</p>`;
      body += filters;
      if(r.alias.length) body += `<h2 class="sec">Buildings</h2><div class="results">${r.alias.map(x => `<a class="result rv" href="${regHref(x.r, unit)}">${tile(0,'lg')}<div><h2>${esc(x.a.name)}</h2><p class="meta">${esc(x.r.a[0])} · ${esc(x.r.a[1])}</p></div><div class="stat"><b>${x.r.a[6]}</b><span>Violation cases</span></div><div class="stat"><b>0</b><span>Ratings</span></div></a>`).join('')}</div>`;
      if(props.length) body += `<h2 class="sec">Addresses</h2><div class="results">${props.slice(0,15).map(propCard).join('')}</div>`;
      if(reg.length) body += `<h2 class="sec">${props.length ? 'More addresses' : 'Addresses'}</h2><div class="results">${reg.slice(0, state.more ? 60 : 12).map(regCard).join('')}</div>${reg.length > 12 && !state.more ? '<p style="margin-top:18px"><button class="pill pill-out pill-sm" id="moreBtn" type="button">Show more addresses</button></p>' : ''}`;
      if(!props.length && !reg.length && (r.props.length || r.reg.length)) body += `<div class="empty"><h2>No addresses match those filters.</h2><p>Clear a filter to see them.</p></div>`;
      if(r.own.length) body += `<h2 class="sec">Owner of record</h2><div class="results">${r.own.slice(0,12).map(x => `<a class="result rv" href="${regHref(x.r)}">${tile(0,'lg')}<div><h2>${esc(x.r.a[0])}</h2><p class="meta">Owner: ${esc(x.o.owner)}</p></div><div class="stat"><b>${x.r.a[6]}</b><span>Violation cases</span></div><div class="stat"><b>0</b><span>Ratings</span></div></a>`).join('')}</div>`;
      if(r.lls.length) body += `<h2 class="sec">Landlords</h2><div class="results">${r.lls.slice(0,8).map(llCard).join('')}</div>`;
    }
  }
  return `
  <section class="page">
    <h1 class="rv">${browse ? 'All landlords' : 'Results for “'+esc(q)+'”'}</h1>
    <div class="omni-wrap rv page-search" style="--i:1">
      <form class="hero-search" id="pageSearch" autocomplete="off" role="search">
        <label class="sr" for="pageQ">Search</label>
        <input id="pageQ" type="search" value="${esc(q)}" placeholder="Address, building, landlord or company" enterkeyhint="search">
        <button class="pill pill-blue" type="submit">Look up</button>
      </form>
    </div>
    ${body}
  </section>`;
}

/* shared review pieces */
const sparkline = tr => {
  if(tr.length < 2) return '';
  const w = 280, h = 90, pad = 14, xs = i => pad + i * (w - 2*pad) / (tr.length - 1), ys = v => h - pad - (v - 1) * (h - 2*pad) / 4;
  const pts = tr.map((t, i) => `${xs(i).toFixed(1)},${ys(t.v).toFixed(1)}`).join(' ');
  const first = tr[0].v, last = tr[tr.length-1].v, d = last - first;
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="Average rating by year, from ${fmt(first)} in ${tr[0].y} to ${fmt(last)} in ${tr[tr.length-1].y}"><polyline points="${pts}" fill="none" stroke="url(#sg)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><defs><linearGradient id="sg" x1="0" x2="1"><stop offset="0" stop-color="#ffc400"/><stop offset="1" stop-color="#e0212f"/></linearGradient></defs>${tr.map((t, i) => `<circle cx="${xs(i).toFixed(1)}" cy="${ys(t.v).toFixed(1)}" r="4" fill="currentColor"/>`).join('')}</svg>
    <div class="spark-l">${tr.map(t => `<span>${t.y}<b>${fmt(t.v)}</b></span>`).join('')}</div>
    <p class="meta" style="margin-top:10px">${Math.abs(d) < .3 ? 'Steady over time.' : d > 0 ? `Improving: up ${fmt(Math.abs(d))} since ${tr[0].y}.` : `Getting worse: down ${fmt(Math.abs(d))} since ${tr[0].y}.`}</p>`;
};
const issueBars = list => list.length ? `<div class="issues">${list.map(i => `<div class="dist"><span>${esc(ISSUES[i.k] || i.k)}</span><div class="bar-t"><div class="bar-f" style="width:${i.pct}%"></div></div><b class="n">${i.pct}%</b></div>`).join('')}</div>` : '';

function reviewCard(r, ctx = {}){
  const votes = store.get('landlog.votes', {}), flags = store.get('landlog.flags', {});
  const canReply = remote.on && r.remote && (remote.admin || remote.myLL.has(r.ll));
  const photos = remote.photos[r.id] || [];
  const dep = depositLabel[r.deposit] + (r.depDays != null ? ` in ${r.depDays} days` : '') + (r.depAmt ? ` (${money(r.depAmt)})` : '');
  return `
    <article class="rev rv" id="r-${r.id}">
      <div class="score-col">
        <div><div class="lab">Overall</div>${tile(r.overall)}</div>
        <div><div class="lab">Repairs</div>${tile(r.repairs)}</div>
      </div>
      <div>
        <div class="rev-top"><h3>${esc(r.prop)}${r.unit ? ' · Unit '+esc(r.unit) : ''}${r.mine?'<span class="you">You</span>':''}${r.verified?'<span class="ver" title="Signed in with a .edu email">Verified student</span>':''}${r.hidden?'<span class="you hid">Hidden pending review</span>':''}${r.sample?'<span class="sample">Sample</span>':''}</h3><time>${r.mine && r.date && String(r.date).length > 4 ? when(r.date) : 'Lived there '+esc(r.year)}${r.edited ? ' · edited' : ''}</time></div>
        <div class="facts"><span>Responsiveness: <b>${r.resp}/5</b></span><span>Deposit: <b>${esc(dep)}</b></span><span>Would rent again: <b>${r.again?'Yes':'No'}</b></span>${r.rent ? `<span>Rent: <b>${money(r.rent)}/mo${r.beds != null ? ' · '+(r.beds === 0 ? 'studio' : r.beds+' bd') : ''}</b></span>` : ''}</div>
        <p class="text">${esc(r.text)}</p>
        ${(r.tags.length || (r.issues||[]).length) ? `<div class="tags">${r.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}${(r.issues||[]).map(i=>`<span class="tag issue">${esc(ISSUES[i]||i)}</span>`).join('')}</div>` : ''}
        ${photos.length ? `<div class="photos">${photos.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Photo from this tenant’s review" loading="lazy"></a>`).join('')}</div>` : ''}
        ${r.reply ? `<div class="reply"><b>Landlord response${r.replyAt ? ' · '+when(r.replyAt) : ''}</b>${esc(r.reply)}</div>` : ''}
        <div class="rev-foot">
          <button class="vote" data-vote="${r.id}" aria-pressed="${!!votes[r.id]}" aria-label="Mark helpful"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11v9H4v-9zM7 11l4-8c1.5 0 2.5 1 2 3l-.7 3H19a2 2 0 0 1 2 2.4l-1.3 6A2 2 0 0 1 17.7 20H7"/></svg>Helpful <span>${(r.helpful || 0) + (!r.remote && votes[r.id] ? 1 : 0)}</span></button>
          ${canReply ? `<button class="flag" data-reply="${r.id}">Reply</button>` : ''}
          ${r.mine && r.remote ? `<button class="flag" data-edit="${r.id}">Edit</button><button class="flag" data-del="${r.id}">Delete</button>` : ''}
          <span class="grow"></span>
          ${r.mine ? '' : `<button class="flag" data-flag="${r.id}" aria-label="Report this review">${flags[r.id] ? 'Reported' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4M5 4h12l-2 4 2 4H5"/></svg>'}</button>`}
        </div>
      </div>
    </article>`;
}
const SORTS = [['new','Most recent'],['helpful','Most helpful'],['verified','Verified first'],['low','Lowest first'],['high','Highest first']];
function sortReviews(rs, mode){
  const d = r => String(r.date);
  if(mode === 'low') return rs.sort((a,b)=>a.overall-b.overall);
  if(mode === 'high') return rs.sort((a,b)=>b.overall-a.overall);
  if(mode === 'helpful') return rs.sort((a,b)=>(b.helpful||0)-(a.helpful||0) || d(b).localeCompare(d(a)));
  if(mode === 'verified') return rs.sort((a,b)=>(b.verified-a.verified) || d(b).localeCompare(d(a)));
  return rs.sort((a,b)=> (b.mine-a.mine) || d(b).localeCompare(d(a)));
}

function landlord(id){
  const l = getLL(id);
  if(!l) return notFound();
  const s = stats(l);
  const total = s.n || 1;
  const labels = ['Awesome','Great','Good','OK','Awful'];
  let rs = s.rs.slice();
  const filtered = state.prop !== 'all' && l.properties.includes(state.prop);
  if(!filtered) state.prop = 'all';
  if(filtered) rs = rs.filter(r => r.prop === state.prop);
  if(filtered && state.unit) rs = rs.filter(r => (r.unit||'').toLowerCase() === state.unit.toLowerCase());
  sortReviews(rs, state.rsort);
  const ps = filtered ? propStats(l, state.prop, state.unit) : null;
  const rateHref = `#/rate/${l.id}${filtered ? '?addr='+enc(state.prop)+(state.unit ? '&u='+enc(state.unit) : '') : ''}`;
  const reg = filtered ? regOf(state.prop) : null;
  const sibs = l.parent ? allLandlords().filter(x => x.parent && x.parent.toLowerCase() === l.parent.toLowerCase()) : [];
  const grp = sibs.length > 1 ? sibs.flatMap(x => allReviews().filter(r => r.ll === x.id)) : [];
  const strip = filtered ? `
    <div class="addr rv">
      <div class="addr-main">${tile(ps.overall,'lg')}<div><p class="addr-k">This address${state.unit ? ' · Unit '+esc(state.unit) : ''}</p><h2>${esc(state.prop)}</h2><p class="addr-s">${esc(l.city)}, ${esc(l.state)} · ${ps.n ? ps.n+' '+(ps.n===1?'rating':'ratings')+' here' : 'No ratings here yet'}${reg ? ' · '+distLabel(reg.a[2], reg.a[3]) : ''}</p></div></div>
      <div class="addr-act"><a class="pill pill-blue pill-sm" href="${rateHref}">Rate this address</a>${starBtn('p:'+l.id+':'+state.prop, state.prop, propHref(l, state.prop))}<button class="pill pill-out pill-sm" id="allProps" type="button">All properties</button></div>
    </div>
    ${reg ? regFacts(reg) : ''}` : '';
  const heading = filtered ? `${rs.length} ${rs.length===1?'rating':'ratings'} at this address${state.unit ? ', unit '+esc(state.unit) : ''}` : `${s.n} tenant ${s.n===1?'rating':'ratings'}`;
  const props = l.properties.map(p => { const c = propStats(l, p); return `<a href="${propHref(l,p)}" data-p="${esc(p)}" class="${filtered && state.prop===p ? 'cur' : ''}"><span>${esc(p)}</span><b>${c.n ? fmt(c.overall)+' · '+c.n : 'No ratings'}</b></a>`; }).join('');
  return `
  <div class="cond" id="cond" aria-hidden="true">
    <div class="cond-in">${tile(s.overall)}<div><strong>${esc(l.name)}</strong><small>${filtered ? esc(state.prop) : esc(l.city)+', '+esc(l.state)}</small></div>
      <div class="sp"><a class="pill pill-black pill-sm" href="${rateHref}" tabindex="-1">Rate</a></div></div>
  </div>
  <section class="page">
    ${strip}
    <div class="ll" id="llHead">
      <div>
        <div class="score rv"><b>${s.n ? fmt(s.overall) : '–'}</b><span>/ 5</span></div>
        <p class="basedon rv" style="--i:1">Landlord overall, based on <u>${s.n} ${s.n===1?'rating':'ratings'}</u> ${sampleTag(l)}</p>
        <h1 class="rv" style="--i:2">${esc(l.name)}</h1>
        <p class="where rv" style="--i:3">${esc(l.type)} in ${esc(l.city)}, ${esc(l.state)}${l.parent ? ` · Part of <a href="#/search?q=${enc(l.parent)}">${esc(l.parent)}</a>` : ''}</p>
        <div class="stats rv" style="--i:4">
          <div><b>${s.n ? s.again+'%' : '–'}</b><span>Would rent again</span></div>
          <div><b>${s.n ? s.depFull+'%' : '–'}</b><span>Deposit returned in full</span></div>
          ${s.rent ? `<div><b>${money(s.rent)}</b><span>Average rent</span></div>` : ''}
        </div>
        ${grp.length ? `<p class="meta rv" style="margin:-8px 0 24px">All ${sibs.length} entities under ${esc(l.parent)}: <b>${fmt(avg(grp.map(r => r.overall)))}</b> from ${grp.length} ratings.</p>` : ''}
        <div class="actions rv" style="--i:5">
          <a class="pill pill-blue" href="${rateHref}">Rate <span aria-hidden="true">→</span></a>
          <button class="pill pill-out" id="shareBtn" type="button">Share</button>
          ${starBtn('l:'+l.id, l.name, '#/landlord/'+l.id)}
          ${remote.on ? `<button class="pill pill-out" id="claimBtn" type="button">Is this you?</button>` : ''}
        </div>
      </div>
      <div>
        <div class="panel rv">
          <h2>Rating distribution</h2>
          <div class="dist-wrap" id="distWrap">
            ${s.dist.map((c,i)=>`<div class="dist"><span>${labels[i]} <b>${5-i}</b></span><div class="bar-t"><div class="bar-f" style="width:${Math.round(c/total*100)}%"></div></div><b class="n">${c}</b></div>`).join('')}
          </div>
          <div class="mini"><div><b>${s.n?fmt(s.resp):'–'}</b><span>Responsiveness</span></div><div><b>${s.n?fmt(s.repairs):'–'}</b><span>Repairs</span></div><div><b>${l.properties.length}</b><span>${l.properties.length===1?'Property':'Properties'}</span></div></div>
          ${s.depDays != null || s.held ? `<div class="mini"><div><b>${s.depDays != null ? s.depDays+' days' : '–'}</b><span>Avg. time to get deposit back</span></div><div><b>${s.held ? money(s.held) : '–'}</b><span>Avg. amount withheld</span></div><div></div></div>` : ''}
        </div>
        ${s.issues.length ? `<div class="panel rv" style="--i:1"><h2>What tenants report</h2>${issueBars(s.issues)}</div>` : ''}
        ${s.trend.length > 1 ? `<div class="panel rv" style="--i:1"><h2>Rating over time</h2>${sparkline(s.trend)}</div>` : ''}
        ${s.tags.length ? `<div class="panel panel-tint rv" style="--i:1"><h2>What tenants mention most</h2><div class="tags-top">${s.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div></div>` : ''}
        <div class="panel rv" style="--i:2"><h2>Properties</h2><div class="props">${props}</div></div>
      </div>
    </div>

    <div class="reviews-head">
      <h2 class="rv">${heading}</h2>
      <div class="controls">
        <label class="sr" for="propSel">Filter by property</label>
        <select class="sel" id="propSel"><option value="all">All properties</option>${l.properties.map(p=>`<option ${state.prop===p?'selected':''}>${esc(p)}</option>`).join('')}</select>
        <label class="sr" for="rsortSel">Sort</label>
        <select class="sel" id="rsortSel">${SORTS.map(([k,t])=>`<option value="${k}" ${state.rsort===k?'selected':''}>${t}</option>`).join('')}</select>
      </div>
    </div>
    <div class="rev-grid"><div class="rev-list">${rs.length ? rs.map(reviewCard).join('') : '<div class="empty"><h2>No ratings here yet.</h2><p>Lived at this property? Your review is the first thing the next tenant will read.</p><a class="pill pill-blue" href="'+rateHref+'">Rate this address</a></div>'}</div>
    <aside class="side"><div class="side-in"><h3>Lived at one of these?</h3><p>Your rating is the only thing a landlord can’t edit. It takes two minutes.</p><a class="pill pill-blue" href="${rateHref}">Write a review</a><ul>${l.properties.map(p=>`<li>${esc(p)}</li>`).join('')}</ul></div></aside></div>
  </section>`;
}

/* what the public record says about one address */
function regFacts(r){
  const [addr, zip, lat, lon, units, built, cases, open, types, evict] = r.a;
  const own = remote.owners[r.slug];
  const facts = [
    ['Owner of record', own ? own.owner : 'Not listed yet'],
    ['Units', units], ['Year built', built || '–'], ['Housing violation cases', cases],
    ['Open violations', open], ['Eviction notices, 3 yrs', evict == null ? '–' : evict]
  ];
  return `<div class="panel regfacts rv"><h2>What the public record shows</h2>
    <div class="rf">${facts.map(([k, v]) => `<div><b>${esc(v)}</b><span>${k}</span></div>`).join('')}</div>
    ${(types || []).length ? `<p class="meta" style="margin-top:16px">Most cited by city inspectors: ${types.map(t => `<span class="tag">${esc(plainViol(t))}</span>`).join(' ')}</p>` : ''}
    <p class="meta small">Address, units and year built: LA County Assessor. Violations and eviction notices: LA Housing Department.${own && own.source ? ' Owner: '+esc(own.source)+'.' : ''}</p></div>`;
}
function addrPage(sl, unit){
  if(!REG_READY){ loadRegistry(); return `<section class="page"><h1>Loading…</h1><p class="count">Finding that address.</p></section>`; }
  const r = REG_BY.get(sl);
  if(!r) return notFound();
  const [addr, zip, lat, lon] = r.a;
  const owner = allLandlords().find(l => l.properties.some(p => addrKey(p) === addrKey(addr)));
  if(owner){ const p = owner.properties.find(p => addrKey(p) === addrKey(addr)); setTimeout(() => location.replace(propHref(owner, p, unit)), 0); return ''; }
  const rateHref = '#/rate?addr=' + enc(addr) + (unit ? '&u=' + enc(unit) : '');
  const own = remote.owners[sl];
  return `
  <section class="page">
    <div class="ll">
      <div>
        <p class="basedon rv">Public record · no tenant ratings yet</p>
        <h1 class="rv" style="--i:1">${esc(addr)}${unit ? ' <small class="unit">Unit '+esc(unit)+'</small>' : ''}</h1>
        <p class="where rv" style="--i:2">Los Angeles, CA ${esc(zip)} · ${distLabel(lat, lon)}</p>
        <div class="actions rv" style="--i:4;margin-top:28px">
          <a class="pill pill-blue" href="${rateHref}">Rate this address <span aria-hidden="true">→</span></a>
          ${starBtn('a:'+sl, addr, regHref(r))}
          <a class="pill pill-out" href="#/map?focus=${sl}">Map</a>
        </div>
      </div>
      <div>
        ${regFacts(r)}
        <div class="panel panel-tint rv" style="--i:1">
          <h2>Lived here?</h2>
          <p class="meta" style="line-height:1.55">No one has rated this address yet${own ? '' : ', so we don’t know the landlord'}. Add ${own ? 'your review' : 'the landlord’s name with your review'} and the next tenant will see it. You don’t need an account.</p>
          <a class="pill pill-blue pill-sm" href="${rateHref}">Write a review</a>
        </div>
      </div>
    </div>
  </section>`;
}

const detailFields = (v = {}) => `
  <div class="two"><div><label for="unit">Unit or apartment <small>If it’s a building</small></label><input class="in" id="unit" name="unit" maxlength="12" placeholder="4B" value="${esc(v.unit||'')}"></div>
  <div><label for="beds">Bedrooms</label><select class="in" id="beds" name="beds"><option value="">–</option>${[0,1,2,3,4,5].map(n=>`<option value="${n}" ${String(v.beds)===String(n)?'selected':''}>${n===0?'Studio':n}</option>`).join('')}</select></div></div>
  <div class="two"><div><label for="rent">Monthly rent <small>Your share or the whole unit</small></label><input class="in" id="rent" name="rent" type="number" inputmode="numeric" min="100" max="30000" placeholder="2400" value="${v.rent||''}"></div>
  <div><label for="depAmt">Deposit withheld ($)</label><input class="in" id="depAmt" name="depAmt" type="number" inputmode="numeric" min="0" max="100000" placeholder="0" value="${v.depAmt==null?'':v.depAmt}"></div></div>
  <div><label for="depDays">Days to get your deposit back <small>Leave blank if you haven’t moved out</small></label><input class="in" id="depDays" name="depDays" type="number" inputmode="numeric" min="0" max="400" value="${v.depDays==null?'':v.depDays}"></div>
  <fieldset><legend>Problems you had</legend><div class="opts">${Object.entries(ISSUES).map(([k,t])=>`<input type="checkbox" name="issue" id="i-${k}" value="${k}" ${(v.issues||[]).includes(k)?'checked':''}><label for="i-${k}">${t}</label>`).join('')}</div></fieldset>`;
const readDetails = fd => {
  const num = k => { const v = fd.get(k); return v === null || v === '' ? null : Number(v); };
  return {unit: (fd.get('unit')||'').trim().toUpperCase() || null, beds: num('beds'), rent: num('rent'), deposit_amount: num('depAmt'), deposit_days: num('depDays'), issues: fd.getAll('issue')};
};

function rate(id, params){
  const lls = allLandlords();
  const l = id ? getLL(id) : null;
  const addr = params.get('addr') || '', unit = params.get('u') || '';
  const s = session();
  const scale = (name) => `<div class="scale" role="radiogroup" aria-label="${name}">${[1,2,3,4,5].map(n=>`<input type="radio" name="${name}" id="${name}${n}" value="${n}" required><label class="s${n}" for="${name}${n}">${n}</label>`).join('')}</div><div class="scale-ends"><span>Awful</span><span>Awesome</span></div>`;
  return `
  <section class="page">
    <div class="form-wrap">
      <div>
        <h1 class="rv">Rate your landlord.</h1>
        <p class="lede rv" style="--i:1">Two minutes. Be specific, be fair, stick to what happened.</p>
        <p style="margin-top:28px"><a href="#/guidelines" style="font-weight:600;text-underline-offset:3px">Review guidelines</a></p>
        ${remote.on ? `<p class="meta rv" style="margin-top:22px;max-width:30ch">${s ? 'Signed in as <b>'+esc(s.email)+'</b>.'+(/\.edu$/i.test(s.email) ? ' Your review gets a Verified student badge.' : '') : 'No account needed. <a href="#/account">Sign in with a .edu email</a> to get a Verified student badge and edit your review later from any device.'}</p>` : ''}
        <div class="panel rv" style="margin-top:28px;max-width:34ch"><h2 style="font-size:17px;margin-bottom:10px">Not moved out yet?</h2><p class="meta" style="margin-bottom:12px">Add a calendar reminder for your lease end date and rate then.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><input class="in" id="remDate" type="date" aria-label="Lease end date" style="height:42px;flex:1;min-width:140px"><button class="pill pill-out pill-sm" id="remBtn" type="button">Remind me</button></div></div>
      </div>
      <form class="form f rv" id="rateForm" novalidate style="--i:1">
        <div>
          <label for="prop">Property address</label>
          <input class="in" id="prop" name="prop" list="propList" maxlength="100" placeholder="Street address" value="${esc(addr)}" autocomplete="off" required>
          <datalist id="propList">${lls.flatMap(x => x.properties.map(p => `<option value="${esc(p)}">`)).join('')}</datalist>
        </div>
        <div>
          <label for="llSel">Landlord or company</label>
          <select class="in" id="llSel" name="ll" required>
            <option value="">Choose one</option>
            ${lls.map(x=>`<option value="${x.id}" ${l&&l.id===x.id?'selected':''}>${esc(x.name)} · ${esc(x.city)}</option>`).join('')}
            <option value="__new">Not listed, add them</option>
          </select>
          <small class="auto" id="autoNote" hidden></small>
        </div>
        <div class="two hidden" id="newLL">
          <div><label for="newName">Landlord or company name</label><input class="in" id="newName" maxlength="80"></div>
          <div><label for="newCity">City, state</label><input class="in" id="newCity" maxlength="60" placeholder="Los Angeles, CA" value="${/^\d/.test(addr) ? 'Los Angeles, CA' : ''}"></div>
        </div>
        <div>
          <label for="year">Year you lived there</label>
          <select class="in" id="year" name="year">${[2026,2025,2024,2023,2022,2021,2020].map(y=>`<option>${y}</option>`).join('')}<option>Earlier</option></select>
        </div>
        <fieldset><legend>Overall rating</legend>${scale('overall')}</fieldset>
        <fieldset><legend>Responsiveness <small>How fast and how well they answered you</small></legend>${scale('resp')}</fieldset>
        <fieldset><legend>Repairs <small>Did things actually get fixed?</small></legend>${scale('repairs')}</fieldset>
        <fieldset><legend>Security deposit</legend>
          <div class="opts">${[['full','Returned in full'],['partial','Partly returned'],['withheld','Withheld'],['living','Still living here'],['na','No deposit']].map(([k,t])=>`<input type="radio" name="deposit" id="d-${k}" value="${k}" ${k==='living'?'checked':''}><label for="d-${k}">${t}</label>`).join('')}</div>
        </fieldset>
        <fieldset><legend>Would you rent from them again?</legend>
          <div class="opts"><input type="radio" name="again" id="a-y" value="1" required><label for="a-y">Yes</label><input type="radio" name="again" id="a-n" value="0"><label for="a-n">No</label></div>
        </fieldset>
        <fieldset><legend>Tags <small>Pick up to three</small></legend>
          <div class="opts" id="tagOpts">${window.TAGS.map(t=>`<input type="checkbox" name="tag" id="t-${slug(t)}" value="${esc(t)}"><label for="t-${slug(t)}">${esc(t)}</label>`).join('')}</div>
        </fieldset>
        <div>
          <label for="text">Your review <span class="count-c" id="cc">0 / 1000</span></label>
          <textarea class="in" id="text" name="text" maxlength="1000" placeholder="What was it actually like? Mention repairs, notice before entry, rent changes, how your deposit was handled."></textarea>
          <small>No phone numbers, emails or links, and nothing about people’s private lives.</small>
        </div>
        <details class="more" ${unit ? 'open' : ''}><summary>Add details <small>Unit, rent, deposit, problems, photos. All optional.</small></summary>
          <div class="more-in">${detailFields({unit})}
            ${remote.on ? `<div><label for="photos">Photos <small>Up to 4. Shown after a quick check. No faces or documents.</small></label><input class="in file" id="photos" name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple></div>` : ''}
          </div>
        </details>
        <p class="err" id="err" role="alert"></p>
        <div><button class="pill pill-blue" type="submit">Submit rating</button></div>
      </form>
    </div>
  </section>`;
}

function guidelines(){
  return `<section class="page"><h1 class="rv">Review guidelines</h1>
  <div class="prose rv" style="--i:1">
    <p>Landlog only works if reviews are true. Keep yours useful.</p>
    <h2>Say what happened</h2><p>Dates, repairs requested, how long they took, what the lease said. Specifics help the next tenant more than adjectives.</p>
    <h2>Stay on the landlord</h2><p>Rate how the landlord or manager behaved, not who they are. No slurs, threats or personal information.</p>
    <h2>Only rate where you lived</h2><p>You should have rented the property you are reviewing. Reviews are tied to an address for that reason.</p>
    <h2>Landlords can respond</h2><p>A verified landlord’s response appears under the review it answers. It never replaces the review.</p>
    <h2>Report problems</h2><p>Every review has a report button. Reviews that break these rules are removed.</p>
  </div></section>`;
}
const notFound = () => `<section class="page"><h1>Not found.</h1><p class="count">That page does not exist. <a href="#/">Go home</a>.</p></section>`;

/* ---------- router ---------- */
const state = { sort:'high', prop:'all', unit:'', rsort:'new', f:new Set(), more:false };
let cleanup = null;

function route(){
  if(cleanup){ cleanup(); cleanup = null; }
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = hash.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(qs||'');
  let html, after;
  const p0 = parts[0];
  if(!p0){ html = home(); after = bindHome; document.title = 'Landlog – Type the address. Know the landlord.'; }
  else if(p0 === 'search'){ const q = params.get('q'); html = search(q); after = () => bindSearch(q); document.title = (q ? q+' – ' : '') + 'Search – Landlog'; }
  else if(p0 === 'landlord'){ state.prop = params.get('p') || 'all'; state.unit = params.get('u') || ''; state.rsort = 'new'; html = landlord(parts[1]); after = () => bindLandlord(parts[1]); const l = getLL(parts[1]); document.title = (l ? l.name : 'Not found') + ' – Landlog'; }
  else if(p0 === 'addr'){ const u = params.get('u') || ''; html = addrPage(parts[1], u); after = () => bindStars(); const r = REG_BY.get(parts[1]); document.title = (r ? r.a[0] : 'Address') + ' – Landlog'; }
  else if(p0 === 'rate'){ html = rate(parts[1], params); after = bindRate; document.title = 'Rate a landlord – Landlog'; }
  else if(p0 === 'saved'){ html = savedPage(); after = () => bindStars(); document.title = 'Saved places – Landlog'; }
  else if(p0 === 'guidelines'){ html = guidelines(); document.title = 'Review guidelines – Landlog'; }
  else if(LL.routes[p0]){ const m = LL.routes[p0]; html = m.view(parts, params); after = () => m.bind && m.bind(parts, params); document.title = (m.title || 'Landlog') + ' – Landlog'; }
  else { html = notFound(); }
  $main.innerHTML = html;
  document.documentElement.style.scrollBehavior = 'auto';
  window.scrollTo(0,0);
  document.documentElement.style.scrollBehavior = '';
  if(after) after();
  reveal();
  if(!route.first){ route.first = true; track('view', p0 || 'home'); } else if(p0) track('view', p0);
  $$('.bar-nav a').forEach(a => a.removeAttribute('aria-current'));
  const act = $(`.bar-nav a[href="#/${p0 === 'rate' ? 'rate' : p0 || ''}"]`); if(act) act.setAttribute('aria-current', 'page');
  const sess = session(); const ab = $('#acctLink'); if(ab) ab.setAttribute('aria-label', sess ? 'Account' : 'Sign in');
}

function reveal(){
  const els = $$('.rv, .dist-wrap', $main);
  if(!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches){
    els.forEach(e => e.classList.add('shown'));
    $$('.dist', $main).forEach(e => e.classList.add('shown'));
    return;
  }
  const io = new IntersectionObserver(es => es.forEach(e => {
    if(e.isIntersecting){ e.target.classList.add('shown'); if(e.target.classList.contains('dist-wrap')) e.target.querySelectorAll('.dist').forEach(d=>d.classList.add('shown')); io.unobserve(e.target); }
  }), {threshold:.12, rootMargin:'0px 0px -6% 0px'});
  els.forEach(e => io.observe(e));
  $$('.issues .dist', $main).forEach(e => e.classList.add('shown'));
  const prev = cleanup; cleanup = () => { io.disconnect(); prev && prev(); };
}
const shownAll = () => $$('.rv,.dist', $main).forEach(e => e.classList.add('shown'));

/* ---------- saved + compare ---------- */
function savedInfo(s){
  if(s.key.startsWith('l:')){ const l = getLL(s.key.slice(2)); if(!l) return null; const st = stats(l); return {name:l.name, sub:`${l.city}, ${l.state}`, rating:st.overall, n:st.n, again:st.n ? st.again+'%' : '–', rent:st.rent ? money(st.rent) : '–', viol:'–', walk:'–', owner:l.name, href:s.href}; }
  if(s.key.startsWith('p:')){ const [, id, ...rest] = s.key.split(':'), addr = rest.join(':'), l = getLL(id); if(!l) return null; const ps = propStats(l, addr), st = stats(l), r = regOf(addr); return {name:addr, sub:l.name, rating:ps.overall || st.overall, n:ps.n, again:st.n ? st.again+'%' : '–', rent:st.rent ? money(st.rent) : '–', viol:r ? r.a[6]+' cases'+(r.a[7] ? ', '+r.a[7]+' open' : '') : '–', walk:r ? walkMin(miles(r.a[2], r.a[3]))+' min' : '–', owner:l.name, href:s.href}; }
  if(s.key.startsWith('a:')){ const r = REG_BY.get(s.key.slice(2)); if(!r) return REG_READY ? null : {name:s.label, sub:'Loading…', rating:0, n:0, again:'–', rent:'–', viol:'–', walk:'–', owner:'Unknown', href:s.href}; const own = remote.owners[r.slug]; return {name:r.a[0], sub:'Los Angeles, CA '+r.a[1], rating:0, n:0, again:'–', rent:'–', viol:r.a[6]+' cases'+(r.a[7] ? ', '+r.a[7]+' open' : ''), walk:walkMin(miles(r.a[2], r.a[3]))+' min', owner:own ? own.owner : 'Unknown', href:s.href}; }
  return null;
}
function savedPage(){
  const list = savedList();
  loadRegistry();
  const infos = list.map(s => ({s, i: savedInfo(s)})).filter(x => x.i);
  if(!infos.length) return `<section class="page"><h1 class="rv">Saved places</h1><div class="empty rv" style="margin-top:32px"><h2>Nothing saved yet.</h2><p>Tap Save on any address or landlord, then compare them side by side here.</p><a class="pill pill-blue" href="#/search?q=">Browse landlords</a></div></section>`;
  const rows = [['Landlord / owner','owner'],['Rating','rating'],['Ratings','n'],['Would rent again','again'],['Average rent','rent'],['City violations','viol'],['Walk to campus','walk']];
  return `<section class="page"><h1 class="rv">Saved places</h1><p class="count rv">Compare ${infos.length} ${infos.length === 1 ? 'place' : 'places'}.</p>
    <div class="cmp rv" style="--i:1"><table><thead><tr><th scope="col"><span class="sr">Measure</span></th>${infos.map(x => `<th scope="col"><a href="${esc(x.i.href)}">${esc(x.i.name)}</a><small>${esc(x.i.sub)}</small><button class="flag" data-star="${esc(x.s.key)}" data-label="${esc(x.s.label)}" data-href="${esc(x.s.href)}" aria-pressed="true">Remove</button></th>`).join('')}</tr></thead>
    <tbody>${rows.map(([t, k]) => `<tr><th scope="row">${t}</th>${infos.map(x => `<td>${k === 'rating' ? tile(x.i.rating, 'sm') : esc(x.i[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
}

/* ---------- bindings ---------- */
function bindHome(){
  const input = $('#heroQ');
  bindSearchForm($('#heroSearch'), input);
  if(matchMedia('(hover:hover)').matches) setTimeout(() => input.focus({preventScroll:true}), 250);
}
function bindSearch(q){
  bindSearchForm($('#pageSearch'), $('#pageQ'));
  const redo = () => { $main.innerHTML = search(q); bindSearch(q); shownAll(); };
  $$('[data-sort]').forEach(b => b.addEventListener('click', () => { state.sort = b.dataset.sort; redo(); }));
  $$('[data-f]').forEach(b => b.addEventListener('click', () => { state.f.has(b.dataset.f) ? state.f.delete(b.dataset.f) : state.f.add(b.dataset.f); redo(); }));
  const more = $('#moreBtn'); if(more) more.addEventListener('click', () => { state.more = true; redo(); });
  if(!REG_READY && /\d/.test(q || '')) loadRegistry();
}
function bindLandlord(id){
  const rerender = () => { const y = scrollY; $main.innerHTML = landlord(id); bindLandlord(id); shownAll(); scrollTo(0,y); };
  const url = () => { const p = state.prop === 'all' ? '' : '?p='+enc(state.prop)+(state.unit ? '&u='+enc(state.unit) : ''); return '#/landlord/'+id+p; };
  $('#propSel').addEventListener('change', e => { state.prop = e.target.value; state.unit = ''; history.replaceState(null,'', url()); rerender(); });
  $('#rsortSel').addEventListener('change', e => { state.rsort = e.target.value; rerender(); });
  const all = $('#allProps');
  if(all) all.addEventListener('click', () => { state.prop = 'all'; state.unit = ''; history.replaceState(null,'','#/landlord/'+id); rerender(); });
  $$('.props a', $main).forEach(a => a.addEventListener('click', e => { e.preventDefault(); state.prop = a.dataset.p; state.unit = ''; history.replaceState(null,'', a.getAttribute('href')); rerender(); scrollTo(0,0); }));
  bindStars();
  bindReviewActions(rerender);
  const share = $('#shareBtn');
  share.addEventListener('click', async () => {
    const l = getLL(id), s = stats(l);
    if(LL.shareCard){ LL.shareCard({title: state.prop !== 'all' ? state.prop : l.name, sub: state.prop !== 'all' ? l.name : `${l.city}, ${l.state}`, score: state.prop !== 'all' ? (propStats(l, state.prop).overall || s.overall) : s.overall, n: state.prop !== 'all' ? propStats(l, state.prop).n : s.n, url: location.href}); return; }
    try{ await navigator.clipboard.writeText(location.href); share.textContent = 'Link copied'; }catch(e){ share.textContent = 'Copy the address bar'; }
    setTimeout(() => share.textContent = 'Share', 1800);
  });
  const claim = $('#claimBtn'); if(claim) claim.addEventListener('click', () => claimDialog(id));
  const cond = $('#cond'), head = $('#llHead');
  const onScroll = () => { const on = head.getBoundingClientRect().bottom < 64; cond.classList.toggle('on', on); cond.setAttribute('aria-hidden', String(!on)); $$('a', cond).forEach(a => a.tabIndex = on ? 0 : -1); };
  addEventListener('scroll', onScroll, {passive:true}); onScroll();
  cleanup = () => removeEventListener('scroll', onScroll);
}
function claimDialog(llId){
  const l = getLL(llId);
  modal('Claim ' + l.name, `<p class="meta">If you own or manage this property, tell us who you are. After we check, you can sign in with this email and reply to reviews. Replies appear under the review. You can’t edit or remove reviews.</p>
    <div><label for="cn">Your name</label><input class="in" id="cn" name="name" maxlength="80" required></div>
    <div><label for="ce">Email you’ll sign in with</label><input class="in" id="ce" name="email" type="email" maxlength="120" required></div>
    <div><label for="cr">Your role</label><input class="in" id="cr" name="role" maxlength="60" placeholder="Owner, property manager…"></div>
    <div><label for="cm">Anything that helps us verify you</label><textarea class="in" id="cm" name="message" maxlength="500" style="min-height:90px"></textarea></div>`,
    {submit: 'Send claim', onSubmit: async fd => {
      await sbInsert('claims', {ll: llId, name: fd.get('name').trim(), email: fd.get('email').trim(), role: (fd.get('role')||'').trim() || null, message: (fd.get('message')||'').trim() || null});
      toast('Claim sent. We’ll email you after review.');
    }});
}
const REV_BY = id => allReviews().find(r => r.id === id);
function bindReviewActions(rerender, root = $main){
  $$('[data-vote]', root).forEach(b => b.addEventListener('click', async () => {
    const r = REV_BY(b.dataset.vote);
    if(r && r.remote){ try{ r.helpful = await rpc('toggle_vote', {rid: r.id, dev: deviceId()}); const v = store.get('landlog.votes', {}); v[r.id] = !v[r.id]; store.set('landlog.votes', v); }catch(e){ toast('Could not record that. Try again.'); return; } }
    else { const v = store.get('landlog.votes', {}); if(v[b.dataset.vote]) delete v[b.dataset.vote]; else v[b.dataset.vote] = 1; store.set('landlog.votes', v); }
    rerender();
  }));
  $$('[data-flag]', root).forEach(b => b.addEventListener('click', () => {
    const f = store.get('landlog.flags', {}); if(f[b.dataset.flag]) return;
    f[b.dataset.flag] = 1; store.set('landlog.flags', f);
    if(remote.on) rpc('flag_review', {rid: b.dataset.flag, dev: deviceId()}).catch(() => {});
    toast('Thanks. We’ll take a look.'); rerender();
  }));
  $$('[data-reply]', root).forEach(b => b.addEventListener('click', () => {
    const r = REV_BY(b.dataset.reply);
    modal('Reply to this review', `<p class="meta">Replies are public and appear under the review. Stay factual and polite.</p><div><label for="rb">Your reply</label><textarea class="in" id="rb" name="body" maxlength="1000" style="min-height:140px">${esc(r.reply||'')}</textarea></div>`,
      {submit:'Post reply', onSubmit: async fd => { await rpc('reply_review', {rid: r.id, body: fd.get('body')}); r.reply = (fd.get('body')||'').trim() || null; r.replyAt = new Date().toISOString(); }}).then(ok => ok && rerender());
  }));
  $$('[data-edit]', root).forEach(b => b.addEventListener('click', () => editDialog(REV_BY(b.dataset.edit), rerender)));
  $$('[data-del]', root).forEach(b => b.addEventListener('click', () => {
    const r = REV_BY(b.dataset.del);
    modal('Delete your review?', '<p class="meta">This removes it for everyone and can’t be undone.</p>', {submit:'Delete', onSubmit: async () => {
      await rpc('delete_review', {rid: r.id, token: tokens()[r.id] || ''}); remote.rev = remote.rev.filter(x => x.id !== r.id);
    }}).then(ok => { if(ok){ toast('Review deleted.'); rerender(); } });
  }));
}
function editDialog(r, rerender){
  const sel = (name, v) => `<select class="in" id="e-${name}" name="${name}">${[1,2,3,4,5].map(n=>`<option ${n===v?'selected':''}>${n}</option>`).join('')}</select>`;
  modal('Edit your review', `
    <div class="two"><div><label for="e-overall">Overall</label>${sel('overall', r.overall)}</div><div><label for="e-repairs">Repairs</label>${sel('repairs', r.repairs)}</div></div>
    <div class="two"><div><label for="e-resp">Responsiveness</label>${sel('resp', r.resp)}</div><div><label for="e-deposit">Deposit</label><select class="in" id="e-deposit" name="deposit">${Object.entries(depositLabel).map(([k,t])=>`<option value="${k}" ${k===r.deposit?'selected':''}>${t}</option>`).join('')}</select></div></div>
    <div><label for="e-again">Would rent again</label><select class="in" id="e-again" name="again"><option value="1" ${r.again?'selected':''}>Yes</option><option value="0" ${!r.again?'selected':''}>No</option></select></div>
    <div><label for="e-text">Your review</label><textarea class="in" id="e-text" name="text" maxlength="1000">${esc(r.text)}</textarea></div>
    ${detailFields(r)}`, {submit:'Save changes', onSubmit: async fd => {
      const d = readDetails(fd);
      const patch = {text: fd.get('text').trim(), overall:+fd.get('overall'), resp:+fd.get('resp'), repairs:+fd.get('repairs'), deposit:fd.get('deposit'), again: fd.get('again') === '1', unit: d.unit || '', rent: d.rent == null ? '' : d.rent, beds: d.beds == null ? '' : d.beds, deposit_amount: d.deposit_amount == null ? '' : d.deposit_amount, deposit_days: d.deposit_days == null ? '' : d.deposit_days, issues: d.issues};
      await rpc('update_review', {rid: r.id, token: tokens()[r.id] || '', patch});
      Object.assign(r, {text:patch.text, overall:patch.overall, resp:patch.resp, repairs:patch.repairs, deposit:patch.deposit, again:patch.again, unit:d.unit||'', rent:d.rent, beds:d.beds, depAmt:d.deposit_amount, depDays:d.deposit_days, issues:d.issues, edited:new Date().toISOString()});
    }}).then(ok => { if(ok){ toast('Review updated.'); rerender(); } });
}

/* resize photos in the browser so uploads stay small */
function shrink(file, max = 1600){
  return new Promise((res, rej) => {
    const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); c.toBlob(b => b ? res(b) : rej(new Error('Could not read that photo.')), 'image/jpeg', .82); };
    img.onerror = () => rej(new Error('Could not read that photo.')); img.src = u;
  });
}
async function uploadPhoto(reviewId, token, blob){
  const path = reviewId + '/' + rid(10) + '.jpg', tok = await accessToken();
  const r = await fetch(base + '/storage/v1/object/review-photos/' + path, {method:'POST', headers:{apikey: CFG.anonKey, Authorization:'Bearer ' + (tok || CFG.anonKey), 'Content-Type':'image/jpeg'}, body: blob});
  if(!r.ok) throw new Error('Upload failed');
  await rpc('add_photo', {rid: reviewId, token, p: path});
}
const ics = (title, dateStr, url) => {
  const d = dateStr.replace(/-/g, ''), n = new Date(new Date(dateStr + 'T00:00:00').getTime() + 864e5).toISOString().slice(0,10).replace(/-/g,'');
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Landlog//EN','BEGIN:VEVENT','UID:'+rid(12)+'@landlog','DTSTAMP:'+new Date().toISOString().replace(/[-:]|\.\d+/g,''),'DTSTART;VALUE=DATE:'+d,'DTEND;VALUE=DATE:'+n,'SUMMARY:'+title,'DESCRIPTION:'+title+' '+url,'BEGIN:VALARM','TRIGGER:-PT0M','ACTION:DISPLAY','DESCRIPTION:'+title,'END:VALARM','END:VEVENT','END:VCALENDAR'].join('\r\n');
};

function bindRate(){
  const form = $('#rateForm'), sel = $('#llSel'), nl = $('#newLL'), err = $('#err');
  const prop = $('#prop'), note = $('#autoNote');
  loadRegistry();
  const sync = () => nl.classList.toggle('hidden', sel.value !== '__new');
  sel.addEventListener('change', () => { sync(); note.hidden = true; }); sync();
  const autoPick = () => {
    const pt = norm(prop.value).join(' ');
    if(!pt) return;
    for(const l of allLandlords()){
      const p = l.properties.find(x => norm(x).join(' ') === pt);
      if(p){ sel.value = l.id; sync(); note.hidden = false; note.textContent = 'We already know this address. Landlord filled in for you.'; return; }
    }
  };
  prop.addEventListener('input', autoPick); prop.addEventListener('change', autoPick); autoPick();
  const text = $('#text'), cc = $('#cc');
  text.addEventListener('input', () => cc.textContent = text.value.length + ' / 1000');
  $$('input[name=tag]', form).forEach(c => c.addEventListener('change', () => { if($$('input[name=tag]:checked', form).length > 3) c.checked = false; }));
  $('#remBtn').addEventListener('click', () => {
    const d = $('#remDate').value; if(!d){ toast('Pick your lease end date first.'); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ics('Rate your landlord on Landlog', d, location.origin + location.pathname + '#/rate')], {type:'text/calendar'})); a.download = 'landlog-reminder.ics'; a.click(); toast('Reminder downloaded. Open it to add it to your calendar.');
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const fail = m => { err.textContent = m; err.scrollIntoView({block:'center', behavior:'smooth'}); };
    let llId = fd.get('ll');
    const addr = (fd.get('prop')||'').trim();
    if(!addr) return fail('Add the property address.');
    if(!llId) return fail('Choose a landlord.');
    for(const k of ['overall','resp','repairs']) if(!fd.get(k)) return fail('Please give all three ratings.');
    if(fd.get('again') === null) return fail('Tell us whether you would rent from them again.');
    const body = (fd.get('text')||'').trim();
    if(/(\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}/.test(body)) return fail('Please remove phone numbers from your review.');
    if(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(body)) return fail('Please remove email addresses from your review.');
    if(/(https?:\/\/|www\.)/i.test(body)) return fail('Please remove links from your review.');
    const btn = $('[type=submit]', form); const done = m => { btn.disabled = false; btn.textContent = 'Submit rating'; return fail(m); };
    btn.disabled = true; btn.textContent = 'Submitting…';
    let newLL = null;
    if(llId === '__new'){
      const name = $('#newName').value.trim(), cityRaw = $('#newCity').value.trim();
      if(!name || !cityRaw) return done('Add the landlord’s name and city.');
      const same = allLandlords().find(l => norm(l.name).join(' ') === norm(name).join(' '));
      if(same) llId = same.id;
      else { const [city, st] = cityRaw.split(',').map(s => s.trim()); llId = 'u-' + slug(name).slice(0, 60) + '-' + Date.now().toString(36); newLL = {id:llId, name, type:'Added by a tenant', city:city||cityRaw, state:st||'', properties:[]}; }
    }
    const d = readDetails(fd);
    const token = rid(24), id = 'u' + Date.now().toString(36) + rid(3);
    const rev = {id, ll:llId, prop:addr, unit:d.unit || '', year:fd.get('year'), overall:+fd.get('overall'), resp:+fd.get('resp'), repairs:+fd.get('repairs'), deposit:fd.get('deposit'), again:fd.get('again')==='1', tags:fd.getAll('tag'), issues:d.issues, text:body, reply:null, date:new Date().toISOString(), rent:d.rent, beds:d.beds, depAmt:d.deposit_amount, depDays:d.deposit_days};
    if(remote.on){
      try {
        if(newLL) await sbInsert('landlords', {id:newLL.id, name:newLL.name, type:newLL.type, city:newLL.city, state:newLL.state});
        await sbInsert('ll_props', {ll:llId, prop:addr}, '?on_conflict=ll,prop');
        await sbInsert('reviews', {id, ll:llId, prop:addr, unit:d.unit, year:String(rev.year||'').slice(0,4), overall:rev.overall, resp:rev.resp, repairs:rev.repairs, deposit:rev.deposit, again:rev.again, tags:rev.tags, issues:d.issues, text:body,
          rent:d.rent, beds:d.beds, deposit_amount:d.deposit_amount, deposit_days:d.deposit_days, device:deviceId(), owner_hash: await sha256(token)});
      } catch(x){ return done(x.message && !/fetch|network/i.test(x.message) ? x.message : 'Could not save your review. Check your connection and try again.'); }
      const t = tokens(); t[id] = token; store.set('landlog.tokens', t);
      const files = $('#photos') ? [...$('#photos').files].slice(0, 4) : [];
      let failed = 0;
      for(const f of files){ try{ btn.textContent = 'Uploading photos…'; await uploadPhoto(id, token, await shrink(f)); }catch(x){ failed++; } }
      if(files.length) toast(failed ? 'Review posted. Some photos could not upload.' : 'Review posted. Photos appear after a quick check.');
      if(newLL){ newLL.properties.push(addr); remote.ll.push(newLL); }
      else { const l = getLL(llId); if(l && !l.properties.includes(addr)) l.properties.push(addr); }
      remote.rev.unshift(Object.assign({}, rev, {mine:true, remote:true, verified:!!(session() && /\.edu$/i.test(session().email)), helpful:0}));
      track('review', '');
    } else {
      if(newLL){ const arr = store.get('landlog.ll', []); arr.push(newLL); store.set('landlog.ll', arr); }
      const mine = store.get('landlog.rev', []); mine.push(rev); store.set('landlog.rev', mine);
      const ll = getLL(llId);
      if(ll && !ll.properties.includes(addr)){
        if(llId.startsWith('u-')){ const arr = store.get('landlog.ll', []); const t = arr.find(x=>x.id===llId); if(t){ t.properties.push(addr); store.set('landlog.ll', arr); } }
        else { const extra = store.get('landlog.props', {}); (extra[llId] = extra[llId]||[]).push(addr); store.set('landlog.props', extra); ll.properties.push(addr); }
      }
    }
    location.hash = '#/landlord/' + llId + '?p=' + enc(addr) + (d.unit ? '&u=' + enc(d.unit) : '');
  });
}

/* ---------- module API for extra.js ---------- */
Object.assign(LL, {esc, enc, slug, store, $, $$, rid, tile, fmt, cls, avg, money, when, sampleTag, isSample, allLandlords, allReviews, getLL, stats, propStats, propHref, regHref, regOf, norm, addrKey,
  sb, sbInsert, rpc, base, CFG, remote, session, signIn, signOut, accessToken, loadRemote, modal, toast, track, miles, walkMin, distLabel, ISSUES, depositLabel, plainViol, reviewCard, bindReviewActions,
  reg: () => REG, regBy: () => REG_BY, regReady: () => REG_READY, loadRegistry, route, reveal, shownAll, state, theme, deviceId, photoUrl, mapRev, notFound, FILTERS, sortReviews});

/* ---------- global ---------- */
const barQ = $('#barQ');
bindSearchForm($('#barSearch'), barQ);
const tb = $('#themeBtn'); if(tb) tb.addEventListener('click', theme.toggle);
document.addEventListener('keydown', e => {
  if(e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !document.querySelector('dialog[open]')){
    e.preventDefault();
    ($('#heroQ') || $('#pageQ') || barQ).focus();
  }
});
window.addEventListener('hashchange', route);
route();
const idle = window.requestIdleCallback || (f => setTimeout(f, 800));
idle(() => { if(!REG_READY && /^#\/(addr|search|map|saved)/.test(location.hash)) loadRegistry(); else setTimeout(loadRegistry, 1500); });
if(remote.on) loadRemote().then(n => { if(n && !/^#\/(rate|admin|account)/.test(location.hash)) route(); else if(/^#\/(admin|account)/.test(location.hash)) route(); }).catch(() => {});
})();
