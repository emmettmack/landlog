/* Landlog extras: account, admin console, map, invite page, share cards. Loaded after app.js. */
(function(){
'use strict';
const L = window.LL; if(!L) return;
const {esc, enc, $, $$, tile, fmt, money, when, sb, rpc, remote, session, toast, modal, store} = L;
const isEdu = e => /\.edu$/i.test(e || '');

/* ---------- account ---------- */
L.routes.account = {
  title: 'Account',
  view(){
    if(!remote.on) return `<section class="page"><h1 class="rv">Account</h1><p class="count">Accounts turn on once the shared database is connected.</p></section>`;
    const s = session(), err = store.get('landlog.autherr', '');
    if(err){ store.set('landlog.autherr', ''); }
    if(!s) return `<section class="page"><h1 class="rv">Sign in</h1>
      <p class="lede rv" style="--i:1">No password. We email you a link. Use a .edu address to add a Verified student badge to your reviews.</p>
      ${err ? `<p class="err">${esc(err)}</p>` : ''}
      <form class="form f rv" id="signForm" style="--i:2;max-width:560px;margin-top:36px" novalidate>
        <div><label for="em">Email</label><input class="in" id="em" name="email" type="email" autocomplete="email" placeholder="you@usc.edu" required></div>
        <p class="err" id="signErr" role="alert"></p>
        <div><button class="pill pill-blue" type="submit">Email me a link</button></div>
      </form>
      <p class="meta" style="margin-top:18px;max-width:56ch">You never need an account to read or to post a review. An account lets you edit or delete your reviews from any device, and lets a verified landlord reply.</p></section>`;
    const mine = L.allReviews().filter(r => r.mine && r.remote);
    return `<section class="page"><h1 class="rv">Your account</h1>
      <p class="count rv">${esc(s.email)} ${isEdu(s.email) ? '<span class="ver">Verified student</span>' : ''} ${remote.admin ? '<span class="you">Admin</span>' : ''}</p>
      <div class="actions rv" style="--i:1;margin-top:20px">${remote.admin ? '<a class="pill pill-blue" href="#/admin">Open admin console</a>' : ''}<a class="pill pill-out" href="#/saved">Saved places</a><button class="pill pill-out" id="outBtn" type="button">Sign out</button></div>
      ${remote.myLL.size ? `<h2 class="sec">Landlord profiles you manage</h2><div class="results">${[...remote.myLL].map(id => L.getLL(id)).filter(Boolean).map(l => `<a class="result" href="#/landlord/${l.id}">${tile(L.stats(l).overall,'lg')}<div><h2>${esc(l.name)}</h2><p class="meta">Open the page to reply to reviews</p></div></a>`).join('')}</div>` : ''}
      <h2 class="sec">Your reviews</h2>
      ${!remote.loaded ? '<p class="count">Loading…</p>' : mine.length ? `<div class="rev-list">${mine.map(r => L.reviewCard(r)).join('')}</div>` : '<div class="empty"><h2>No reviews yet.</h2><p>When you rate a landlord while signed in, it shows up here so you can edit it.</p><a class="pill pill-blue" href="#/rate">Rate a landlord</a></div>'}
    </section>`;
  },
  bind(){
    const f = $('#signForm');
    if(f) f.addEventListener('submit', async e => {
      e.preventDefault(); const em = $('#em').value.trim(), er = $('#signErr'), b = $('[type=submit]', f);
      if(!/^\S+@\S+\.\S+$/.test(em)){ er.textContent = 'Enter a valid email.'; return; }
      b.disabled = true; er.textContent = '';
      try{ await L.signIn(em); f.innerHTML = `<h2 style="font:600 24px var(--font)">Check your email.</h2><p class="meta">We sent a sign-in link to <b>${esc(em)}</b>. Open it on this device. It can take a minute.</p>`; }
      catch(x){ er.textContent = x.message; b.disabled = false; }
    });
    const o = $('#outBtn'); if(o) o.addEventListener('click', () => { L.signOut(); toast('Signed out.'); location.hash = '#/'; L.route(); });
    L.bindReviewActions(() => { L.route(); }, $('#main'));
    if(session() && !remote.loaded) L.loadRemote().then(() => L.route()).catch(() => {});
  }
};

/* ---------- admin console ---------- */
const adminState = {tab: 'queue'};
const TABS = [['queue','Reviews'],['photos','Photos'],['claims','Claims'],['owners','Owners'],['entities','Entities'],['words','Words'],['stats','Analytics'],['data','Data']];
L.routes.admin = {
  title: 'Admin',
  view(){
    if(!remote.on) return L.notFound();
    if(!session()) return `<section class="page"><h1 class="rv">Admin</h1><p class="count">Sign in first. <a href="#/account">Sign in</a></p></section>`;
    if(!remote.loaded) return `<section class="page"><h1 class="rv">Admin</h1><p class="count">Loading…</p></section>`;
    if(!remote.admin) return `<section class="page"><h1 class="rv">Admin</h1><p class="count">This account isn’t an admin.</p></section>`;
    return `<section class="page admin"><h1 class="rv">Admin console</h1>
      <div class="filters" role="tablist" aria-label="Admin sections">${TABS.map(([k,t]) => `<button class="chip" role="tab" data-tab="${k}" aria-pressed="${adminState.tab===k}">${t}</button>`).join('')}</div>
      <div id="adminBody" aria-live="polite"><p class="count">Loading…</p></div></section>`;
  },
  bind(){
    if(!remote.admin) return;
    $$('[data-tab]').forEach(b => b.addEventListener('click', () => { adminState.tab = b.dataset.tab; $$('[data-tab]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); load(); }));
    load();
  }
};
async function load(){
  const body = $('#adminBody'); if(!body) return;
  body.innerHTML = '<p class="count">Loading…</p>';
  try{ await TAB[adminState.tab](body); }catch(e){ body.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
const act = (body, sel, fn) => $$(sel, body).forEach(b => b.addEventListener('click', async () => { b.disabled = true; try{ await fn(b); }catch(e){ toast(e.message); b.disabled = false; return; } load(); }));
const row = (k, v) => `<span>${k}: <b>${esc(v)}</b></span>`;
const TAB = {
  async queue(body){
    const rows = await sb('reviews?select=*&order=created_at.desc&limit=150');
    const lls = Object.fromEntries(L.allLandlords().map(l => [l.id, l.name]));
    const flagged = rows.filter(r => r.flags > 0 || r.hidden), show = adminState.all ? rows : flagged;
    body.innerHTML = `<div class="filters"><button class="chip" id="qAll" aria-pressed="${!!adminState.all}">Show all recent (${rows.length})</button><span class="meta">${flagged.length} reported or hidden</span></div>
      ${show.length ? show.map(r => `<article class="rev adm" style="grid-template-columns:70px 1fr"><div>${tile(r.overall,'sm')}</div><div>
        <div class="rev-top"><h3>${esc(r.prop)}${r.unit ? ' · '+esc(r.unit) : ''}</h3><time>${when(r.created_at)}</time></div>
        <div class="facts">${row('Landlord', lls[r.ll] || r.ll)}${row('Reports', r.flags)}${row('Status', r.hidden ? 'Hidden' : 'Live')}${r.verified ? row('Verified', 'yes') : ''}</div>
        <p class="text">${esc(r.text)}</p>${r.reply ? `<div class="reply"><b>Reply</b>${esc(r.reply)}</div>` : ''}
        <div class="rev-foot"><button class="pill pill-out pill-sm" data-hide="${r.id}" data-to="${!r.hidden}">${r.hidden ? 'Restore' : 'Hide'}</button><button class="pill pill-out pill-sm" data-del="${r.id}">Delete</button><button class="pill pill-out pill-sm" data-clear="${r.id}">Clear reports</button></div></div></article>`).join('') : '<div class="empty"><h2>Nothing reported.</h2><p>Reported and hidden reviews show up here.</p></div>'}`;
    $('#qAll').addEventListener('click', () => { adminState.all = !adminState.all; load(); });
    act(body, '[data-hide]', b => sb('reviews?id=eq.' + b.dataset.hide, {method:'PATCH', body: JSON.stringify({hidden: b.dataset.to === 'true'})}));
    act(body, '[data-clear]', b => sb('reviews?id=eq.' + b.dataset.clear, {method:'PATCH', body: JSON.stringify({flags: 0, hidden: false})}).then(() => sb('reports?review_id=eq.' + b.dataset.clear, {method:'DELETE'})));
    $$('[data-del]', body).forEach(b => b.addEventListener('click', async () => {
      if(!confirm('Delete this review for good?')) return;
      await sb('review_photos?review_id=eq.' + b.dataset.del, {method:'DELETE'}); await sb('reviews?id=eq.' + b.dataset.del, {method:'DELETE'}); load();
    }));
  },
  async photos(body){
    const rows = await sb('review_photos?select=*&approved=eq.false&order=created_at');
    body.innerHTML = rows.length ? `<div class="photo-q">${rows.map(p => `<figure><a href="${esc(L.photoUrl(p.path))}" target="_blank" rel="noopener"><img src="${esc(L.photoUrl(p.path))}" alt="Pending photo" loading="lazy"></a><figcaption><button class="pill pill-blue pill-sm" data-ok="${p.id}">Approve</button> <button class="pill pill-out pill-sm" data-no="${p.id}" data-path="${esc(p.path)}">Reject</button></figcaption></figure>`).join('')}</div>` : '<div class="empty"><h2>No photos waiting.</h2></div>';
    act(body, '[data-ok]', b => sb('review_photos?id=eq.' + b.dataset.ok, {method:'PATCH', body: JSON.stringify({approved: true})}));
    act(body, '[data-no]', async b => { await sb('review_photos?id=eq.' + b.dataset.no, {method:'DELETE'}); const t = await L.accessToken(); await fetch(L.base + '/storage/v1/object/review-photos/' + b.dataset.path, {method:'DELETE', headers:{apikey: L.CFG.anonKey, Authorization:'Bearer ' + t}}).catch(() => {}); });
  },
  async claims(body){
    const rows = await sb('claims?select=*&order=created_at.desc');
    const lls = Object.fromEntries(L.allLandlords().map(l => [l.id, l.name]));
    body.innerHTML = rows.length ? rows.map(c => `<article class="panel" style="margin-bottom:14px"><h2>${esc(lls[c.ll] || c.ll)} <small class="meta">${esc(c.status)}</small></h2><p class="meta">${esc(c.name)} · ${esc(c.email)}${c.role ? ' · '+esc(c.role) : ''} · ${when(c.created_at)}</p>${c.message ? `<p>${esc(c.message)}</p>` : ''}${c.status === 'pending' ? `<div class="actions"><button class="pill pill-blue pill-sm" data-ap="${c.id}" data-ll="${esc(c.ll)}" data-em="${esc(c.email)}">Approve</button><button class="pill pill-out pill-sm" data-rj="${c.id}">Reject</button></div>` : ''}</article>`).join('') : '<div class="empty"><h2>No claims yet.</h2></div>';
    act(body, '[data-ap]', async b => { await L.sbInsert('landlord_owners', {ll: b.dataset.ll, email: b.dataset.em.toLowerCase()}, '?on_conflict=ll,email'); await sb('claims?id=eq.' + b.dataset.ap, {method:'PATCH', body: JSON.stringify({status:'approved'})}); toast('Approved. They can sign in with that email and reply.'); });
    act(body, '[data-rj]', b => sb('claims?id=eq.' + b.dataset.rj, {method:'PATCH', body: JSON.stringify({status:'rejected'})}));
  },
  async owners(body){
    await L.loadRegistry();
    const [own, al] = await Promise.all([sb('addr_owners?select=slug&limit=1&order=updated_at.desc').then(() => sb('addr_owners?select=slug')), sb('aliases?select=*&order=name')]);
    body.innerHTML = `<div class="panel"><h2>Owners of record (${own.length} loaded)</h2><p class="meta">Paste one per line: <code>address, owner name, source</code>. Source is optional, like “LA County Assessor, 2026 roll”. Addresses are matched to the public list.</p>
      <form id="ownForm" class="f" style="margin-top:16px"><textarea class="in" id="ownTxt" style="min-height:170px" placeholder="1212 W 37th Drive, Example Holdings LLC, Assessor 2026"></textarea><p class="err" id="ownMsg" role="status"></p><div class="actions"><button class="pill pill-blue pill-sm" type="submit">Import</button><label class="pill pill-out pill-sm" style="cursor:pointer">Choose CSV file<input id="ownFile" type="file" accept=".csv,text/csv,text/plain" hidden></label></div></form></div>
      <div class="panel"><h2>Building names (${al.length})</h2><p class="meta">So “Lorenzo” finds the right address. Enter the street address it sits at.</p>
      <form id="alForm" class="f two" style="margin-top:14px"><input class="in" name="name" placeholder="Building name" maxlength="80" required aria-label="Building name"><input class="in" name="addr" placeholder="Street address" required aria-label="Street address"><button class="pill pill-blue pill-sm" type="submit">Add name</button></form>
      <p class="err" id="alMsg" role="status"></p>${al.length ? `<div class="tags-top" style="margin-top:14px">${al.map(a => `<span class="tag">${esc(a.name)} <button class="x" data-rmal="${esc(a.name)}" aria-label="Remove ${esc(a.name)}">×</button></span>`).join('')}</div>` : ''}</div>`;
    const find = a => L.regOf(String(a).split(',')[0].trim());
    const parse = txt => txt.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => { const p = l.match(/("[^"]*"|[^,]+)/g)?.map(s => s.replace(/^"|"$/g, '').trim()) || []; return {addr: p[0], owner: p[1], source: p[2] || null}; }).filter(x => x.addr && x.owner && !/^address$/i.test(x.addr));
    $('#ownFile').addEventListener('change', async e => { const f = e.target.files[0]; if(f) $('#ownTxt').value = await f.text(); });
    $('#ownForm').addEventListener('submit', async e => {
      e.preventDefault(); const msg = $('#ownMsg'), rows = parse($('#ownTxt').value), ok = [], miss = [];
      rows.forEach(x => { const r = find(x.addr); r ? ok.push({slug: r.slug, owner: x.owner.slice(0,120), source: x.source, updated_at: new Date().toISOString()}) : miss.push(x.addr); });
      if(!ok.length){ msg.textContent = 'No addresses matched the public list.'; return; }
      for(let i = 0; i < ok.length; i += 500) await sb('addr_owners?on_conflict=slug', {method:'POST', body: JSON.stringify(ok.slice(i, i + 500)), headers:{Prefer:'resolution=merge-duplicates,return=minimal'}});
      msg.textContent = `Imported ${ok.length}.${miss.length ? ' Not matched: ' + miss.slice(0, 5).join('; ') + (miss.length > 5 ? '…' : '') : ''}`;
      ok.forEach(o => remote.owners[o.slug] = o);
    });
    $('#alForm').addEventListener('submit', async e => {
      e.preventDefault(); const fd = new FormData(e.target), r = find(fd.get('addr')), msg = $('#alMsg');
      if(!r){ msg.textContent = 'That address isn’t in the public list.'; return; }
      await L.sbInsert('aliases', {name: fd.get('name').trim(), slug: r.slug}, '?on_conflict=name'); remote.aliases.push({name: fd.get('name').trim(), slug: r.slug, t: L.norm(fd.get('name'))}); load();
    });
    act(body, '[data-rmal]', async b => { await sb('aliases?name=eq.' + enc(b.dataset.rmal), {method:'DELETE'}); remote.aliases = remote.aliases.filter(a => a.name !== b.dataset.rmal); });
  },
  async entities(body){
    const lls = await sb('landlords?select=id,name,parent&order=name');
    body.innerHTML = `<div class="panel"><h2>Group entities under a management company</h2><p class="meta">Landlords added by tenants appear here. Setting the same company name on several shows them together and combines their score.</p>
      ${lls.length ? lls.map(l => `<form class="two ent" data-id="${esc(l.id)}" style="margin-top:12px;align-items:center"><span>${esc(l.name)}</span><span style="display:flex;gap:8px"><input class="in" name="parent" value="${esc(l.parent || '')}" placeholder="Management company" maxlength="80" aria-label="Management company for ${esc(l.name)}" style="height:42px"><button class="pill pill-out pill-sm" type="submit">Save</button></span></form>`).join('') : '<p class="meta">No tenant-added landlords yet.</p>'}</div>`;
    $$('.ent', body).forEach(f => f.addEventListener('submit', async e => { e.preventDefault(); const v = new FormData(f).get('parent').trim(); await sb('landlords?id=eq.' + f.dataset.id, {method:'PATCH', body: JSON.stringify({parent: v || null})}); const l = remote.ll.find(x => x.id === f.dataset.id); if(l) l.parent = v; toast('Saved.'); }));
  },
  async words(body){
    const rows = await sb('banned_words?select=word&order=word');
    body.innerHTML = `<div class="panel"><h2>Blocked words</h2><p class="meta">Reviews and replies containing these words are rejected. Phone numbers, emails and links are always blocked.</p>
      <form id="wForm" class="f two" style="margin-top:14px"><input class="in" name="w" maxlength="40" placeholder="Word to block" aria-label="Word to block" required><button class="pill pill-blue pill-sm" type="submit">Add</button></form>
      <div class="tags-top" style="margin-top:14px">${rows.map(r => `<span class="tag">${esc(r.word)} <button class="x" data-rm="${esc(r.word)}" aria-label="Remove ${esc(r.word)}">×</button></span>`).join('') || '<span class="meta">None yet.</span>'}</div></div>`;
    $('#wForm').addEventListener('submit', async e => { e.preventDefault(); await L.sbInsert('banned_words', {word: new FormData(e.target).get('w').trim().toLowerCase()}, '?on_conflict=word'); load(); });
    act(body, '[data-rm]', b => sb('banned_words?word=eq.' + enc(b.dataset.rm), {method:'DELETE'}));
  },
  async stats(body){
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const ev = await sb('events?select=name,path,q,created_at&created_at=gte.' + since + '&order=created_at.desc&limit=5000');
    const [rv] = await Promise.all([sb('reviews?select=id,created_at&limit=5000')]);
    const days = {}, top = {}, zero = {}, views = {};
    ev.forEach(e => { const d = e.created_at.slice(0, 10); if(e.name === 'search'){ days[d] = (days[d] || 0) + 1; const k = (e.q || '').toLowerCase(); if(k) top[k] = (top[k] || 0) + 1; } else if(e.name === 'zero'){ const k = (e.q || '').toLowerCase(); if(k) zero[k] = (zero[k] || 0) + 1; } else if(e.name === 'view'){ views[e.path || 'home'] = (views[e.path || 'home'] || 0) + 1; } });
    const list = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 12);
    const tbl = (t, o, empty) => `<div class="panel"><h2>${t}</h2>${list(o).length ? `<table class="simple"><tbody>${list(o).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('')}</tbody></table>` : `<p class="meta">${empty}</p>`}</div>`;
    const week = Object.entries(days).sort().slice(-7);
    body.innerHTML = `<div class="rf" style="margin-bottom:20px"><div><b>${rv.length}</b><span>Reviews total</span></div><div><b>${rv.filter(r => r.created_at >= new Date(Date.now() - 7 * 864e5).toISOString()).length}</b><span>Reviews, last 7 days</span></div><div><b>${ev.filter(e => e.name === 'search').length}</b><span>Searches, 30 days</span></div><div><b>${ev.filter(e => e.name === 'zero').length}</b><span>Searches with no result</span></div></div>
      <div class="boards">${tbl('Top searches', top, 'No searches yet.')}${tbl('Searches that found nothing', zero, 'None yet. This list shows which addresses or landlords people want that you don’t have.')}</div>
      <div class="boards" style="margin-top:20px">${tbl('Pages viewed', views, 'No views yet.')}<div class="panel"><h2>Searches per day</h2>${week.length ? `<table class="simple"><tbody>${week.map(([d, v]) => `<tr><td>${d}</td><td>${v}</td></tr>`).join('')}</tbody></table>` : '<p class="meta">No data yet.</p>'}</div></div>
      <p class="meta" style="margin-top:14px">Counts only what was searched or viewed. No cookies, no IDs, no IP addresses.</p>`;
  },
  async data(body){
    body.innerHTML = `<div class="panel"><h2>Export everything</h2><p class="meta">Downloads every table (including hidden reviews, claims and analytics) as one JSON file. A weekly automatic copy of the public data is also saved in the code repository.</p><div class="actions"><button class="pill pill-blue" id="exJson" type="button">Download JSON</button><button class="pill pill-out" id="exCsv" type="button">Reviews as CSV</button></div><p class="err" id="exMsg" role="status"></p></div>`;
    const grab = async () => { const out = {exported: new Date().toISOString()}; for(const t of ['landlords','ll_props','reviews','review_photos','claims','landlord_owners','addr_owners','aliases','banned_words','events']){ out[t] = await sb(t + '?select=*&limit=50000'); } return out; };
    const save = (name, text, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], {type})); a.download = name; a.click(); };
    $('#exJson').addEventListener('click', async () => { $('#exMsg').textContent = 'Exporting…'; save('landlog-' + new Date().toISOString().slice(0,10) + '.json', JSON.stringify(await grab(), null, 1), 'application/json'); $('#exMsg').textContent = 'Done.'; });
    $('#exCsv').addEventListener('click', async () => { const rs = await sb('reviews?select=*&order=created_at&limit=50000'); const cols = Object.keys(rs[0] || {id:1}); const q = v => '"' + String(v == null ? '' : Array.isArray(v) ? v.join('|') : v).replace(/"/g, '""') + '"'; save('landlog-reviews.csv', [cols.join(','), ...rs.map(r => cols.map(c => q(r[c])).join(','))].join('\n'), 'text/csv'); });
  }
};

/* ---------- map ---------- */
let leaf = null;
function loadLeaflet(){
  if(window.L && window.L.map) return Promise.resolve();
  if(leaf) return leaf;
  leaf = new Promise((res, rej) => {
    const c = document.createElement('link'); c.rel = 'stylesheet'; c.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.appendChild(c);
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'; s.onload = res; s.onerror = () => rej(new Error('Map failed to load.')); document.head.appendChild(s);
  });
  return leaf;
}
const mapState = {mode: 'all'};
L.routes.map = {
  title: 'Map',
  view(){ return `<section class="page mappage"><h1 class="rv">Map</h1><p class="count rv">Every address near campus. Colored dots have tenant ratings; ringed dots have open city violations.</p>
    <div class="filters rv" role="group" aria-label="Map filter">${[['all','All addresses'],['rated','Rated'],['viol','Violations']].map(([k, t]) => `<button class="chip" data-m="${k}" aria-pressed="${mapState.mode===k}">${t}</button>`).join('')}</div>
    <div id="map" class="map rv" role="region" aria-label="Map of rentals near USC"><p class="count" style="padding:24px">Loading map…</p></div>
    <div class="legend"><span><i style="background:#6ee7b7"></i>Rated 4+</span><span><i style="background:#ffd66b"></i>Rated 2.5 to 4</span><span><i style="background:#ff7a85"></i>Rated under 2.5</span><span><i class="ring"></i>Open violations</span><span><i style="background:rgba(160,160,170,.7)"></i>No ratings</span></div></section>`; },
  bind(parts, params){
    Promise.all([loadLeaflet(), L.loadRegistry()]).then(() => {
      const el = $('#map'); if(!el) return; el.innerHTML = '';
      const light = document.documentElement.dataset.theme === 'light';
      const map = window.L.map(el, {zoomControl: true, preferCanvas: true}).setView([34.0224, -118.2851], 15);
      window.L.tileLayer(`https://{s}.basemaps.cartocdn.com/${light ? 'light_all' : 'dark_all'}/{z}/{x}/{y}{r}.png`, {maxZoom: 19, attribution: '© OpenStreetMap contributors © CARTO'}).addTo(map);
      window.L.circleMarker([34.0224, -118.2851], {radius: 9, color: '#fff', weight: 2, fillColor: '#e0212f', fillOpacity: 1}).bindTooltip('USC').addTo(map);
      const rated = new Map();
      L.allLandlords().forEach(l => l.properties.forEach(p => { const ps = L.propStats(l, p); if(ps.n){ const r = L.regOf(p); if(r) rated.set(r.slug, {l, p, v: ps.overall, n: ps.n}); } }));
      const layer = window.L.layerGroup().addTo(map);
      const draw = () => {
        layer.clearLayers();
        L.reg().forEach(r => {
          const [addr, zip, lat, lon, units, , cases, open] = r.a, rt = rated.get(r.slug);
          if(mapState.mode === 'rated' && !rt) return; if(mapState.mode === 'viol' && !open) return;
          const col = rt ? (rt.v >= 4 ? '#6ee7b7' : rt.v >= 2.5 ? '#ffd66b' : '#ff7a85') : 'rgba(160,160,170,.7)';
          const m = window.L.circleMarker([lat, lon], {radius: rt ? 7 : 4, color: open ? '#ff4d4d' : 'rgba(0,0,0,.25)', weight: open ? 2 : 1, fillColor: col, fillOpacity: .9});
          m.bindPopup(`<b>${esc(addr)}</b><br>${units} ${units === 1 ? 'unit' : 'units'}${rt ? `<br>Rated ${fmt(rt.v)} (${rt.n})` : ''}${cases ? `<br>${cases} city violation ${cases === 1 ? 'case' : 'cases'}` : ''}<br><a href="${rt ? L.propHref(rt.l, rt.p) : L.regHref(r)}">Open</a>`);
          m.addTo(layer);
        });
      };
      draw();
      $$('[data-m]').forEach(b => b.addEventListener('click', () => { mapState.mode = b.dataset.m; $$('[data-m]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); draw(); }));
      const f = params.get('focus'), r = f && L.regBy().get(f); if(r) map.setView([r.a[2], r.a[3]], 18);
    }).catch(e => { const el = $('#map'); if(el) el.innerHTML = `<p class="err" style="padding:24px">${esc(e.message)}</p>`; });
  }
};

/* ---------- invite page ---------- */
let qrp = null;
const loadQR = () => qrp || (qrp = new Promise((res, rej) => { if(window.qrcode) return res(); const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); }));
L.routes.invite = {
  title: 'Invite',
  view(){
    const url = location.origin + location.pathname;
    const msgs = [['Group chat', `Rate your landlord and see who you’re about to rent from. It takes two minutes and no account: ${url}`], ['Building or house group', `If you live at our place, add a review of the landlord so the next tenants know what to expect: ${url}#/rate`], ['Looking for a place', `Before you sign anything, look up the address here to see what other tenants say: ${url}`]];
    return `<section class="page"><h1 class="rv">Invite your building.</h1><p class="lede rv" style="--i:1">The site gets useful one honest review at a time. Send it to the people who have lived somewhere.</p>
      <div class="boards" style="margin-top:40px"><div class="panel rv"><h2>Messages to copy</h2>${msgs.map(([t, m], i) => `<div style="margin-bottom:18px"><p class="meta" style="margin-bottom:6px">${t}</p><div class="copybox">${esc(m)}</div><button class="pill pill-out pill-sm" data-copy="${i}" type="button" style="margin-top:8px">Copy</button></div>`).join('')}</div>
      <div class="panel rv" style="--i:1"><h2>Flyer and QR code</h2><p class="meta">Print it, tape it in a laundry room or mailroom, or post the image.</p><div id="qr" class="qr" role="img" aria-label="QR code for ${esc(url)}"></div><p class="meta" style="margin-top:10px;word-break:break-all">${esc(url)}</p><div class="actions" style="margin-top:14px"><button class="pill pill-blue pill-sm" id="printFly" type="button">Print flyer</button><button class="pill pill-out pill-sm" id="copyLink" type="button">Copy link</button></div></div></div>
      <div class="flyer" id="flyer" aria-hidden="true"><h2>Rate your landlord.</h2><p>Two minutes. No account. Help the next tenant know what they’re signing.</p><div id="qr2" class="qr"></div><p class="u">${esc(url)}</p></div></section>`;
  },
  bind(){
    const url = location.origin + location.pathname;
    const msgs = $$('.copybox').map(b => b.textContent);
    $$('[data-copy]').forEach(b => b.addEventListener('click', async () => { try{ await navigator.clipboard.writeText(msgs[+b.dataset.copy]); toast('Copied.'); }catch(e){ toast('Select the text and copy it.'); } }));
    $('#copyLink').addEventListener('click', async () => { try{ await navigator.clipboard.writeText(url); toast('Link copied.'); }catch(e){ toast('Copy the address bar.'); } });
    $('#printFly').addEventListener('click', () => { document.body.classList.add('printing'); window.print(); setTimeout(() => document.body.classList.remove('printing'), 500); });
    loadQR().then(() => { const q = window.qrcode(0, 'M'); q.addData(url); q.make(); const svg = q.createSvgTag({cellSize: 6, margin: 2, scalable: true}); ['qr', 'qr2'].forEach(id => { const e = $('#' + id); if(e) e.innerHTML = svg; }); }).catch(() => { const e = $('#qr'); if(e) e.textContent = 'QR code could not load.'; });
  }
};

/* ---------- share card (an image you can post or text) ---------- */
L.shareCard = async function(o){
  const w = 1200, h = 630, c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.fillStyle = '#050507'; g.fillRect(0, 0, w, h);
  [['#e0212f', 180, 80, 520], ['#ff7a1a', 1050, 120, 440], ['#ffb400', 640, 600, 380]].forEach(([col, x, y, r]) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, col + 'aa'); gr.addColorStop(1, col + '00'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  g.fillStyle = 'rgba(255,255,255,.08)'; g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 2; g.beginPath(); g.roundRect(60, 60, w - 120, h - 120, 48); g.fill(); g.stroke();
  g.fillStyle = '#fff'; g.font = '700 38px Inter, system-ui, sans-serif'; g.fillText('Landlog', 110, 130);
  const v = o.n ? o.score : 0, col = !v ? '#ffffff' : v >= 4 ? '#6ee7b7' : v >= 2.5 ? '#ffd66b' : '#ff7a85';
  g.fillStyle = col; g.font = '700 230px Inter, system-ui, sans-serif'; g.fillText(v ? fmt(v) : '–', 110, 400);
  g.fillStyle = 'rgba(255,255,255,.6)'; g.font = '500 34px Inter, system-ui, sans-serif'; g.fillText(o.n ? `/ 5 from ${o.n} tenant ${o.n === 1 ? 'rating' : 'ratings'}` : 'No ratings yet', 110, 460);
  g.fillStyle = '#fff'; g.font = '700 56px Inter, system-ui, sans-serif';
  let t = o.title; while(g.measureText(t).width > w - 220 && t.length > 4) t = t.slice(0, -2); g.fillText(t === o.title ? t : t + '…', 110, 540);
  g.fillStyle = 'rgba(255,255,255,.6)'; g.font = '500 30px Inter, system-ui, sans-serif'; g.fillText(o.sub || '', 110, 584);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const file = new File([blob], 'landlog.png', {type: 'image/png'});
  try{ if(navigator.canShare && navigator.canShare({files: [file]})){ await navigator.share({files: [file], title: o.title, text: `${o.title} on Landlog`, url: o.url}); return; } }catch(e){ if(e && e.name === 'AbortError') return; }
  try{ await navigator.clipboard.writeText(o.url); }catch(e){}
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'landlog-' + L.slug(o.title) + '.png'; a.click(); toast('Link copied and image saved.');
};
})();
