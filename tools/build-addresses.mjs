// Builds landlog/addresses.js: every residential parcel within RADIUS_MI of USC,
// plus LAHD housing-violation counts per parcel. Public data only. Node 18+.
//   node tools/build-addresses.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'addresses.js');
const CENTER = { lat: 34.0224, lon: -118.2851 };      // USC University Park campus
const RADIUS_MI = 1.5;
const ZIPS = ['90007', '90089', '90037', '90011', '90018', '90062', '90006', '90015', '90005', '90020', '90044', '90008'];

const PARCELS = 'https://public.gis.lacounty.gov/public/rest/services/LACounty_Cache/LACounty_Parcel/MapServer/0/query';
const LAHD = 'https://data.lacity.org/resource/cr8f-uc4j.json';

const miles = (lat, lon) => {
  const R = 3958.8, r = Math.PI / 180;
  const a = Math.sin((lat - CENTER.lat) * r / 2) ** 2 +
    Math.cos(CENTER.lat * r) * Math.cos(lat * r) * Math.sin((lon - CENTER.lon) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};
const title = s => s.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase())
  .replace(/\b(N|S|E|W|Nw|Ne|Sw|Se)\b/g, m => m.toUpperCase()).replace(/\b(\d+)(St|Nd|Rd|Th)\b/g, (_, n, s) => n + s.toLowerCase());

async function getJSON(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch {}
    await new Promise(r => setTimeout(r, 800 * (i + 1)));
  }
  throw new Error('failed: ' + url.slice(0, 120));
}

const parcels = new Map();
for (const zip of ZIPS) {
  for (let off = 0; ; off += 1000) {
    const q = new URLSearchParams({
      where: `SitusZIP LIKE '${zip}%' AND UseCode LIKE '0%' AND SitusHouseNo IS NOT NULL`,
      outFields: 'AIN,SitusHouseNo,SitusFraction,SitusDirection,SitusStreet,SitusZIP,UseCode,Units1,YearBuilt1,CENTER_LAT,CENTER_LON',
      returnGeometry: 'false', orderByFields: 'OBJECTID', resultOffset: off, resultRecordCount: 1000, f: 'json'
    });
    const d = await getJSON(PARCELS + '?' + q);
    const f = d.features || [];
    for (const { attributes: a } of f) {
      if (a.CENTER_LAT == null || miles(a.CENTER_LAT, a.CENTER_LON) > RADIUS_MI) continue;
      const num = String(a.SitusHouseNo).trim() + (a.SitusFraction ? ' ' + a.SitusFraction.trim() : '');
      const street = [a.SitusDirection, a.SitusStreet].filter(Boolean).join(' ').trim();
      const addr = title(`${num} ${street}`.replace(/\s+/g, ' '));
      parcels.set(a.AIN, [addr, a.SitusZIP.slice(0, 5), +a.CENTER_LAT.toFixed(5), +a.CENTER_LON.toFixed(5),
        a.Units1 || 1, a.YearBuilt1 || '', 0, 0]);
    }
    process.stderr.write(`parcels ${zip} +${off + f.length}  kept ${parcels.size}\n`);
    if (f.length < 1000 && !d.exceededTransferLimit) break;
  }
}

// Housing-violation cases per parcel (LAHD Systematic Code Enforcement).
const cases = new Map(); // ain -> Set(case ids)
const open = new Map();  // ain -> count of open violations
for (let off = 0; ; off += 50000) {
  const rows = await getJSON(`${LAHD}?$select=apn,criscase,violations_cleared&$limit=50000&$offset=${off}&$order=apn`);
  for (const r of rows) {
    if (!parcels.has(r.apn)) continue;
    (cases.get(r.apn) || cases.set(r.apn, new Set()).get(r.apn)).add(r.criscase);
    if (r.violations_cleared === '0') open.set(r.apn, (open.get(r.apn) || 0) + 1);
  }
  process.stderr.write(`lahd +${off + rows.length}\n`);
  if (rows.length < 50000) break;
}
for (const [ain, p] of parcels) { p[6] = cases.get(ain)?.size || 0; p[7] = open.get(ain) || 0; }

const rows = [...parcels.values()].sort((a, b) => a[0].localeCompare(b[0]));
const js = `// Public-record parcels near USC (LA County Assessor GIS) + LAHD violation counts. Generated ${new Date().toISOString().slice(0, 10)}.
// [address, zip, lat, lon, units, yearBuilt, violationCases, openViolations]
window.ADDRESSES=${JSON.stringify(rows)};\n`;
writeFileSync(OUT, js);
console.log(`wrote ${rows.length} addresses, ${[...cases.keys()].length} with violation cases, ${(js.length / 1e6).toFixed(2)} MB`);
