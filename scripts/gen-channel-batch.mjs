#!/usr/bin/env node
/**
 * Build a send batch for the Kaprodi/Dekan subscription probe from out/channel-targets.csv.
 *
 * Deliberately NOT gen-batch.mjs: that one selects on research fit and exists to keep
 * office-holders out. Here the office IS the selection criterion.
 *
 *   node scripts/gen-channel-batch.mjs --n=20 --batch=1
 *
 * Default is BILINGUAL: Bahasa first, English below a rule. A bilingual email reads as
 * institutional circular register rather than a personal note - wrong for the lecturer
 * campaign, right here, because the recipient is being asked to FORWARD it and what they
 * pass on should be readable by everyone downstream without them translating anything.
 * Bahasa leads because it is the recipient's language; the English half carries the
 * SGX/foreign-company framing that is part of the credibility.
 *
 * --lang=split keeps the old A/B behaviour if a single-language test is ever wanted.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const N = Number(arg('n', 20));
const BATCH = arg('batch', '1');
const DRY = process.argv.includes('--dry-run');
const LEDGER = 'out/channel-sent.json';

function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length === head.length && r[0])
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

// "Program Studi Desain Komunikasi Visual, Fakultas Seni Rupa dan Desain (FSRD)" is a
// programme inside a faculty; we want the programme, since that is what the recipient runs
// and what makes the opening line theirs rather than generic.
// A faculty is not a programme. "FKIP (S2 Pendidikan Bahasa Inggris)" and "Fakultas
// Kedokteran (Orthopaedi dan Traumatologi)" put the real programme inside the bracket, and
// "Fakultas Bahasa dan Seni - Pendidikan Bahasa Inggris" puts it after a dash - all three
// came out addressed to the faculty, which a Kaprodi would read as a form letter.
// Two patterns, not one: the words are matched case-insensitively (the data says
// "Fakultas"), but the acronym arm must stay case-SENSITIVE or every lowercase word
// three to six letters long would read as a faculty code.
const FACULTY_WORD = /^(fakultas|sekolah tinggi|sekolah|pascasarjana|program pascasarjana)(\s|$)/i;
const FACULTY_ACRONYM = /^[A-Z]{3,6}(\s|$)/;
const FACULTY = { test: (x) => FACULTY_WORD.test(String(x).trim()) || FACULTY_ACRONYM.test(String(x).trim()) };

function programme(department) {
  const d = String(department ?? '').trim();
  const named = d.match(/(?:program studi|prodi|departemen|jurusan)\s+([^,(]+)/i);
  let out;
  if (named) {
    out = named[1];
  } else {
    const paren = d.match(/^([^(]+)\(([^)]+)\)/);
    out = paren && FACULTY.test(paren[1].trim()) ? paren[2] : d.split(/[,(]/)[0];
    out = out.replace(/^fakultas\s+/i, '');
  }
  out = out.trim().replace(/\)+$/, '').trim();
  // Only split the dash when the source really did lead with a faculty - "Ilmu Komputer -
  // Sistem Informasi" is one programme's own name and must survive whole.
  const dash = out.split(/\s+-\s+/);
  if (dash.length === 2 && FACULTY.test(d)) out = dash[1].trim();
  // The slash usually separates alternatives, so the first half wins - except when that
  // half is only a degree level. "Sarjana Terapan/D4 Akuntansi" is one programme named
  // twice, and taking the first half yields "Sarjana Terapan", which names no subject at
  // all and would have been sent as the recipient's programme.
  const DEGREE_ONLY = /^(sarjana terapan|sarjana|magister|doktor|profesi|[SD][1-4])$/i;
  const halves = out.split(/\s*\/\s*/).map((x) => x.trim()).filter(Boolean);
  out = halves.length >= 2 && DEGREE_ONLY.test(halves[0]) ? halves[1] : halves[0];
  out = out.replace(/^program\s+(doktor|magister|sarjana|studi)\s+/i, '');
  return out.replace(/\s+/g, ' ').trim();
}


