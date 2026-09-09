#!/usr/bin/env node
/**
 * Generate the next hand-send batch from out/tier1.csv.
 *
 * Excludes everyone already contacted and every DEPARTMENT already used. Department
 * rather than university: tier 1 is only 123 universities and badly skewed (UGM alone
 * is 272 of 1,500 rows), so excluding whole universities locked out 90% of the list
 * after just 50 sends. Two near-identical notes inside one department is the thing that
 * makes a personal email look automated; a law lecturer and, weeks later, a nursing
 * lecturer at the same large university is not a detectable pattern.
 *
 * Quotas keep each academic title accumulating toward the ~8-10 replies needed to
 * separate the segments, and DISCIPLINE_CAP stops a batch going single-subject - the
 * fit scoring weights business fields at 20, so an uncapped score-sorted batch comes
 * out 90% management/accounting and confounds title with field.
 *
 *   node scripts/gen-batch.mjs --n=10 --round=4
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const N = Number(arg('n', 10));
const ROUND = arg('round', '4');

// Title quotas. Dosen and Guru Besar are both converting; Lektor Kepala broke its
// zero with its first responder; Lektor is still 0/7 and needs more shots to judge.
const QUOTAS = { Dosen: 3, 'Guru Besar': 3, 'Lektor Kepala': 2, Lektor: 2 };

// Max sends per subject area per batch, so no batch is single-discipline.
const DISCIPLINE_CAP = Number(arg('cap', 3));

// Universities touched in the last COOLDOWN batches are skipped entirely. Department-level
// dedupe alone is not enough: it happily picks a second person at the same small faculty
// the very next day, which is precisely what makes a "personal" note look automated. A
// large university comes back into play a few batches later, which is fine - nobody
// notices two emails a week apart in different faculties.
const COOLDOWN = Number(arg('cooldown', 4));

// Inspect a batch without writing anything. Round files double as the generator's
// "already contacted" history, so a batch written but never sent silently burns 10
// contacts - dry-run makes the mandatory eyeball pass cost nothing.
const DRY_RUN = process.argv.includes('--dry-run');

// Minimum score. The title quotas used to force weak tail picks into a batch when a band
// had no good candidates left - the 2026-09-02 round 11 was about to send an e-government
// lecturer (score 58, audience is civil servants not students) purely to fill the Lektor
// slot. A slot that cannot be filled well is better given to the next-best candidate of
// any title, which is safe now that all three main titles reply at similar rates and
// Lektor is the one band still at zero.
const FLOOR = Number(arg('floor', 0));

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.filter((r) => r.length === header.length)
             .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

// ---- everyone already emailed -------------------------------------------------
// Discovered by globbing, NOT a hardcoded list: a hardcoded list silently goes stale
// the moment a new round is sent, and the failure is invisible - the next batch just
// quietly re-contacts people who were already emailed.
// The file for THIS round is excluded: it is output, not history. Counting it would make
// a re-run exclude its own previous picks, permanently marking as "contacted" ten people
// who were never actually emailed - and the loss is invisible.
const selfFile = `out/round${ROUND}-emails.json`;
const roundFiles = readdirSync('out')
  .filter((f) => /^round\d+-emails\.json$/.test(f))
  .map((f) => `out/${f}`)
  .filter((f) => f !== selfFile)
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
const sentFiles = ['out/test-emails.json', ...roundFiles];

// Tolerate either shape. A hand-patched round file has been written as an object keyed
// "0".."9" instead of an array before now; reading that as-is either crashes or, worse,
// silently drops 10 already-contacted people back into the pool.
const rowsOf = (f) => {
  const d = JSON.parse(readFileSync(f, 'utf8'));
  return Array.isArray(d) ? d : Object.values(d);
};

const already = new Set();
for (const f of sentFiles) {
  if (!existsSync(f)) continue;
  for (const r of rowsOf(f)) {
    if (r.email) already.add(r.email.toLowerCase());
  }
}

// Universities from the most recent COOLDOWN batches (test-emails counts as the first).
const recentFiles = sentFiles.slice(-COOLDOWN);
const recentEmails = new Set();
for (const f of recentFiles) {
  if (!existsSync(f)) continue;
  for (const r of rowsOf(f)) {
    if (r.email) recentEmails.add(r.email.toLowerCase());
  }
}
console.log(`exclusion sources: ${sentFiles.join(', ')}`);
console.log(`already contacted: ${already.size}`);
console.log(`cooldown batches:  ${recentFiles.join(', ') || '(none)'}`);

// Candidates are picked from tier 1 only...
const contacts = parseCSV(readFileSync('out/tier1.csv', 'utf8'));

// ...but the department/university exclusions must be looked up across ALL tiers.
// Re-running `npm run rank` re-scores everyone, so an already-contacted person can move
// OUT of tier 1 (the 2026-09-02 FIT retune moved 14 of the first 100). Looking their
// department up in tier1.csv alone then silently loses it, and the next batch can email
// a second person in a department we contacted days ago. The PEOPLE are still safe -
// `already` is built from the round files by address - but the spacing is not.
const allTiers = ['out/tier1.csv', 'out/tier2.csv', 'out/tier3.csv']
  .filter((f) => existsSync(f))
  .flatMap((f) => parseCSV(readFileSync(f, 'utf8')));

const deptKey = (c) => `${c.uni_slug}||${c.department}`;
const usedDepts = new Set(
  allTiers.filter((c) => already.has(c.email.toLowerCase())).map(deptKey),
);
const cooldownUnis = new Set(
  allTiers.filter((c) => recentEmails.has(c.email.toLowerCase())).map((c) => c.uni_slug),
);

// Loud if any contacted address is in no tier at all - that would be a real blind spot.
const locatable = new Set(allTiers.map((c) => c.email.toLowerCase()));
const unlocatable = [...already].filter((e) => !locatable.has(e));
if (unlocatable.length) {
  console.warn(`WARNING: ${unlocatable.length} contacted address(es) found in no tier CSV - ` +
    `their department/university cannot be excluded: ${unlocatable.slice(0, 5).join(', ')}`);
}

// ---- personalisation ----------------------------------------------------------
// Sekolah kedinasan: the students are bonded civil servants, not a market for courses
// sold to students, so the material has no audience on Nalar. Round 11 rejected an
// e-government lecturer by hand for exactly this reason; round 14 surfaced IPDN again.
// Poltekkes is deliberately NOT here - its students are ordinary health students who
// sit the national competency exams, which makes them a target, not an exclusion.
const KEDINASAN = /pemerintahan dalam negeri|\bipdn\b|pkn stan|akademi kepolisian|akademi militer|intelijen negara|ilmu pemasyarakatan|politeknik imigrasi/i;

const ROLE_RE = /coordinator|chairman|chairperson|chair\b|head of|\bdean\b|director|member of|board of|secretary|\bketua\b|\bdekan\b|sekretaris|anggota/i;

// A bare one-word Indonesian field name reads wrong in an English sentence ("your work
// in Manajemen"), and several source rows carry nothing else.
const TERM_EN = new Map([
  ['manajemen', 'management'], ['akuntansi', 'accounting'], ['hukum', 'law'],
  ['pariwisata', 'tourism'], ['kebidanan', 'midwifery'], ['keperawatan', 'nursing'],
  ['kedokteran', 'medicine'], ['farmasi', 'pharmacy'], ['ekonomi', 'economics'],
  ['bisnis', 'business'], ['komunikasi', 'communications'], ['pendidikan', 'education'],
  ['informatika', 'informatics'], ['statistika', 'statistics'], ['matematika', 'mathematics'],
  ['sosiologi', 'sociology'], ['psikologi', 'psychology'], ['administrasi', 'administration'],
  ['arsitektur', 'architecture'], ['kimia', 'chemistry'], ['fisika', 'physics'],
  ['biologi', 'biology'], ['agribisnis', 'agribusiness'],
]);

// The hook is quoted straight into an English sentence ("your work in X"), so the two
// halves have to agree with each other. "Embriologi and genetika perkembangan" and
// "Komunikasi pemasaran digital and komunikasi strategis" both read as a machine having
// swapped one word - the exact mailmerge tell the hook exists to avoid. An all-Indonesian
// phrase inside the English sentence is fine (Indonesian academics code-switch
// constantly); it just has to keep its own "dan". 22% of the remaining pool hits this.
//
// Detection is deliberately biased toward Indonesian: a false "Indonesian" only joins two
// English halves with "dan", which an Indonesian reader does not blink at, while a false
// "English" reintroduces the bug. Evidence is TERM_EN's own field names, a short function-
// word list, and the pe-/peng-/per-/ke- ...-an derivational frame, which has no English
// lookalikes (pendidikan, pengembangan, pemasaran, perbankan, kesehatan, keuangan).
// String.raw, not a plain template literal: `\b` in a template literal is a backspace
// character, so the first version of this regex compiled to something that matched
// nothing and silently reported every phrase as English.
const ID_WORDS = new RegExp(
  String.raw`\b(?:` + [...TERM_EN.keys()].join('|')
  + String.raw`|dan|serta|dengan|untuk|pada|dalam|terhadap|dari|yang|atau|berbasis`
  + String.raw`|melalui|ilmu|sosial|bahasa|guru|sekolah|anak|usia|dini|ibu|hewan|pangan`
  + String.raw`|tanaman|agama|islam|syariah|masyarakat|perilaku|kualitas|strategi|kerja`
  + String.raw`|gizi|obat|desa|daerah|negara|pajak|wisata|olahraga|jasmani|rekreasi|seni`
  + String.raw`|sastra|sejarah|rakyat)\b` + '|'
  + String.raw`\b(?:pe|peng|pen|pem|per|ke)\w{3,}an\b` + '|'
  // Indonesian spellings of Latin/Greek cognates. English uses -ology, -ation,
  // -ity, -omy, -graphy, so these endings never collide: patologi, farmakologi,
  // informasi, komunikasi, kualitas, akuntansi, anatomi, matematika, geografi.
  // Round 14 joined "Patologi Anatomi" to "Farmakologi" with an English "and"
  // because the word list alone read both halves as English.
  + String.raw`\b\w{3,}(?:ologi|asi|itas|ansi|ika|omi|grafi|isme)\b`, 'i');
const isIndonesian = (s) => ID_WORDS.test(String(s));

function hook(area, dept) {
  const raw = String(area ?? '').trim() ? String(area) : String(dept ?? '');

  // A multi-word parenthetical in research_area is the source's own English gloss of the
  // field (e.g. "K3 (Occupational Health and Safety Management)"). It is the best hook
  // available, and the old code threw it away along with every other parenthetical.
  const gloss = raw.match(/\(([^()]*\s[^()]*)\)/);
  if (gloss && !ROLE_RE.test(gloss[1])) return gloss[1].trim().replace(/\s+/g, ' ');

  const stripped = raw.replace(/\([^)]*\)/g, ' ');
  const items = stripped.split(/[;,/]/).map((s) => s.trim().replace(/[.\s]+$/, ''))
    .filter((s) => s.length > 2 && !ROLE_RE.test(s));
  if (items.length === 0) return stripped.replace(/\s+/g, ' ').trim();

  // Never join when a half already carries its own conjunction - "Economic Law" +
  // "Banking and Finance Law" reads "economic law and banking and finance law". Fall back
  // to the single most specific item instead of blindly items[0], which is what used to
  // throw away "banking and finance law" and send the generic "Economic Law". The 6-word
  // ceiling drops research-paper sentences, hand-patched out of round 6 one at a time.
  const hasConj = (t) => / and | dan | serta /i.test(t) || t.includes('&');
  const wordCount = (t) => t.split(/\s+/).length;
  const mostSpecific = () => items.filter((t) => wordCount(t) <= 6)
    .sort((a, b) => wordCount(b) - wordCount(a))[0] ?? items[0];

  let chosen;
  if (items.length >= 2 && !hasConj(items[0]) && !hasConj(items[1])) {
    const [a, b] = items;
    chosen = isIndonesian(a) === isIndonesian(b)
      ? a + (isIndonesian(a) ? ' dan ' : ' and ') + b
      : mostSpecific();     // halves in different languages: send one, never a hybrid
  } else {
    chosen = mostSpecific();
  }

  // An otherwise-English phrase carrying a stray Indonesian conjunction is the round-5
  // bug and still needs the rewrite; an all-Indonesian phrase keeps its own conjunction.
  if (!isIndonesian(chosen.replace(/ dan | serta /gi, ' '))) {
    chosen = chosen.replace(/ dan /gi, ' and ').replace(/ serta /gi, ' and ');
  }
  chosen = chosen.replace(/\s+/g, ' ').trim();
  return TERM_EN.get(chosen.toLowerCase()) ?? chosen;
}

// Subject-line noun. Innermost department parenthetical first: a programme studi is
// more specific than the faculty that contains it.
const NOUNS = [
  [/kebidanan|midwif/i, 'midwifery'], [/keperawatan|nursing/i, 'nursing'],
  [/kesehatan masyarakat|public health/i, 'public health'],
  // Before both `kedokteran` and `pendidikan`: "Program Studi Pendidikan Dokter Hewan"
  // was scoring as education, which also let a vet surgeon take an education slot and
  // slip past DISCIPLINE_CAP on medicine.
  [/kedokteran hewan|dokter hewan|veterinar/i, 'veterinary medicine'],
  // `medic` used to swallow "Medicinal Chemistry", which sent a UI pharmacy lecturer a
  // subject line about his medicine teaching material. Medicinal chemistry only - a
  // first attempt added `farmakologi` too and promptly relabelled IPB's "Departemen
  // Anatomi, Fisiologi, dan Farmakologi" (a veterinary department) as pharmacy.
  [/medicinal chem|kimia medisinal/i, 'pharmacy'],
  [/kedokteran|\bmedicine\b|\bmedical\b/i, 'medicine'], [/farmasi|pharmac/i, 'pharmacy'],
  [/akuntansi|accounting/i, 'accounting'],
  [/hukum|\blaw\b/i, 'law'],
  [/sistem informasi|information system/i, 'information systems'],
  [/informatika|ilmu komputer|computer science/i, 'computer science'],
  [/pemasaran|marketing/i, 'marketing'],
  [/perbankan|banking|keuangan|\bfinance\b|financial/i, 'finance'],
  // Ahead of `manajemen`, which is generic and so never wins on its own but does
  // block a better match: "Pendidikan Islam Anak Usia Dini dan pengembangan
  // manajemen ..." came out as management teaching material.
  [/tarbiyah|keguruan|\bpaud\b|anak usia dini/i, 'education'],
  [/manajemen|management/i, 'management'],
  [/ekonomi|economic/i, 'economics'], [/bisnis|business/i, 'business'],
  [/komunikasi|communication/i, 'communications'],
  [/psikolog/i, 'psychology'],
  [/data scien|data mining|machine learning|artificial intelligence|deep learning|big data|natural language processing/i, 'data science'],
  // Language before education: "English Language Education" is a language
  // lecturer's material, not an education lecturer's, and `pendidikan` used to win
  // purely on ordering. Same family as the psychology-over-TEYL bug.
  [/bahasa|sastra|linguist|english|inggris|tesol|\belt\b/i, 'language'],
  [/pendidikan|education/i, 'education'],
  [/sistem informasi|information system/i, 'information systems'],
  [/informatika|ilmu komputer|computer science/i, 'computer science'],
  [/teknik sipil|civil engineering/i, 'civil engineering'],
  [/teknik elektro|electrical/i, 'electrical engineering'],
  [/teknik industri|industrial/i, 'industrial engineering'],
  [/teknik mesin|mechanical/i, 'mechanical engineering'],
  [/teknik|engineering/i, 'engineering'],
  [/matematika|mathemat/i, 'mathematics'], [/statistik/i, 'statistics'],
  [/agribisnis|pertanian|agricultur/i, 'agriculture'],
  [/sosiolog/i, 'sociology'], [/administrasi/i, 'administration'],
  [/arsitektur|architect/i, 'architecture'],
  [/pariwisata|tourism/i, 'tourism'], [/kimia|chemis/i, 'chemistry'],
  [/fisika|physic/i, 'physics'], [/biolog/i, 'biology'],
  [/hubungan internasional/i, 'international relations'],
];

// Administratively generic nouns. A department called "Program Studi Manajemen" or
// "Manajemen Informatika" says almost nothing about what the person actually teaches, so
// when research_area disagrees with a generic department match, research_area wins.
// Everything else in NOUNS is specific enough that the department is the better signal.
const GENERIC_NOUNS = new Set(['management', 'business', 'economics', 'administration']);

const matchNoun = (text) => {
  for (const [re, noun] of NOUNS) if (re.test(String(text ?? ''))) return noun;
  return null;
};

const isSpecific = (n) => Boolean(n) && !GENERIC_NOUNS.has(n);

function subjectNoun(dept, area) {
  const parens = [...String(dept ?? '').matchAll(/\(([^()]*)\)/g)].map((m) => m[1]);
  // Innermost parenthetical first (a programme studi beats the faculty holding it), but
  // prefer any SPECIFIC match over a generic one wherever it sits in the department.
  const deptHits = [...parens.reverse(), String(dept ?? '')].map(matchNoun).filter(Boolean);
  const fromDept = deptHits.find(isSpecific) ?? deptHits[0] ?? null;
  const fromArea = matchNoun(area);

  // Prefer whichever source yields a SPECIFIC noun, checking research_area first: it is
  // what the person actually works on, while `department` is often just the faculty.
  // Generalised 2026-09-02 from an earlier rule that only overrode four "generic" nouns
  // - that version still emitted "Your psychology teaching material" to a lecturer whose
  // research is Teaching English to Young Learners, because psychology is not generic.
  // Area is checked first but only wins when specific, which keeps the reverse case
  // right too: "Health Management" (area) must not beat "Kesehatan Masyarakat" (dept).
  if (isSpecific(fromArea)) return fromArea;
  if (isSpecific(fromDept)) return fromDept;
  return fromArea ?? fromDept;
}

// ---- selection ----------------------------------------------------------------
// A one-word generic hook is a mailmerge tell - "I'm writing because of your work in
// Marketing" says we know nothing about them, which is the opposite of the email's whole
// premise. Reject those rows rather than send a weak personalisation.
const WEAK_HOOKS = new Set([
  'management', 'manajemen', 'marketing', 'pemasaran', 'accounting', 'akuntansi',
  'economics', 'ekonomi', 'business', 'bisnis', 'finance', 'keuangan', 'law', 'hukum',
  'education', 'pendidikan', 'psychology', 'psikologi', 'communications', 'komunikasi',
  'informatics', 'informatika', 'statistics', 'statistika', 'mathematics', 'matematika',
  'administration', 'administrasi', 'nursing', 'keperawatan', 'midwifery', 'kebidanan',
  'ilmu pendidikan', 'ilmu manajemen', 'ilmu ekonomi', 'ilmu hukum', 'ilmu komunikasi',
  'ilmu akuntansi', 'manajemen bisnis', 'teknik informatika', 'sistem informasi',
  // Added 2026-09-09 with the generic-pair rule below, which needs both halves listed.
  'public health', 'kesehatan masyarakat', 'medicine', 'kedokteran', 'pharmacy', 'farmasi',
  'computer science', 'ilmu komputer', 'data science', 'sociology', 'sosiologi',
  'chemistry', 'kimia', 'physics', 'fisika', 'biology', 'biologi',
  'architecture', 'arsitektur', 'tourism', 'pariwisata', 'agribusiness', 'agribisnis',
  'veterinary medicine', 'kedokteran hewan', 'ilmu kedokteran hewan',
]);

// A pair of generic categories is just as weak as one of them on its own: round 13 was
// about to open with "your work in Nursing and Public Health", which the single-term set
// could not see because neither half was the whole hook.
const weak = (h) => {
  const t = h.toLowerCase();
  if (WEAK_HOOKS.has(t)) return true;
  const halves = t.split(/ and | dan /);
  return halves.length === 2 && halves.every((x) => WEAK_HOOKS.has(x.trim()));
};
const usableHook = (c) => {
  const h = hook(c.research_area, c.department).trim();
  return h.length > 0 && !weak(h);
};

const pool = contacts
  .filter((c) => !already.has(c.email.toLowerCase()))
  .filter((c) => !usedDepts.has(deptKey(c)))
  .filter((c) => !cooldownUnis.has(c.uni_slug))
  .filter((c) => subjectNoun(c.department, c.research_area))   // needs a usable subject line
  .filter(usableHook)                                          // ...and a specific hook
  .filter((c) => !KEDINASAN.test(String(c.university)))
  .filter((c) => Number(c.score) >= FLOOR)
  .sort((a, b) => Number(b.score) - Number(a.score));

// One person per university and per department within a single batch, plus the
// discipline cap. Quotas are filled greedily down the score-sorted pool.
const picked = [], perUni = new Set(), perDept = new Set();
const perNoun = new Map(), left = { ...QUOTAS };
for (const c of pool) {
  const t = c.academic_title;
  if (!(t in left) || left[t] <= 0) continue;
  if (perUni.has(c.uni_slug) || perDept.has(deptKey(c))) continue;
  const noun = subjectNoun(c.department, c.research_area);
  if ((perNoun.get(noun) ?? 0) >= DISCIPLINE_CAP) continue;
  picked.push(c);
  perUni.add(c.uni_slug); perDept.add(deptKey(c));
  perNoun.set(noun, (perNoun.get(noun) ?? 0) + 1);
  left[t]--;
  if (picked.length >= N) break;
}

// Top-up pass: fill any slots the quotas could not fill, from the best remaining
// candidates of ANY title. Still respects one-per-university, one-per-department and the
// discipline cap - only the title quota is relaxed.
for (const c of pool) {
  if (picked.length >= N) break;
  if (perUni.has(c.uni_slug) || perDept.has(deptKey(c))) continue;
  const noun = subjectNoun(c.department, c.research_area);
  if ((perNoun.get(noun) ?? 0) >= DISCIPLINE_CAP) continue;
  picked.push(c);
  perUni.add(c.uni_slug); perDept.add(deptKey(c));
  perNoun.set(noun, (perNoun.get(noun) ?? 0) + 1);
}

const BODY = (g, h, topic) => `Dear ${g},

I'm Alex Low, CEO of Y Ventures Group Ltd, an SGX-listed company in Singapore. Nalar (nalar.tech) is our wholly owned subsidiary - a learning platform for Indonesian students.

I'm writing because of your work in ${h}. We're inviting a small number of lecturers to become Nalar course authors, and I wanted to ask you directly rather than through an intermediary.

It works like this: you send us the material you already have for a subject like ${topic} - slides, lecture notes, a syllabus, in whatever form it exists. Another subject you teach regularly is just as welcome if you'd rather. Our team uses AI-assisted production to turn it into a short course. You are credited as the author, you approve it before anything goes live, and you earn 15-25% of net revenue for as long as it stays published. The licence is non-exclusive, so you carry on teaching and publishing the same material exactly as you do now. There is no new writing on your side, and your material is not used to train AI models.

What it offers is reach - students at universities across Indonesia rather than only your own.

Would you be interested in hearing more?`;

const topicOf = (h, noun) => {
  const first = String(h).split(/ and /i)[0].trim();
  return first && first.length <= 45 ? first : noun;
};

const out = picked.map((c, i) => {
  const h = hook(c.research_area, c.department);
  const noun = subjectNoun(c.department, c.research_area);
  const topic = topicOf(h, noun);
  return {
    n: i + 1,
    email: c.email,
    greeting: c.greeting,
    title: c.academic_title,
    uni: c.university,
    uni_slug: c.uni_slug,
    score: Number(c.score),
    subject: `Your ${noun} teaching material - an invitation from Nalar`,
    hook: h,
    body: BODY(c.greeting, h, topic),
  };
});

if (DRY_RUN) {
  console.log('DRY RUN - no files written');
} else {
  writeFileSync(`out/round${ROUND}-emails.json`, JSON.stringify(out, null, 1));
  writeFileSync(`out/round${ROUND}-emails.md`,
    `# Round ${ROUND} - ${out.length} emails\n\n` +
    out.map((e) => `---\n\n## ${e.n}. ${e.email}\n\n_${e.title} - ${e.uni} - score ${e.score}_\n\n**Subject:** ${e.subject}\n\n${e.body}\n`).join('\n'));
}

console.log(`pool after exclusions: ${pool.length}`);
console.log(`unfilled quota: ${JSON.stringify(left)}`);
console.log(`\n#  ${'title'.padEnd(14)} ${'subject'.padEnd(18)} ${'hook'.padEnd(44)} email`);
for (const e of out) {
  const noun = e.subject.replace(/^Your /, '').replace(/ teaching.*$/, '');
  console.log(`${String(e.n).padEnd(2)} ${e.title.padEnd(14)} ${noun.padEnd(18)} ${e.hook.slice(0, 42).padEnd(44)} ${e.email}`);
}
