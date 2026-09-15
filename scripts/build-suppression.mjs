import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

// Bounces we can attribute to a specific address with certainty. The campaign memory
// records bounce COUNTS in prose but names only these four, so everything else in the
// lecturer campaign is marked unknown rather than guessed at.
const LECTURER_BOUNCES = new Set(['ayu@stei.itb.ac.id', 'yuliustiranda@ikestmp.ac.id',
  'mwahyuddin.abdullah@uin-alauddin.ac.id', 'fransiskus_randa@uajm.ac.id']);

const rows = [];

// ---- campaign 1: Nalar Creators, individual lecturers -------------------------
const order = (f) => f.startsWith('test') ? 0 : Number(f.match(/\d+/)[0]);
const files = readdirSync('out').filter((f) => /^(round\d+|test)-emails\.json$/.test(f))
  .sort((a, b) => order(a) - order(b));
for (const f of files) {
  const d = JSON.parse(readFileSync('out/' + f, 'utf8'));
  const batch = f.replace('-emails.json', '');
  for (const r of (Array.isArray(d) ? d : d.emails || [])) {
    const email = String(r.email || '').toLowerCase().trim();
    if (!email) continue;
    rows.push({ email, campaign: 'nalar-creators', batch,
      name: r.greeting || r.full_name || '', role: r.title || '',
      institution: r.uni || r.company_name || r.university || '',
      delivery: LECTURER_BOUNCES.has(email) ? 'bounced' : 'unknown' });
  }
}

// ---- campaign 2: UKMPPD buyer test, institutional addresses -------------------
const uk = JSON.parse(readFileSync('out/ukmppd-sent.json', 'utf8'));
for (const [uni, v] of Object.entries(uk)) {
  if (uni === '_note') continue;
  const email = String(v.to || '').toLowerCase().trim();
  if (!email) continue;
  rows.push({ email, campaign: 'ukmppd-buyer-test', batch: v.wave || '',
    name: '', role: 'faculty/institutional address', institution: uni,
    delivery: /^BOUNCED/.test(String(v.status)) ? 'bounced' : 'delivered' });
}

// ---- dedupe -------------------------------------------------------------------
const seen = new Map();
const dupes = [];
for (const r of rows) {
  if (seen.has(r.email)) { dupes.push(r.email); continue; }
  seen.set(r.email, r);
}
const out = [...seen.values()];

const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
const cols = ['email', 'campaign', 'batch', 'name', 'role', 'institution', 'delivery'];
writeFileSync('out/contacted-all.csv',
  cols.join(',') + '\n' + out.map((r) => cols.map((c) => q(r[c] ?? '')).join(',')).join('\n') + '\n');
writeFileSync('out/suppression.txt', out.map((r) => r.email).sort().join('\n') + '\n');

const by = (f) => [...out.reduce((m, r) => m.set(r[f], (m.get(f === 'campaign' ? r[f] : r[f]) || 0) + 1), new Map())];
console.log('rows collected      :', rows.length);
console.log('duplicate addresses :', dupes.length, dupes.length ? '(' + [...new Set(dupes)].join(', ') + ')' : '');
console.log('unique suppressed   :', out.length);
console.log('\nby campaign:');
for (const [k, n] of by('campaign')) console.log('  ' + String(n).padStart(4) + '  ' + k);
console.log('\nby delivery:');
for (const [k, n] of by('delivery')) console.log('  ' + String(n).padStart(4) + '  ' + k);
const unis = new Set(out.map((r) => r.institution).filter(Boolean));
console.log('\ndistinct institutions touched:', unis.size);
const domains = new Set(out.map((r) => r.email.split('@')[1]));
console.log('distinct email domains      :', domains.size);
