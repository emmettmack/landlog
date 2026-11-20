// Saves a dated JSON snapshot of the PUBLIC data (landlords, properties, visible reviews, aliases, owners).
// Hidden reviews, claims and analytics are not reachable with the public key; use Admin > Data > Download JSON for those.
//   node tools/backup.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = readFileSync(join(root, 'config.js'), 'utf8');
const url = cfg.match(/url:\s*'([^']+)'/)?.[1], key = cfg.match(/anonKey:\s*'([^']+)'/)?.[1];
if (!url || !key) { console.log('No database configured; nothing to back up.'); process.exit(0); }
const get = async t => { const r = await fetch(`${url}/rest/v1/${t}?select=*&limit=50000`, { headers: { apikey: key } }); if (!r.ok) throw new Error(t + ' ' + r.status); return r.json(); };
const out = { exported: new Date().toISOString(), note: 'Public data only.' };
for (const t of ['landlords', 'll_props', 'reviews', 'aliases', 'addr_owners']) out[t] = await get(t);
mkdirSync(join(root, 'backups'), { recursive: true });
const f = join(root, 'backups', new Date().toISOString().slice(0, 10) + '.json');
writeFileSync(f, JSON.stringify(out));
console.log('Saved', f, Object.fromEntries(Object.entries(out).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])));
