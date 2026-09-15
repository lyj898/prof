#!/usr/bin/env node
/**
 * Build the Kaprodi/Dekan channel list for the Nalar subscription campaign.
 *
 * Different audience and different ask from Nalar Creators: these people are asked to
 * CIRCULATE an offer, not to contribute material, so they are picked for the office they
 * hold rather than for research fit. The structural role lives in `title` ("Dekan",
 * "Wakil Dekan", "Ketua Jurusan/Prodi"); `notes` usually names the actual portfolio or
 * programme, which is what makes a personal opening line possible.
 *
 * Ranked by how directly the office touches students:
 *   1 Kaprodi        - owns one programme, knows its students, can mail them directly
 *   2 Wakil Dekan Kemahasiswaan - student affairs is literally the portfolio
 *   3 Wakil Dekan (other), Dekan - more senior, likelier to delegate or ignore
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';

const DIR = 'data/universities';
const SUPPRESSION = 'out/suppression.txt';

const suppressed = new Set();
if (existsSync(SUPPRESSION)) {
  for (const l of readFileSync(SUPPRESSION, 'utf8').split('\n')) {
    const e = l.trim().toLowerCase();
    if (e && !e.startsWith('#')) suppressed.add(e);
  }
} else {
  console.warn(`WARNING: ${SUPPRESSION} missing - cannot exclude already-contacted people.`);
}

// Role from `title` first (the structural field), then notes/department as a fallback.
const ROLE_PATTERNS = [
  [/ketua jurusan|ketua prodi|ketua program studi|kaprodi|kepala departemen|ketua departemen/i, 'Kaprodi'],
  [/wakil dekan|vice dean/i, 'Wakil Dekan'],
  [/\bdekan\b|\bdean\b/i, 'Dekan'],
];
const roleOf = (p) => {
  for (const field of ['title', 'notes', 'department']) {
    const v = String(p[field] ?? '');
    for (const [re, role] of ROLE_PATTERNS) if (re.test(v)) return { role, from: field };
  }
  return null;
};

// Wakil Dekan portfolios. Kemahasiswaan is student affairs - the one that matters here.
const portfolio = (notes) => {
  const n = String(notes ?? '');
  if (/kemahasiswaan|student affairs/i.test(n)) return 'kemahasiswaan';
  if (/akademik|academic/i.test(n)) return 'akademik';
  if (/sumber daya|resources|keuangan|umum/i.test(n)) return 'sumber daya';
  return '';
};

const PRIORITY = (role, port) =>
  role === 'Kaprodi' ? 1 : role === 'Wakil Dekan' && port === 'kemahasiswaan' ? 2
    : role === 'Wakil Dekan' ? 3 : 4;

// Credential-based, never gendered - no Bapak/Ibu. Same rule as the lecturer campaign.
const CRED = /^(Prof\.?\s*Dr\.?|Prof\.?|Dr\.?(?:\s*Ir\.?)?|drh\.|dr\.)\s*/i;
const greetingOf = (name) => {
  const clean = String(name).replace(/,.*$/, '').trim();
  const m = clean.match(CRED);
  const bare = clean.replace(CRED, '').trim();
  if (!m) return bare;
  const t = /prof/i.test(m[0]) ? 'Prof.' : 'Dr.';
  return `${t} ${bare}`;
};

const seen = new Map();
let scanned = 0, noEmail = 0, alreadyContacted = 0;
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
  let d;
  try { d = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')); } catch { continue; }
  const uni = d.university || d.name || f.replace(/\.json$/, '');
  const people = Array.isArray(d) ? d
    : (d.professors || d.people || d.faculty || Object.values(d).find(Array.isArray) || []);
  for (const p of people) {
    scanned++;
    const r = roleOf(p);
    if (!r) continue;
    const email = String(p.email ?? '').toLowerCase().trim();
    if (!email || !email.includes('@')) { noEmail++; continue; }
    if (suppressed.has(email)) { alreadyContacted++; continue; }
    if (seen.has(email)) continue;
    const port = portfolio(p.notes);
    seen.set(email, {
      email, name: p.name, greeting: greetingOf(p.name), role: r.role,
      role_source: r.from, portfolio: port, priority: PRIORITY(r.role, port),
      department: p.department ?? '', university: uni,
      notes: String(p.notes ?? '').replace(/\s+/g, ' ').slice(0, 200),
    });
  }
}

const rows = [...seen.values()].sort((a, b) =>
  a.priority - b.priority || a.university.localeCompare(b.university));
const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
const cols = ['email', 'greeting', 'name', 'role', 'portfolio', 'priority', 'department',
  'university', 'role_source', 'notes'];
writeFileSync('out/channel-targets.csv',
  cols.join(',') + '\n' + rows.map((r) => cols.map((c) => q(r[c] ?? '')).join(',')).join('\n') + '\n');

console.log(`scanned ${scanned} records`);
console.log(`skipped: ${noEmail} with no email, ${alreadyContacted} already contacted`);
console.log(`\nout/channel-targets.csv: ${rows.length} contacts at ${new Set(rows.map((r) => r.university)).size} universities\n`);
const t = (f) => [...rows.reduce((m, r) => m.set(r[f] || '(none)', (m.get(r[f] || '(none)') || 0) + 1), new Map())]
  .sort((a, b) => b[1] - a[1]);
console.log('by role:');
for (const [k, n] of t('role')) console.log(`  ${String(n).padStart(4)}  ${k}`);
console.log('\nby priority (1 = closest to students):');
for (const [k, n] of t('priority').sort()) console.log(`  ${String(n).padStart(4)}  P${k}`);
console.log('\nrole identified from:');
for (const [k, n] of t('role_source')) console.log(`  ${String(n).padStart(4)}  ${k}`);
