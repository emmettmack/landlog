(function(){
'use strict';
document.documentElement.classList.add('js');

const $main = document.getElementById('main');
const store = {
  get(k, d){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const enc = encodeURIComponent;
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

/* ---------- data ---------- */
(function(){ const extra = store.get('landlog.props', {}); window.LANDLORDS.forEach(l => (extra[l.id]||[]).forEach(p => { if(!l.properties.includes(p)) l.properties.push(p); })); })();
function allLandlords(){ return window.LANDLORDS.concat(store.get('landlog.ll', [])); }
function allReviews(){
  const seed = window.REVIEWS.map((r,i) => ({id:'s'+i, ll:r[0], prop:r[1], year:r[2], overall:r[3], resp:r[4], repairs:r[5], deposit:r[6], again:r[7], tags:r[8], text:r[9], reply:r[10], date:r[2]+'-'+String(((i*5)%12)+1).padStart(2,'0'), mine:false}));
  const mine = store.get('landlog.rev', []).map(r => Object.assign({mine:true}, r));
  return seed.concat(mine);
}
const avg = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0;
function stats(ll){
  const rs = allReviews().filter(r => r.ll === ll.id);
  const n = rs.length;
  const dep = rs.filter(r => r.deposit !== 'living' && r.deposit !== 'na');
  return {
    n, rs,
    overall: avg(rs.map(r=>r.overall)),
    resp: avg(rs.map(r=>r.resp)),
    repairs: avg(rs.map(r=>r.repairs)),
    again: n ? Math.round(rs.filter(r=>r.again).length / n * 100) : 0,
    depFull: dep.length ? Math.round(dep.filter(r=>r.deposit==='full').length / dep.length * 100) : 0,
    dist: [5,4,3,2,1].map(k => rs.filter(r=>r.overall===k).length),
    tags: topTags(rs)
  };
}
function topTags(rs){
  const m = {}; rs.forEach(r => r.tags.forEach(t => m[t] = (m[t]||0)+1));
  return Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,5).map(e=>e[0]);
}
const propStats = (l, p) => { const rs = allReviews().filter(r => r.ll===l.id && r.prop===p); return {n:rs.length, overall:avg(rs.map(r=>r.overall)), rs}; };
const cls = v => v >= 4 ? 'good' : v >= 2.5 ? 'mid' : 'bad';
const fmt = v => (Math.round(v*10)/10).toFixed(1);
const tile = (v, size='') => `<span class="tile ${size} ${v ? cls(v) : ''}" aria-label="${v ? fmt(v)+' out of 5' : 'No ratings'}">${v ? fmt(v) : '–'}</span>`;
const depositLabel = {full:'Returned in full', partial:'Partly returned', withheld:'Withheld', living:'Still living here', na:'Not applicable'};
const getLL = id => allLandlords().find(l => l.id === id);
const propHref = (l, p) => `#/landlord/${l.id}?p=${enc(p)}`;

/* ---------- address-aware search ---------- */
const ABBR = {st:'street',ave:'avenue',av:'avenue',blvd:'boulevard',rd:'road',dr:'drive',ln:'lane',pkwy:'parkway',ter:'terrace',terr:'terrace',ct:'court',pl:'place',hwy:'highway',apt:'',unit:'',ste:'',suite:'',no:''};
const norm = s => String(s).toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(Boolean).map(t => ABBR[t] !== undefined ? ABBR[t] : t).filter(Boolean);
function matchAll(qt, targets){
  let s = 0;
  for(let i = 0; i < qt.length; i++){
    const t = qt[i], last = i === qt.length-1;
    const num = /^\d+$/.test(t);
    const hit = targets.some(x => num ? (last ? x.startsWith(t) : x === t) : x.startsWith(t));
    if(!hit) return 0;
    s += targets.includes(t) ? 3 : 1;
  }
  return s;
}
function find(q){
  const qt = norm(q);
  const out = {props:[], lls:[], qt};
  if(!qt.length) return out;
  allLandlords().forEach(l => {
    const nameT = norm(l.name), cityT = norm(l.city+' '+l.state);
    const ls = matchAll(qt, nameT.concat(cityT));
    if(ls) out.lls.push({l, score: ls});
    l.properties.forEach(p => {
      const at = norm(p);
      const s = matchAll(qt, at.concat(cityT, nameT));
      if(s) out.props.push({l, p, score: s + (matchAll(qt, at) ? 4 : 0)});
    });
  });
  out.props.sort((a,b) => b.score - a.score);
  out.lls.sort((a,b) => b.score - a.score);
  return out;
}
function go(q){
  q = (q||'').trim();
  if(!q){ location.hash = '#/search?q='; return; }
  const r = find(q), hasNum = /\d/.test(q);
  if(r.props.length && hasNum && (r.props.length === 1 || r.props[0].score > r.props[1].score)) { location.hash = propHref(r.props[0].l, r.props[0].p); return; }
  if(r.props.length === 1 && !r.lls.length){ location.hash = propHref(r.props[0].l, r.props[0].p); return; }
  if(!hasNum && r.lls.length === 1 && r.props.every(x => x.l.id === r.lls[0].l.id)){ location.hash = '#/landlord/' + r.lls[0].l.id; return; }
  location.hash = '#/search?q=' + enc(q);
}

/* omnibox: live suggestions on any input inside .omni-wrap */
function mountOmni(input){
  const wrap = input.closest('.omni-wrap');
  if(!wrap) return;
  const list = document.createElement('ul');
  list.className = 'omni'; list.hidden = true; list.setAttribute('role','listbox');
  list.id = 'omni-' + Math.random().toString(36).slice(2,7);
  wrap.appendChild(list);
  input.setAttribute('role','combobox'); input.setAttribute('aria-autocomplete','list');
  input.setAttribute('aria-controls', list.id); input.setAttribute('aria-expanded','false');
  let items = [], active = -1;
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded','false'); active = -1; };
  const setActive = i => {
    active = i;
    [...list.children].forEach((li, k) => li.classList.toggle('on', k === i));
    if(i >= 0) input.setAttribute('aria-activedescendant', list.children[i].id); else input.removeAttribute('aria-activedescendant');
  };
  const render = () => {
    const q = input.value.trim();
    if(!q){ close(); return; }
    const r = find(q);
    items = r.props.slice(0,4).map(x => ({href: propHref(x.l, x.p), kind:'Address', title: x.p, sub: `${x.l.name} · ${x.l.city}, ${x.l.state}`, v: propStats(x.l, x.p).overall || stats(x.l).overall}))
      .concat(r.lls.slice(0,3).map(x => ({href:'#/landlord/'+x.l.id, kind:'Landlord', title:x.l.name, sub:`${x.l.type} · ${x.l.city}, ${x.l.state}`, v: stats(x.l).overall})));
    if(!r.props.length && /\d/.test(q)) items.push({href:'#/rate?addr='+enc(q), kind:'New', title:`No ratings for “${q}” yet`, sub:'Be the first to rate this address', v:0, plus:true});
    list.innerHTML = items.length ? items.map((it,i) => `<li role="option" id="${list.id}-${i}" data-i="${i}"><span class="omni-k">${it.kind}</span><span class="omni-t"><b>${esc(it.title)}</b><small>${esc(it.sub)}</small></span>${it.plus ? '<span class="omni-plus">+</span>' : tile(it.v,'sm')}</li>`).join('') : `<li class="omni-empty">No matches. Try a street address or a name.</li>`;
    list.hidden = false; input.setAttribute('aria-expanded','true'); active = -1;
  };
  input.addEventListener('input', render);
  input.addEventListener('focus', render);
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
  form.addEventListener('submit', e => { e.preventDefault(); input.blur(); go(input.value); });
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
  const row = x => `<a class="row" href="#/landlord/${x.l.id}">${tile(x.s.overall,'sm')}<span><span class="row-name">${esc(x.l.name)}</span><br><span class="row-sub">${esc(x.l.city)}, ${esc(x.l.state)}</span></span><span class="row-n">${x.s.n} ratings</span></a>`;
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
        <span>Try</span>
        <a class="chip" href="${propHref(exA.l, exA.l.properties[0])}">${esc(exA.l.properties[0])}</a>
        <a class="chip" href="${propHref(exB.l, exB.l.properties[0])}">${esc(exB.l.properties[0])}</a>
        <a class="chip" href="#/landlord/${exA.l.id}">${esc(exA.l.name)}</a>
      </div>
    </div>
  </section>

  <section class="slab">
    <div class="slab-in">
      <h2 class="h2 wide rv">Who tenants are warning each other about.</h2>
      <div class="boards">
        <div class="board rv"><h3>Lowest rated</h3><p class="note">Read before you tour.</p>${worst.map(row).join('')}</div>
        <div class="board rv" style="--i:1"><h3>Highest rated</h3><p class="note">What a good landlord looks like.</p>${best.map(row).join('')}</div>
      </div>
    </div>
  </section>

  <section class="slab">
    <div class="slab-in">
      <h2 class="h2 wide rv">One search box. No country, state or city to click through.</h2>
      <div class="claims">
        <div class="claim rv"><h3>Paste the address from the listing.</h3><p>We match it to the property and show who owns it, straight away.</p></div>
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
        <p style="margin-top:32px"><a class="pill pill-blue" href="#/rate">Rate a landlord</a></p>
      </div>
    </div>
  </section>`;
}

function search(q){
  q = (q||'').trim();
  const r = find(q);
  const browse = !q;
  let body = '';
  const propCard = x => { const ps = propStats(x.l, x.p), ls = stats(x.l); return `<a class="result rv" href="${propHref(x.l, x.p)}">${tile(ps.overall,'lg')}<div><h2>${esc(x.p)}</h2><p class="meta">${esc(x.l.name)} · ${esc(x.l.city)}, ${esc(x.l.state)}</p></div><div class="stat"><b>${ps.n}</b><span>At this address</span></div><div class="stat"><b>${ls.n ? fmt(ls.overall) : '–'}</b><span>Landlord overall</span></div></a>`; };
  const llCard = x => { const s = stats(x.l); return `<a class="result rv" href="#/landlord/${x.l.id}">${tile(s.overall,'lg')}<div><h2>${esc(x.l.name)}</h2><p class="meta">${esc(x.l.type)} · ${esc(x.l.city)}, ${esc(x.l.state)}</p></div><div class="stat"><b>${s.n ? s.again+'%' : '–'}</b><span>Would rent again</span></div><div class="stat"><b>${s.n}</b><span>Ratings</span></div></a>`; };
  if(browse){
    const list = allLandlords().map(l => ({l, s: stats(l)}));
    list.sort((a,b) => state.sort==='low' ? a.s.overall-b.s.overall : state.sort==='most' ? b.s.n-a.s.n : b.s.overall-a.s.overall);
    body = `<div class="filters" role="group" aria-label="Sort">${[['high','Highest rated'],['low','Lowest rated'],['most','Most ratings']].map(([k,t]) => `<button class="chip" data-sort="${k}" aria-pressed="${state.sort===k}">${t}</button>`).join('')}</div>
      <div class="results">${list.map(x => llCard(x)).join('')}</div>`;
  } else if(!r.props.length && !r.lls.length){
    const hasNum = /\d/.test(q);
    body = `<div class="empty rv"><h2>Nothing for “${esc(q)}” yet.</h2><p>${hasNum ? 'No one has rated this address. Be the first and warn the next tenant.' : 'Try a street address, a landlord’s name or a company.'}</p><a class="pill pill-blue" href="#/rate${hasNum ? '?addr='+enc(q) : ''}">${hasNum ? 'Rate this address' : 'Rate a landlord'}</a></div>`;
  } else {
    if(r.props.length) body += `<h2 class="sec">Addresses</h2><div class="results">${r.props.slice(0,12).map(propCard).join('')}</div>`;
    if(r.lls.length) body += `<h2 class="sec">Landlords</h2><div class="results">${r.lls.slice(0,8).map(llCard).join('')}</div>`;
  }
  return `
  <section class="page">
    <h1 class="rv">${browse ? 'All landlords' : 'Results for “'+esc(q)+'”'}</h1>
    <div class="omni-wrap rv page-search" style="--i:1">
      <form class="hero-search" id="pageSearch" autocomplete="off" role="search">
        <label class="sr" for="pageQ">Search</label>
        <input id="pageQ" type="search" value="${esc(q)}" placeholder="Address, landlord or company" enterkeyhint="search">
        <button class="pill pill-blue" type="submit">Look up</button>
      </form>
    </div>
    ${body}
  </section>`;
}

function landlord(id){
  const l = getLL(id);
  if(!l) return notFound();
  const s = stats(l);
  const votes = store.get('landlog.votes', {});
  const flags = store.get('landlog.flags', {});
  const total = s.n || 1;
  const labels = ['Awesome','Great','Good','OK','Awful'];
  let rs = s.rs.slice();
  const filtered = state.prop !== 'all' && l.properties.includes(state.prop);
  if(!filtered) state.prop = 'all';
  if(filtered) rs = rs.filter(r => r.prop === state.prop);
  if(state.rsort === 'low') rs.sort((a,b)=>a.overall-b.overall);
  else if(state.rsort === 'high') rs.sort((a,b)=>b.overall-a.overall);
  else rs.sort((a,b)=> (b.mine-a.mine) || String(b.date).localeCompare(String(a.date)));
  const ps = filtered ? propStats(l, state.prop) : null;
  const rateHref = `#/rate/${l.id}${filtered ? '?addr='+enc(state.prop) : ''}`;
  const review = r => `
    <article class="rev rv" id="r-${r.id}">
      <div class="score-col">
        <div><div class="lab">Overall</div>${tile(r.overall)}</div>
        <div><div class="lab">Repairs</div>${tile(r.repairs)}</div>
      </div>
      <div>
        <div class="rev-top"><h3>${esc(r.prop)}${r.mine?'<span class="you">You</span>':''}</h3><time>${r.mine ? new Date(r.date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : 'Lived there '+r.year}</time></div>
        <div class="facts"><span>Responsiveness: <b>${r.resp}/5</b></span><span>Deposit: <b>${depositLabel[r.deposit]}</b></span><span>Would rent again: <b>${r.again?'Yes':'No'}</b></span></div>
        <p class="text">${esc(r.text)}</p>
        ${r.tags.length ? `<div class="tags">${r.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
        ${r.reply ? `<div class="reply"><b>Landlord response</b>${esc(r.reply)}</div>` : ''}
        <div class="rev-foot">
          <span style="font-weight:600;font-size:14px">Helpful</span>
          <button class="vote" data-vote="${r.id}" aria-pressed="${!!votes[r.id]}" aria-label="Mark helpful"><svg viewBox="0 0 24 24"><path d="M7 11v9H4v-9zM7 11l4-8c1.5 0 2.5 1 2 3l-.7 3H19a2 2 0 0 1 2 2.4l-1.3 6A2 2 0 0 1 17.7 20H7"/></svg><span>${(votes[r.id]?1:0) + (r.id.charCodeAt(1)*3 % 11)}</span></button>
          <span class="grow"></span>
          <button class="flag" data-flag="${r.id}" aria-label="Report this review">${flags[r.id] ? 'Reported' : '<svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h12l-2 4 2 4H5"/></svg>'}</button>
        </div>
      </div>
    </article>`;
  const strip = filtered ? `
    <div class="addr rv">
      <div class="addr-main">${tile(ps.overall,'lg')}<div><p class="addr-k">This address</p><h2>${esc(state.prop)}</h2><p class="addr-s">${esc(l.city)}, ${esc(l.state)} · ${ps.n ? ps.n+' '+(ps.n===1?'rating':'ratings')+' here' : 'No ratings here yet'}</p></div></div>
      <div class="addr-act"><a class="pill pill-blue pill-sm" href="${rateHref}">Rate this address</a><button class="pill pill-out pill-sm" id="allProps" type="button">All properties</button></div>
    </div>` : '';
  const heading = filtered ? `${rs.length} ${rs.length===1?'rating':'ratings'} at this address` : `${s.n} tenant ${s.n===1?'rating':'ratings'}`;
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
        <p class="basedon rv" style="--i:1">Landlord overall, based on <u>${s.n} ${s.n===1?'rating':'ratings'}</u></p>
        <h1 class="rv" style="--i:2">${esc(l.name)}</h1>
        <p class="where rv" style="--i:3">${esc(l.type)} in ${esc(l.city)}, ${esc(l.state)}</p>
        <div class="stats rv" style="--i:4">
          <div><b>${s.n ? s.again+'%' : '–'}</b><span>Would rent again</span></div>
          <div><b>${s.n ? s.depFull+'%' : '–'}</b><span>Deposit returned in full</span></div>
        </div>
        <div class="actions rv" style="--i:5">
          <a class="pill pill-blue" href="${rateHref}">Rate <span aria-hidden="true">→</span></a>
          <button class="pill pill-out" id="shareBtn" type="button">Share</button>
        </div>
      </div>
      <div>
        <div class="panel rv">
          <h2>Rating distribution</h2>
          <div class="dist-wrap" id="distWrap">
            ${s.dist.map((c,i)=>`<div class="dist"><span>${labels[i]} <b>${5-i}</b></span><div class="bar-t"><div class="bar-f" style="width:${Math.round(c/total*100)}%"></div></div><b class="n">${c}</b></div>`).join('')}
          </div>
          <div class="mini"><div><b>${s.n?fmt(s.resp):'–'}</b><span>Responsiveness</span></div><div><b>${s.n?fmt(s.repairs):'–'}</b><span>Repairs</span></div><div><b>${l.properties.length}</b><span>${l.properties.length===1?'Property':'Properties'}</span></div></div>
        </div>
        ${s.tags.length ? `<div class="panel panel-tint rv" style="--i:1"><h2>What tenants mention most</h2><div class="tags-top">${s.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div></div>` : ''}
        <div class="panel rv" style="--i:2"><h2>Properties</h2><div class="props">${l.properties.map(p => { const c = propStats(l, p); return `<a href="${propHref(l,p)}" data-p="${esc(p)}" class="${filtered && state.prop===p ? 'cur' : ''}"><span>${esc(p)}</span><b>${c.n ? fmt(c.overall)+' · '+c.n : 'No ratings'}</b></a>`; }).join('')}</div></div>
      </div>
    </div>

    <div class="reviews-head">
      <h2 class="rv">${heading}</h2>
      <div class="controls">
        <label class="sr" for="propSel">Filter by property</label>
        <select class="sel" id="propSel"><option value="all">All properties</option>${l.properties.map(p=>`<option ${state.prop===p?'selected':''}>${esc(p)}</option>`).join('')}</select>
        <label class="sr" for="rsortSel">Sort</label>
        <select class="sel" id="rsortSel">${[['new','Most recent'],['low','Lowest first'],['high','Highest first']].map(([k,t])=>`<option value="${k}" ${state.rsort===k?'selected':''}>${t}</option>`).join('')}</select>
      </div>
    </div>
    <div class="rev-grid"><div class="rev-list">${rs.length ? rs.map(review).join('') : '<div class="empty"><h2>No ratings here yet.</h2><p>Lived at this property? Say so.</p><a class="pill pill-blue" href="'+rateHref+'">Rate this address</a></div>'}</div>
    <aside class="side"><div class="side-in"><h3>Lived at one of these?</h3><p>Your rating is the only thing a landlord can’t edit. It takes two minutes.</p><a class="pill pill-blue" href="${rateHref}">Write a review</a><ul>${l.properties.map(p=>`<li>${esc(p)}</li>`).join('')}</ul></div></aside></div>
  </section>`;
}

function rate(id, params){
  const lls = allLandlords();
  const l = id ? getLL(id) : null;
  const addr = params.get('addr') || '';
  const scale = (name) => `<div class="scale" role="radiogroup">${[1,2,3,4,5].map(n=>`<input type="radio" name="${name}" id="${name}${n}" value="${n}" required><label class="s${n}" for="${name}${n}">${n}</label>`).join('')}</div><div class="scale-ends"><span>Awful</span><span>Awesome</span></div>`;
  return `
  <section class="page">
    <div class="form-wrap">
      <div>
        <h1 class="rv">Rate your landlord.</h1>
        <p class="lede rv" style="--i:1">Two minutes. Be specific, be fair, stick to what happened.</p>
        <p style="margin-top:28px"><a href="#/guidelines" style="font-weight:600;text-underline-offset:3px">Review guidelines</a></p>
      </div>
      <form class="form f rv" id="rateForm" novalidate style="--i:1">
        <div>
          <label for="prop">Property address</label>
          <input class="in" id="prop" name="prop" list="propList" maxlength="100" placeholder="Street address" value="${esc(addr)}" required>
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
          <div><label for="newCity">City, state</label><input class="in" id="newCity" maxlength="60" placeholder="Los Angeles, CA"></div>
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
          <textarea class="in" id="text" name="text" maxlength="1000" placeholder="What was it actually like? Mention repairs, notice before entry, rent changes, how your deposit was handled." required></textarea>
        </div>
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
    <h2>Landlords can respond</h2><p>A management response appears under the review it answers. It never replaces the review.</p>
    <h2>Report problems</h2><p>Every review has a report button. Reviews that break these rules are removed.</p>
  </div></section>`;
}
function notFound(){ return `<section class="page"><h1>Not found.</h1><p class="count">That page does not exist. <a href="#/">Go home</a>.</p></section>`; }

/* ---------- router ---------- */
const state = { sort:'high', prop:'all', rsort:'new' };
let cleanup = null;

function route(){
  if(cleanup){ cleanup(); cleanup = null; }
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = hash.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(qs||'');
  let html, after;
  if(!parts.length){ html = home(); after = bindHome; document.title = 'Landlog – Type the address. Know the landlord.'; }
  else if(parts[0]==='search'){ const q = params.get('q'); html = search(q); after = () => bindSearch(q); document.title = (q ? q+' – ' : '') + 'Search – Landlog'; }
  else if(parts[0]==='landlord'){ state.prop = params.get('p') || 'all'; state.rsort = 'new'; html = landlord(parts[1]); after = () => bindLandlord(parts[1]); const l = getLL(parts[1]); document.title = (l ? l.name : 'Not found') + ' – Landlog'; }
  else if(parts[0]==='rate'){ html = rate(parts[1], params); after = bindRate; document.title = 'Rate a landlord – Landlog'; }
  else if(parts[0]==='guidelines'){ html = guidelines(); document.title = 'Review guidelines – Landlog'; }
  else { html = notFound(); }
  $main.innerHTML = html;
  document.documentElement.style.scrollBehavior = 'auto';
  window.scrollTo(0,0);
  document.documentElement.style.scrollBehavior = '';
  if(after) after();
  reveal();
}

function reveal(){
  const els = $main.querySelectorAll('.rv, .dist-wrap');
  if(!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches){
    els.forEach(e => e.classList.add('shown'));
    $main.querySelectorAll('.dist').forEach(e => e.classList.add('shown'));
    return;
  }
  const io = new IntersectionObserver(es => es.forEach(e => {
    if(e.isIntersecting){ e.target.classList.add('shown'); if(e.target.classList.contains('dist-wrap')) e.target.querySelectorAll('.dist').forEach(d=>d.classList.add('shown')); io.unobserve(e.target); }
  }), {threshold:.12, rootMargin:'0px 0px -6% 0px'});
  els.forEach(e => io.observe(e));
  const prev = cleanup; cleanup = () => { io.disconnect(); prev && prev(); };
}

/* ---------- bindings ---------- */
function bindHome(){
  const input = document.getElementById('heroQ');
  bindSearchForm(document.getElementById('heroSearch'), input);
  if(matchMedia('(hover:hover)').matches) setTimeout(() => input.focus({preventScroll:true}), 250);
}
function bindSearch(q){
  bindSearchForm(document.getElementById('pageSearch'), document.getElementById('pageQ'));
  $main.querySelectorAll('[data-sort]').forEach(b => b.addEventListener('click', () => { state.sort = b.dataset.sort; $main.innerHTML = search(q); bindSearch(q); $main.querySelectorAll('.rv').forEach(e=>e.classList.add('shown')); }));
}
function bindLandlord(id){
  const rerender = () => { const y = scrollY; $main.innerHTML = landlord(id); bindLandlord(id); $main.querySelectorAll('.rv,.dist').forEach(e=>e.classList.add('shown')); scrollTo(0,y); };
  document.getElementById('propSel').addEventListener('change', e => { state.prop = e.target.value; history.replaceState(null,'', state.prop==='all' ? '#/landlord/'+id : '#/landlord/'+id+'?p='+enc(state.prop)); rerender(); });
  document.getElementById('rsortSel').addEventListener('change', e => { state.rsort = e.target.value; rerender(); });
  const all = document.getElementById('allProps');
  if(all) all.addEventListener('click', () => { state.prop = 'all'; history.replaceState(null,'','#/landlord/'+id); rerender(); });
  $main.querySelectorAll('.props a').forEach(a => a.addEventListener('click', e => { e.preventDefault(); state.prop = a.dataset.p; history.replaceState(null,'', a.getAttribute('href')); rerender(); scrollTo(0,0); }));
  $main.querySelectorAll('[data-vote]').forEach(b => b.addEventListener('click', () => {
    const v = store.get('landlog.votes', {}); if(v[b.dataset.vote]) delete v[b.dataset.vote]; else v[b.dataset.vote] = 1; store.set('landlog.votes', v); rerender();
  }));
  $main.querySelectorAll('[data-flag]').forEach(b => b.addEventListener('click', () => {
    const f = store.get('landlog.flags', {}); f[b.dataset.flag] = 1; store.set('landlog.flags', f); rerender();
  }));
  const share = document.getElementById('shareBtn');
  share.addEventListener('click', async () => {
    try{ await navigator.clipboard.writeText(location.href); share.textContent = 'Link copied'; }catch(e){ share.textContent = 'Copy the address bar'; }
    setTimeout(() => share.textContent = 'Share', 1800);
  });
  const cond = document.getElementById('cond'), head = document.getElementById('llHead');
  const onScroll = () => { const on = head.getBoundingClientRect().bottom < 64; cond.classList.toggle('on', on); cond.setAttribute('aria-hidden', String(!on)); cond.querySelectorAll('a').forEach(a => a.tabIndex = on ? 0 : -1); };
  addEventListener('scroll', onScroll, {passive:true}); onScroll();
  cleanup = () => removeEventListener('scroll', onScroll);
}
function bindRate(){
  const form = document.getElementById('rateForm'), sel = document.getElementById('llSel'), nl = document.getElementById('newLL'), err = document.getElementById('err');
  const prop = document.getElementById('prop'), note = document.getElementById('autoNote');
  const sync = () => nl.classList.toggle('hidden', sel.value !== '__new');
  sel.addEventListener('change', () => { sync(); note.hidden = true; }); sync();
  // typing a known address picks its landlord automatically
  const autoPick = () => {
    const pt = norm(prop.value).join(' ');
    if(!pt) return;
    for(const l of allLandlords()){
      const p = l.properties.find(x => norm(x).join(' ') === pt);
      if(p){ sel.value = l.id; sync(); note.hidden = false; note.textContent = 'We already know this address. Landlord filled in for you.'; return; }
    }
  };
  prop.addEventListener('input', autoPick); prop.addEventListener('change', autoPick); autoPick();
  const text = document.getElementById('text'), cc = document.getElementById('cc');
  text.addEventListener('input', () => cc.textContent = text.value.length + ' / 1000');
  form.querySelectorAll('input[name=tag]').forEach(c => c.addEventListener('change', () => {
    if(form.querySelectorAll('input[name=tag]:checked').length > 3) c.checked = false;
  }));
  form.addEventListener('submit', e => {
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
    if(body.length < 20) return fail('Write at least a couple of sentences (20 characters).');
    if(llId === '__new'){
      const name = document.getElementById('newName').value.trim(), cityRaw = document.getElementById('newCity').value.trim();
      if(!name || !cityRaw) return fail('Add the landlord’s name and city.');
      const [city, state2] = cityRaw.split(',').map(s => s.trim());
      llId = 'u-' + slug(name) + '-' + Date.now().toString(36);
      const mine = store.get('landlog.ll', []);
      mine.push({id:llId, name, type:'Added by a tenant', city:city||cityRaw, state:state2||'', properties:[]});
      store.set('landlog.ll', mine);
    }
    const rev = {id:'u'+Date.now().toString(36), ll:llId, prop:addr, year:fd.get('year'), overall:+fd.get('overall'), resp:+fd.get('resp'), repairs:+fd.get('repairs'), deposit:fd.get('deposit'), again:fd.get('again')==='1', tags:fd.getAll('tag'), text:body, reply:null, date:new Date().toISOString()};
    const mine = store.get('landlog.rev', []); mine.push(rev); store.set('landlog.rev', mine);
    const ll = getLL(llId);
    if(ll && !ll.properties.includes(addr)){
      if(llId.startsWith('u-')){ const arr = store.get('landlog.ll', []); const t = arr.find(x=>x.id===llId); if(t){ t.properties.push(addr); store.set('landlog.ll', arr); } }
      else { const extra = store.get('landlog.props', {}); (extra[llId] = extra[llId]||[]).push(addr); store.set('landlog.props', extra); ll.properties.push(addr); }
    }
    location.hash = '#/landlord/' + llId + '?p=' + enc(addr);
  });
}

/* ---------- global ---------- */
const barQ = document.getElementById('barQ');
bindSearchForm(document.getElementById('barSearch'), barQ);
document.addEventListener('keydown', e => {
  if(e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)){
    e.preventDefault();
    (document.getElementById('heroQ') || document.getElementById('pageQ') || barQ).focus();
  }
});
window.addEventListener('hashchange', route);
route();
})();