// A Kaprodi runs a programme; a Dekan and Wakil Dekan run a FACULTY. Addressing either of
// them as "Ketua Program Studi" names the wrong office to the one reader certain to notice,
// so the unit and every office word below are chosen from the role, not hard-coded.
// Prefer a faculty's own acronym when it has one - "Wakil Dekan FIABIKOM" is how that
// faculty is actually referred to, and the spelled-out name runs to nine words.
function faculty(department) {
  const d = String(department ?? '').trim();
  // ALL-CAPS only. A looser [A-Z][A-Za-z]+ matched "(Muamalah)" - a specialisation
  // name, not an acronym - and made a Dekan of Fakultas Syariah "Dekan Muamalah".
  const acronym = d.match(/\(([A-Z][A-Z0-9]{1,11})\)\s*$/);
  if (acronym) return acronym[1];
  const named = d.match(/(fakultas|sekolah tinggi|sekolah)\s+([^,(\/]+)/i);
  if (named) return (named[1] + ' ' + named[2]).replace(/\s+/g, ' ').trim();
  // A bare "Psikologi" is the programme's name; the office being addressed is the faculty,
  // so say so. ALL-CAPS acronyms are already faculty names and are left alone.
  const bare = d.split(/[,(\/]/)[0].replace(/\s+/g, ' ').trim();
  return /^[A-Z][A-Z0-9]{1,11}$/.test(bare) ? bare : `Fakultas ${bare}`;
}

// The `title` field's "Dekan"/"Wakil Dekan" is not trustworthy on its own. Batch 4 turned
// up a Wakil Direktur at a polytechnic (which has no Dekan at all) and a man who is now
// Wakil Rektor II and only FORMERLY in that faculty - both labelled "Wakil Dekan". Neither
// can be addressed correctly, and neither is the faculty-level channel this campaign is
// aimed at, so a note that names a different office disqualifies the row.
const WRONG_OFFICE = /wakil rektor|wakil direktur|rektor|direktur/i;
const officeContradicted = (r) => /dekan/i.test(String(r.role))
  && WRONG_OFFICE.test(String(r.notes ?? ''));

const ROLE = {
  Kaprodi:       { unit: (r) => programme(r.department), bm: 'Ketua Program Studi', unitBM: 'program studi', unitEN: 'programme',
                   en: 'Head of',      enRole: 'the head of' },
  'Wakil Dekan': { unit: (r) => faculty(r.department),   bm: 'Wakil Dekan',         unitBM: 'fakultas',      unitEN: 'faculty',
                   en: 'Vice Dean of', enRole: 'a vice dean of' },
  Dekan:         { unit: (r) => faculty(r.department),   bm: 'Dekan',               unitBM: 'fakultas',      unitEN: 'faculty',
                   en: 'Dean of',      enRole: 'dean of' },
};
const roleOf = (r) => ROLE[r.role] || ROLE.Kaprodi;

const rows = parseCSV(readFileSync('out/channel-targets.csv', 'utf8'));

// Anyone already sent to in THIS campaign. Its own ledger - the lecturer campaign's round
// files do not contain this audience, and the suppression list was applied at list-build.
const sent = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : {};
// The ledger is keyed BY EMAIL. It used to be keyed by university, which silently
// overwrote seven batch-1 records the moment the cooldown let batch 3 mail a second
// Kaprodi at the same institution - the exact case the cooldown was added to allow.
const already = new Set(Object.keys(sent).filter((k) => k !== '_note').map((k) => k.toLowerCase()));

// Universities used in the last COOLDOWN batches are skipped. One-per-university within a
// batch is not enough on its own: batch 2 came out with NINE universities that had been
// emailed the day before - a second near-identical bilingual note to a different Kaprodi at
// the same place, one day apart, is exactly what makes a personal email read as a mailmerge.
// The lecturer campaign learned this the same way and added the same guard.
const COOLDOWN = Number(arg('cooldown', 2));
const MAXPRIORITY = Number(arg('maxpriority', 4));
const cooling = new Set();
for (const [k, v] of Object.entries(sent)) {
  if (k === '_note' || !v || !v.batch || !v.university) continue;
  if (Number(BATCH) - Number(v.batch) < COOLDOWN) cooling.add(v.university);
}

const pool = rows
  .filter((r) => !already.has(r.email.toLowerCase()))
  .filter((r) => !cooling.has(r.university))
  // Priority is a FALLTHROUGH, not a filter. out/channel-targets.csv is already sorted by
  // it, so taking rows in file order spends Kaprodi first, then Wakil Dekan Kemahasiswaan,
  // then other Wakil Dekan, and only reaches Dekan when the better tiers cannot fill the
  // batch. Batch 4 is where that starts to bite: 22 Kaprodi remain but they sit at only 8
  // universities, and one-per-university is what actually binds. --maxpriority caps it.
  .filter((r) => Number(r.priority) <= MAXPRIORITY)
  .filter((r) => !officeContradicted(r))
  .filter((r) => roleOf(r).unit(r).length > 2);

// One per university, so no institution gets two of these in the same batch.
const picked = []; const unis = new Set();
for (const r of pool) {
  if (unis.has(r.university)) continue;
  unis.add(r.university); picked.push(r);
  if (picked.length === N) break;
}

// A greeting only counts as a greeting if it carries a credential. Bahasa formal register
// has no neutral bare-name opening - "Yth. <name>," reads abrupt - so anyone without a
// Prof./Dr. on file is addressed by office instead, which is warmer AND avoids the gender
// question entirely. English tolerates a bare name, so EN keeps it.
const hasCredential = (g) => /^(Prof\.|Dr\.)/i.test(String(g ?? '').trim());
// In a bilingual mail both halves must address the SAME person the same way, or it reads
// as two emails stapled together. With a credential that is automatic; without one Bahasa
// falls back to the office, so English mirrors it instead of reverting to a bare name.
const openEN = (r, prog, bilingual) => hasCredential(r.greeting) ? r.greeting
  : bilingual ? `${roleOf(r).en} ${prog}`
  : (r.greeting || `${roleOf(r).en} ${prog}`);
const openBM = (r, prog) => hasCredential(r.greeting) ? r.greeting
  : `${roleOf(r).bm} ${prog}`;

const EN = (r, prog, bilingual) => `Dear ${openEN(r, prog, bilingual)},

I'm Alex Low, CEO of Y Ventures Group Ltd, an SGX-listed company in Singapore. Nalar (nalar.tech) is our wholly owned subsidiary - a learning platform for Indonesian students.

We're opening Nalar to student subscriptions, and we're designing two things alongside it: a price a student can actually afford month to month, and a revenue share for lecturers who recommend it to their classes - paid monthly against a proper invoice, so it is documented rather than informal.

I'm writing to you as ${roleOf(r).enRole} ${prog} because I'd rather set those terms with input from someone who runs a ${roleOf(r).unitEN} than decide them in Singapore and hope. Before I send numbers, I wanted to ask whether this is a direction your ${roleOf(r).unitEN} would have any use for at all.

If it is, may I send you the details when they're settled?

If it isn't, telling me so is genuinely useful and I won't write again.`;

const BM = (r, prog) => `Yth. ${openBM(r, prog)},

Perkenalkan, saya Alex Low, CEO Y Ventures Group Ltd, perusahaan yang tercatat di Bursa Efek Singapura (SGX). Nalar (nalar.tech) adalah anak perusahaan kami sepenuhnya - sebuah platform pembelajaran untuk mahasiswa Indonesia.

Kami sedang membuka Nalar untuk langganan mahasiswa, dan bersamaan dengan itu kami sedang menyusun dua hal: harga yang benar-benar terjangkau bagi mahasiswa setiap bulan, serta bagi hasil bagi dosen yang merekomendasikannya kepada kelas mereka - dibayarkan setiap bulan disertai invoice resmi, sehingga tercatat dan tidak bersifat informal.

Saya menulis langsung kepada ${roleOf(r).bm} ${prog} karena kami lebih ingin menyusun skema ini dengan masukan dari pihak yang menjalankan ${roleOf(r).unitBM}, daripada menetapkannya sendiri dari Singapura. Sebelum kami mengirimkan angka-angkanya, saya ingin menanyakan lebih dahulu apakah arah seperti ini memang ada manfaatnya bagi ${roleOf(r).unitBM} tersebut.

Apabila ya, apakah kami dapat mengirimkan rinciannya setelah skema ini final?

Apabila tidak, kabar tersebut pun sangat berguna bagi kami, dan kami tidak akan menulis lagi.`;

const LANG = arg('lang', 'both');   // both | split
// Outlook autoformats a line that starts with "- " into a bullet list, and it ate "- - -"
// entirely on the first live send - the two halves ended up separated by a bare "-" that
// reads as a typo. Any punctuation-only divider is a trap here: ---, ***, ___ and === all
// become horizontal rules. Plain words in parentheses survive.
const DIVIDER = '(English version follows)';

const out = picked.map((r, i) => {
  const prog = roleOf(r).unit(r);   // programme for a Kaprodi, faculty for a Dekan
  const lang = LANG === 'split' ? (i % 2 === 0 ? 'EN' : 'BM') : 'BOTH';
  return {
    n: i + 1, lang, email: r.email, greeting: r.greeting, name: r.name, role: r.role,
    university: r.university, programme: prog,
    // One subject line, so it stays in the recipient's language even when the body is both.
    subject: lang === 'EN'
      ? `Nalar for your ${prog} students - and a question about how to structure it`
      : `Nalar untuk mahasiswa ${prog} - dan satu pertanyaan mengenai skemanya`,
    body: lang === 'BOTH' ? BM(r, prog) + '\n\n' + DIVIDER + '\n\n' + EN(r, prog, true)
      : lang === 'EN' ? EN(r, prog) : BM(r, prog),
  };
});

// Integrity, asserted rather than eyeballed.
const fail = [];
if (new Set(out.map((e) => e.email)).size !== out.length) fail.push('duplicate email');
if (new Set(out.map((e) => e.university)).size !== out.length) fail.push('duplicate university');
for (const e of out) {
  if (/\b(bapak|ibu)\b/i.test(e.body)) fail.push(`gendered form: ${e.email}`);
  if (!e.body.includes(e.programme)) fail.push(`programme missing from body: ${e.email}`);
  if (!/nalar\.tech/.test(e.body)) fail.push(`credibility anchor missing: ${e.email}`);
  if (/<|>|undefined|\bnull\b/.test(e.subject + e.body)) fail.push(`template leak: ${e.email}`);
  if (/\bRp\b|%/.test(e.body)) fail.push(`a number leaked into the probe: ${e.email}`);
  if (e.lang === 'BOTH') {
    if (!e.body.includes(DIVIDER)) fail.push(`divider missing: ${e.email}`);
    if (!e.body.startsWith('Yth.')) fail.push(`bilingual mail must open in Bahasa: ${e.email}`);
    if (!e.body.includes('Dear ')) fail.push(`English half missing: ${e.email}`);
    if ((e.body.match(/nalar\.tech/g) || []).length !== 2) fail.push(`a half lost the anchor: ${e.email}`);
  }
}
if (fail.length) { console.error('FAILED:\n  ' + fail.join('\n  ')); process.exit(1); }

if (!DRY) {
  writeFileSync(`out/channel-batch${BATCH}.json`, JSON.stringify(out, null, 1));
  writeFileSync(`out/channel-batch${BATCH}.md`, out.map((e) =>
    `## ${e.n}. ${e.greeting} — ${e.university} [${e.lang}]\n**To:** ${e.email}\n**Subject:** ${e.subject}\n\n${e.body}\n`).join('\n---\n\n'));
}
console.log(`${DRY ? 'DRY RUN - ' : ''}batch ${BATCH}: ${out.length} contacts, ${new Set(out.map((e) => e.university)).size} universities`);
console.log(`pool of uncontacted Kaprodi: ${pool.length} (${cooling.size} universities cooling down)
`);
console.log('#  lang  university                                   programme');
for (const e of out) console.log(`${String(e.n).padStart(2)}  ${e.lang}    ${e.university.slice(0, 42).padEnd(44)}${e.programme}`);
