// Outreach list ranking + email hygiene pipeline.
//
//   npm run rank                      full run, writes out/ (does DNS MX lookups)
//   npm run rank -- --no-mx           skip DNS entirely (fast, offline)
//   npm run rank -- --tier1=800       override the Tier 1 cut
//   npm run rank -- --explain=x@y.ac.id   print one contact's score breakdown and exit
//
// Reads every data/universities/*.json, drops the addresses we must not email, scores the
// rest for fit/seniority/personalisability, and writes tiered Smartlead-ready CSVs.
// Read-only with respect to data/ — it never modifies the directory itself.
//
// WHAT "VERIFICATION" MEANS HERE, AND WHAT IT DOES NOT
// ----------------------------------------------------
// This script does HYGIENE, not mailbox verification. It can prove an address is
// unmailable (bad syntax, role account, domain with no mail server); it cannot prove an
// address is live. Only an SMTP-level check can do that, and we deliberately do NOT do it
// here: probing thousands of mailboxes with RCPT TO from our own IP is exactly the
// behaviour that gets a sending IP blocklisted, which is the thing this whole campaign is
// trying to avoid. Instead the run emits out/verify-queue.csv for a paid verifier
// (ZeroBounce / NeverBounce / MillionVerifier — all bulk-CSV based). Feed the result back
// before sending: these addresses came from staff pages and PDF extraction, so some are
// certainly stale, and hard bounces above ~5% will damage the sending domain faster than
// anything else in the campaign.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promises as dns } from 'node:dns';

import * as cfg from './outreach.config.mjs';

// ---------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------

const args = new Map();
for (const raw of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(raw);
  if (!m) continue;
  args.set(m[1], m[2] === undefined ? true : m[2]);
}

const opts = {
  skipMx: args.has('no-mx'),
  tier1: Number(args.get('tier1') ?? cfg.TIER_CUTS.tier1),
  tier2: Number(args.get('tier2') ?? cfg.TIER_CUTS.tier2),
  outDir: String(args.get('out') ?? 'out'),
  explain: args.get('explain'),
  concurrency: Number(args.get('concurrency') ?? 20),
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'data', 'universities');

// ---------------------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------------------

const files = readdirSync(dataDir).filter((f) => f.endsWith('.json')).sort();
if (files.length === 0) {
  console.error('No university files in data/universities/. Nothing to rank.');
  process.exit(1);
}

/** @type {Array<Record<string, any>>} */
const contacts = [];
const knownSlugs = new Set();
for (const file of files) {
  const { professors = [], ...uni } = JSON.parse(readFileSync(join(dataDir, file), 'utf8'));
  const slug = uni.slug ?? file.replace(/\.json$/, '');
  knownSlugs.add(slug);
  for (const p of professors) {
    contacts.push({
      ...p,
      uni_name: uni.name ?? '',
      uni_slug: slug,
      city: uni.city ?? '',
      province: uni.province ?? '',
    });
  }
}

// A TIER_1_UNIVERSITIES slug that matches no data file silently scores zero instead of
// erroring, so the bonus just never applies and the tiers look plausible anyway. Two of the
// original 17 were wrong this way (IPB and USU). Warn loudly rather than fail — the list is
// hand-maintained and a stale entry shouldn't block a run.
const unknownTier1 = [...cfg.TIER_1_UNIVERSITIES].filter((s) => !knownSlugs.has(s));
if (unknownTier1.length > 0) {
  console.warn(
    `\n! ${unknownTier1.length} TIER_1_UNIVERSITIES slug(s) match no data/universities/*.json file,\n` +
    `  so those universities are scoring without their bonus. Fix the slug in outreach.config.mjs:\n` +
    unknownTier1.map((s) => `    ${s}`).join('\n') + '\n',
  );
}

// ---------------------------------------------------------------------------------------
// Name parsing
// ---------------------------------------------------------------------------------------
// Indonesian academic names carry credentials on both ends. See the notes in
// outreach.config.mjs for worked examples. Two rules that matter more than the parsing:
// many people here have a single name with no family name, and gender is NOT inferable
// from an Indonesian name — so we never emit Bapak/Ibu or he/she anywhere.

/** Dot/hyphen-separated atoms of a token: "Dr.rer.nat." -> ['dr','rer','nat']. */
const atomsOf = (token) =>
  token.toLowerCase().split(/[.\-]+/).map((s) => s.trim()).filter(Boolean);

/** Whole token with all punctuation removed: "Ph.D." -> 'phd'. */
const flatten = (token) => token.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * A leading token is decoration when every atom is a known honorific atom ("Dr.rer.nat."),
 * or when it mixes honorific atoms with bare initials ("T.Ir." -> ['t','ir']). The second
 * case requires at least one real honorific atom, so genuine initial clusters like "M.E."
 * and "R.A." — which decompose to single letters only — are preserved.
 */
const isHonorificToken = (token) => {
  const atoms = atomsOf(token);
  if (atoms.length === 0) return false;
  if (atoms.every((a) => cfg.HONORIFIC_ATOMS.has(a))) return true;
  const honorifics = atoms.filter((a) => cfg.HONORIFIC_ATOMS.has(a));
  return honorifics.length > 0 && atoms.every((a) => cfg.HONORIFIC_ATOMS.has(a) || a.length === 1);
};

/**
 * Tokens that are never part of a name but can sit between honorifics, stranding the ones
 * behind them: "Prof. (Ret.) Dr. ...", "Prof. Em. ITB Dr. ...", "Dr. T. Ir. ...".
 * Only skipped when a real honorific still follows — see the strip loop in parseName.
 */
const isStrandingToken = (token) =>
  /^\(.*\)$/.test(token) ||      // "(Ret.)"
  /^[A-Z]{2,}\.?$/.test(token) || // "ITB" — an affiliation, not a name
  /^[A-Za-z]\.$/.test(token);     // "T." — a lone initial ahead of a title

const hasHonorificWithin = (tokens, from, span) => {
  for (let i = from; i < Math.min(tokens.length, from + span); i++) {
    if (isHonorificToken(tokens[i])) return true;
  }
  return false;
};

/**
 * A trailing whitespace-separated piece is credential noise when it is dotted, wrapped in
 * parentheses, carries 2+ capitals, is a lone capital, or is a listed exception. Anything
 * else is treated as part of the name — the safe direction to fail, since a surviving
 * fragment reads oddly but a wrongly stripped one silently truncates someone's name.
 */
function isCredentialPiece(piece) {
  if (piece.includes('.')) return true;
  if (/^\(.*\)$/.test(piece)) return true;
  const letters = piece.replace(/[^A-Za-z]/g, '');
  if (letters.length === 0) return true;
  if ((piece.match(/[A-Z]/g) ?? []).length >= 2) return true;
  if (letters.length === 1) return true;
  return cfg.CREDENTIAL_WORDS.has(letters.toLowerCase());
}

/** A post-comma chunk is a credential list when every piece in it is credential noise. */
function isCredentialChunk(chunk) {
  const pieces = chunk.split(/\s+/).filter(Boolean);
  return pieces.length > 0 && pieces.every(isCredentialPiece);
}

function parseName(raw) {
  const source = String(raw ?? '').replace(/\.-/g, '. '); // "Dr.-Ing." -> "Dr. Ing."
  const parts = source.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { core: '', first: '', last: '', hasProf: false, hasDoctorate: false };
  }

  // Drop post-comma chunks that are pure credential lists, keeping the rest: a few rows
  // genuinely carry a name fragment after the comma ("Prof., Dr., Drs. Nur Feriyanto").
  const keptChunks = [parts[0], ...parts.slice(1).filter((p) => !isCredentialChunk(p))];

  // Strip decoration from the assembled token list, not from the first chunk alone — some
  // rows comma-separate their honorifics, which leaves a "Drs." stranded mid-list.
  const tokens = keptChunks.join(' ').split(/\s+/).filter(Boolean);
  while (tokens.length > 1) {
    if (isHonorificToken(tokens[0])) { tokens.shift(); continue; }
    // Step over a stranding token only when a genuine honorific still lies behind it,
    // so an ordinary given name is never mistaken for decoration.
    if (isStrandingToken(tokens[0]) && hasHonorificWithin(tokens, 1, 3)) {
      tokens.shift();
      continue;
    }
    break;
  }

  // Trailing degrees are not always comma-separated ("... Example Name M.Pd."), so sweep
  // the end too. Middle initials are untouched because the sweep stops at the first
  // non-credential token from the right ("Example S. Name" keeps its "S.").
  while (tokens.length > 1 && isCredentialPiece(tokens[tokens.length - 1])) tokens.pop();

  const core = tokens.join(' ').replace(/\s+/g, ' ').trim();

  // Credentials are read off the ORIGINAL string, since the markers get stripped above.
  // Drs./Dra. are Indonesian pre-1993 undergraduate titles, NOT doctorates, so the test is
  // on the FIRST atom rather than substring presence: 'drs' must never read as 'dr'.
  const allTokens = source.split(/[\s,]+/).filter(Boolean);
  const hasProf = allTokens.some((t) => {
    const a = atomsOf(t);
    return a[0] === 'prof' || a[0] === 'professor';
  });
  const hasDoctorate = allTokens.some((t) => {
    const a = atomsOf(t);
    return a[0] === 'dr' || flatten(t) === 'phd';
  });

  const nameTokens = core.split(/\s+/).filter(Boolean);
  return {
    core,
    first: nameTokens[0] ?? '',
    last: nameTokens.slice(1).join(' '),
    hasProf,
    hasDoctorate,
  };
}

/** Safe salutation — credential-based only, never gendered. */
function greetingFor(parsed, title) {
  const prof = parsed.hasProf || title === 'Guru Besar' || title === 'Guru Besar Emeritus';
  if (prof) return `Prof. ${parsed.core}`;
  if (parsed.hasDoctorate) return `Dr. ${parsed.core}`;
  return parsed.core;
}

// ---------------------------------------------------------------------------------------
// Email hygiene
// ---------------------------------------------------------------------------------------

// Intentionally stricter than RFC 5322: we want addresses that real mail servers and
// Smartlead will both accept, not every technically-legal exotic form.
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

function classifyEmail(email) {
  const at = email.lastIndexOf('@');
  const local = email.slice(0, at).toLowerCase();
  const domain = email.slice(at + 1).toLowerCase();

  let cls = 'otherOrg';
  if (domain.endsWith('.ac.id') || domain.endsWith('.edu') || domain.endsWith('.edu.au')) {
    cls = 'institutional';
  } else if (cfg.FREEMAIL_DOMAINS.has(domain)) {
    cls = 'freemail';
  }
  return { local, domain, cls };
}

/** Gmail ignores dots and +tags, so two spellings can be one real mailbox. */
function dedupeKey(local, domain) {
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return `${local.split('+')[0].replace(/\./g, '')}@gmail.com`;
  }
  return `${local.split('+')[0]}@${domain}`;
}

// ---------------------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------------------

// Department carries full weight, research_area a fraction of it: department says what the
// person TEACHES, which is what determines whether students would take the course, while
// research_area only says what they specialise in. A term matching both scores once, at the
// department rate — matching in two fields is not twice the signal.
function scoreFit(contact) {
  const dept = String(contact.department ?? '').toLowerCase();
  const area = String(contact.research_area ?? '').toLowerCase();
  let total = 0;
  const hits = [];

  for (const [band, { weight, terms }] of Object.entries(cfg.FIT_KEYWORDS)) {
    for (const term of terms) {
      const needle = term.toLowerCase();
      if (dept.includes(needle)) {
        total += weight;
        hits.push(`${band}:${term}`);
      } else if (area.includes(needle)) {
        total += weight * cfg.RESEARCH_AREA_WEIGHT;
        hits.push(`${band}:${term}~`); // ~ marks a research_area-only (half-weight) hit
      }
    }
  }
  return { points: Math.round(Math.min(cfg.FIT_MAX, total)), hits };
}

function scoreRichness(contact) {
  const s = cfg.RICHNESS_SCORES;
  let points = 0;
  const notes = [];

  const ra = String(contact.research_area ?? '').trim();
  if (ra) {
    points += s.hasResearchArea;
    notes.push('research_area');
    if (ra.split(/\s+/).length > 3) {
      points += s.researchAreaIsSpecific;
      notes.push('specific_research_area');
    }
  }
  if (contact.google_scholar) {
    points += s.hasGoogleScholar;
    notes.push('google_scholar');
  }
  if (isPersonalProfileUrl(contact.website)) {
    points += s.hasPersonalProfilePage;
    notes.push('personal_profile');
  }
  return { points: Math.min(cfg.RICHNESS_MAX, points), notes };
}

// A per-person page ("/en/dosen/suwarno/") gives us a personalisation hook; a shared
// department listing ("/stafdosen/") does not.
const GENERIC_PATH_SEGMENTS = new Set([
  'dosen', 'stafdosen', 'staf', 'staff', 'team', 'teams', 'profile', 'profiles',
  'lecturer', 'lecturers', 'faculty', 'people', 'pegawai', 'tenaga-pendidik',
  'dosen-tetap', 'daftar-dosen', 'struktur', 'about', 'home', 'index', 'en', 'id',
]);

function isPersonalProfileUrl(url) {
  if (!url) return false;
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    if (segments.length < 2) return false;
    const last = decodeURIComponent(segments[segments.length - 1]).toLowerCase();
    return last.length > 3 && !GENERIC_PATH_SEGMENTS.has(last) && !/\.(php|html?|aspx)$/.test(last);
  } catch {
    return false;
  }
}

function scoreUniversity(contact) {
  if (cfg.TIER_1_UNIVERSITIES.has(contact.uni_slug)) return cfg.TIER_1_BONUS;
  if (/negeri/i.test(contact.uni_name)) return cfg.TIER_2_BONUS;
  return 0;
}

function scoreContact(contact) {
  const fit = scoreFit(contact);
  const seniority = Math.min(
    cfg.SENIORITY_MAX,
    cfg.SENIORITY_SCORES[contact.title] ?? cfg.SENIORITY_DEFAULT,
  );
  const richness = scoreRichness(contact);
  const uni = scoreUniversity(contact);
  const email = Math.min(cfg.EMAIL_MAX, cfg.EMAIL_SCORES[contact._cls] ?? 0);

  return {
    total: fit.points + seniority + richness.points + uni + email,
    breakdown: { fit: fit.points, seniority, richness: richness.points, university: uni, email },
    fitHits: fit.hits,
    richnessNotes: richness.notes,
  };
}

// ---------------------------------------------------------------------------------------
// Pass 1 — hygiene (offline)
// ---------------------------------------------------------------------------------------

const excluded = [];
const kept = [];
const seenKeys = new Map();

for (const c of contacts) {
  const email = String(c.email ?? '').trim();
  const drop = (reason, detail = '') => excluded.push({ ...c, _reason: reason, _detail: detail });

  if (!email) { drop('no-email'); continue; }
  if (!EMAIL_RE.test(email)) { drop('bad-syntax', email); continue; }

  const { local, domain, cls } = classifyEmail(email);

  if (cfg.DISPOSABLE_DOMAINS.has(domain)) { drop('disposable-domain', domain); continue; }
  if (cfg.ROLE_LOCAL_PARTS.test(local)) { drop('role-account', `${local}@`); continue; }

  const key = dedupeKey(local, domain);
  if (seenKeys.has(key)) {
    drop('duplicate', `same mailbox as ${seenKeys.get(key)}`);
    continue;
  }
  seenKeys.set(key, `${c.name} (${c.uni_slug})`);

  kept.push({ ...c, email: email.toLowerCase(), _local: local, _domain: domain, _cls: cls });
}

// ---------------------------------------------------------------------------------------
// Pass 2 — MX / A lookup per unique domain (network)
// ---------------------------------------------------------------------------------------
// A domain with neither an MX nor an A record cannot accept mail, so every address on it
// is a guaranteed hard bounce. We FAIL OPEN on timeouts and transient DNS errors: a flaky
// network run must never silently delete good contacts. Only NXDOMAIN is treated as fatal.

const mxStatus = new Map(); // domain -> 'ok' | 'no-mail-server' | 'unknown'

async function resolveDomain(domain) {
  try {
    const mx = await dns.resolveMx(domain);
    if (mx && mx.length > 0) return 'ok';
  } catch (err) {
    if (err.code === 'ENOTFOUND') return 'no-mail-server';
    if (err.code !== 'ENODATA') return 'unknown';
  }
  // No MX: RFC 5321 permits falling back to the A record.
  try {
    const a = await dns.resolve4(domain);
    return a && a.length > 0 ? 'ok' : 'no-mail-server';
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') return 'no-mail-server';
    return 'unknown';
  }
}

async function runPool(items, limit, worker) {
  let cursor = 0;
  let done = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
      done++;
      if (done % 25 === 0 || done === items.length) {
        process.stdout.write(`\r  DNS ${done}/${items.length} domains`);
      }
    }
  });
  await Promise.all(runners);
  if (items.length) process.stdout.write('\n');
}

const uniqueDomains = [...new Set(kept.map((c) => c._domain))].sort();

if (opts.skipMx) {
  console.log(`Skipping DNS (--no-mx). ${uniqueDomains.length} domains unchecked.`);
  for (const d of uniqueDomains) mxStatus.set(d, 'unknown');
} else {
  dns.setDefaultResultOrder?.('ipv4first');
  console.log(`Checking mail servers for ${uniqueDomains.length} unique domains...`);
  await runPool(uniqueDomains, opts.concurrency, async (d) => {
    mxStatus.set(d, await resolveDomain(d));
  });
}

const mailable = [];
for (const c of kept) {
  const status = mxStatus.get(c._domain) ?? 'unknown';
  if (status === 'no-mail-server') {
    excluded.push({ ...c, _reason: 'no-mail-server', _detail: c._domain });
    continue;
  }
  mailable.push({ ...c, _mx: status });
}

// ---------------------------------------------------------------------------------------
// Pass 3 — score, sort, tier
// ---------------------------------------------------------------------------------------

const SENIORITY_TIEBREAK = (c) => cfg.SENIORITY_SCORES[c.title] ?? cfg.SENIORITY_DEFAULT;

for (const c of mailable) {
  const s = scoreContact(c);
  c._score = s.total;
  c._breakdown = s.breakdown;
  c._fitHits = s.fitHits;
  c._richnessNotes = s.richnessNotes;

  const parsed = parseName(c.name);
  c._first = parsed.first;
  c._last = parsed.last;
  c._core = parsed.core;
  c._greeting = greetingFor(parsed, c.title);
}

// Deterministic ordering so reruns produce identical CSVs (diffable, resumable).
mailable.sort((a, b) =>
  b._score - a._score ||
  SENIORITY_TIEBREAK(b) - SENIORITY_TIEBREAK(a) ||
  a.uni_slug.localeCompare(b.uni_slug) ||
  a.email.localeCompare(b.email));

if (opts.explain) {
  const target = String(opts.explain).toLowerCase();
  const c = mailable.find((x) => x.email === target) ??
            excluded.find((x) => String(x.email ?? '').toLowerCase() === target);
  if (!c) {
    console.error(`\nNo contact with email ${target}.`);
    process.exit(1);
  }
  if (c._reason) {
    console.log(`\n${c.name} <${c.email}> — EXCLUDED: ${c._reason} ${c._detail || ''}`);
    process.exit(0);
  }
  const rank = mailable.indexOf(c) + 1;
  console.log(`\n${c.name}  <${c.email}>`);
  console.log(`${c.title} — ${c.department}`);
  console.log(`${c.uni_name}\n`);
  console.log(`research_area: ${c.research_area ?? '(none)'}`);
  console.log(`greeting:      "Dear ${c._greeting},"`);
  console.log(`\nscore ${c._score}/100   rank ${rank} of ${mailable.length}`);
  for (const [k, v] of Object.entries(c._breakdown)) {
    console.log(`  ${k.padEnd(12)} ${String(v).padStart(3)}`);
  }
  console.log(`\nfit matches:   ${c._fitHits.length ? c._fitHits.join(', ') : '(none)'}`);
  console.log(`richness:      ${c._richnessNotes.join(', ') || '(none)'}`);
  console.log(`email class:   ${c._cls}   mx: ${c._mx}`);
  process.exit(0);
}

const tier1 = mailable.slice(0, opts.tier1);
const tier2 = mailable.slice(opts.tier1, opts.tier1 + opts.tier2);
const tier3 = mailable.slice(opts.tier1 + opts.tier2);
for (const [n, list] of [[1, tier1], [2, tier2], [3, tier3]]) {
  for (const c of list) c._tier = n;
}

// ---------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------

const outDir = join(root, opts.outDir);
mkdirSync(outDir, { recursive: true });

function csv(rows, columns) {
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map(([header]) => cell(header)).join(',')];
  for (const row of rows) lines.push(columns.map(([, get]) => cell(get(row))).join(','));
  return lines.join('\r\n') + '\r\n';
}

// Smartlead treats email/first_name/last_name/company_name as built-ins and exposes every
// other column as a {{custom_variable}} usable in the sequence copy.
const CAMPAIGN_COLUMNS = [
  ['email', (c) => c.email],
  ['first_name', (c) => c._first],
  ['last_name', (c) => c._last],
  ['company_name', (c) => c.uni_name],
  ['greeting', (c) => c._greeting],
  ['full_name', (c) => c.name],
  ['academic_title', (c) => c.title],
  ['department', (c) => c.department],
  ['research_area', (c) => c.research_area ?? ''],
  ['university', (c) => c.uni_name],
  ['city', (c) => c.city],
  ['province', (c) => c.province],
  ['profile_url', (c) => c.website ?? ''],
  ['scholar_url', (c) => c.google_scholar ?? ''],
  ['score', (c) => c._score],
  ['tier', (c) => c._tier],
  ['email_class', (c) => c._cls],
  ['mx_status', (c) => c._mx],
  ['uni_slug', (c) => c.uni_slug],
];

writeFileSync(join(outDir, 'tier1.csv'), csv(tier1, CAMPAIGN_COLUMNS));
writeFileSync(join(outDir, 'tier2.csv'), csv(tier2, CAMPAIGN_COLUMNS));
writeFileSync(join(outDir, 'tier3.csv'), csv(tier3, CAMPAIGN_COLUMNS));

// Single-column upload for a bulk verifier; Tier 1 first so a partial/metered run covers
// the contacts we actually intend to send to first.
writeFileSync(
  join(outDir, 'verify-queue.csv'),
  csv(mailable, [['email', (c) => c.email]]),
);

writeFileSync(
  join(outDir, 'excluded.csv'),
  csv(excluded, [
    ['email', (c) => c.email ?? ''],
    ['reason', (c) => c._reason],
    ['detail', (c) => c._detail ?? ''],
    ['name', (c) => c.name],
    ['title', (c) => c.title],
    ['department', (c) => c.department],
    ['university', (c) => c.uni_name],
    ['uni_slug', (c) => c.uni_slug],
  ]),
);

// ---------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------

const tally = (list, keyFn) => {
  const m = new Map();
  for (const x of list) m.set(keyFn(x), (m.get(keyFn(x)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

const pct = (n, d) => (d === 0 ? '0.0' : ((n / d) * 100).toFixed(1));
const scoreRange = (list) =>
  list.length ? `${list[list.length - 1]._score}–${list[0]._score}` : 'n/a';

const lines = [];
const say = (s = '') => { lines.push(s); console.log(s); };

say();
say('='.repeat(78));
say(`RANKED ${mailable.length} contacts from ${contacts.length} directory rows (${files.length} universities)`);
say('='.repeat(78));

say();
say(`Excluded: ${excluded.length}`);
for (const [reason, n] of tally(excluded, (c) => c._reason)) {
  say(`  ${String(n).padStart(5)}  ${reason}`);
}

say();
say('Tiers (score out of 100):');
say(`  Tier 1  ${String(tier1.length).padStart(5)}  score ${scoreRange(tier1)}   -> out/tier1.csv`);
say(`  Tier 2  ${String(tier2.length).padStart(5)}  score ${scoreRange(tier2)}   -> out/tier2.csv`);
say(`  Tier 3  ${String(tier3.length).padStart(5)}  score ${scoreRange(tier3)}   -> out/tier3.csv`);

say();
say('Tier 1 composition:');
say(`  institutional email  ${String(tier1.filter((c) => c._cls === 'institutional').length).padStart(5)}  (${pct(tier1.filter((c) => c._cls === 'institutional').length, tier1.length)}%)`);
say(`  freemail             ${String(tier1.filter((c) => c._cls === 'freemail').length).padStart(5)}  (${pct(tier1.filter((c) => c._cls === 'freemail').length, tier1.length)}%)`);
say(`  has research_area    ${String(tier1.filter((c) => c.research_area).length).padStart(5)}  (${pct(tier1.filter((c) => c.research_area).length, tier1.length)}%)`);
say(`  no fit keyword hit   ${String(tier1.filter((c) => c._fitHits.length === 0).length).padStart(5)}  (${pct(tier1.filter((c) => c._fitHits.length === 0).length, tier1.length)}%)`);

say();
say('Tier 1 by academic title:');
for (const [t, n] of tally(tier1, (c) => c.title)) say(`  ${String(n).padStart(5)}  ${t}`);

say();
say('Tier 1 top 12 universities:');
for (const [u, n] of tally(tier1, (c) => c.uni_name).slice(0, 12)) say(`  ${String(n).padStart(5)}  ${u}`);

if (!opts.skipMx) {
  const unknown = mailable.filter((c) => c._mx === 'unknown').length;
  say();
  say(`DNS: ${uniqueDomains.length} domains checked, ${mxStatus.size ? [...mxStatus.values()].filter((v) => v === 'no-mail-server').length : 0} with no mail server.`);
  if (unknown) say(`  ${unknown} contacts on ${new Set(mailable.filter((c) => c._mx === 'unknown').map((c) => c._domain)).size} domains returned inconclusive DNS — kept (fail-open). Re-run to retry.`);
}

// Send-capacity arithmetic. The daily cap applies to follow-ups too, which is the single
// most commonly missed constraint when sizing a cold campaign.
const SENDS_PER_CONTACT = 2.5; // 3-step sequence, allowing for reply-stops
const capacity = (contactCount, perDay) =>
  Math.ceil((contactCount * SENDS_PER_CONTACT) / perDay);

say();
say('-'.repeat(78));
say('SEND CAPACITY (3-step sequence = ~2.5 emails per contact, follow-ups included)');
say('-'.repeat(78));
say(`Tier 1 = ${tier1.length} contacts = ~${Math.round(tier1.length * SENDS_PER_CONTACT)} emails`);
for (const mailboxes of [1, 3, 5, 10, 20]) {
  const perDay = mailboxes * 30;
  const days = capacity(tier1.length, perDay);
  say(`  ${String(mailboxes).padStart(2)} mailbox(es) @30/day = ${String(perDay).padStart(3)}/day  ->  ${String(days).padStart(3)} business days (~${(days / 5).toFixed(0)} weeks)`);
}

say();
say('-'.repeat(78));
say('BEFORE YOU SEND ANY OF THIS');
say('-'.repeat(78));
say('1. FIT_KEYWORDS in scripts/outreach.config.mjs are still placeholders. Tier 1 is');
say('   currently ranked against a guess at the offer, not the offer. Replace them once');
say('   the pitch is defined, then re-run and re-check with --explain.');
say('2. out/verify-queue.csv is NOT verified. Run it through a bulk verifier and remove');
say('   every invalid/catch-all-risky address before upload. >5% hard bounces will damage');
say('   the sending domain more than anything else in this campaign.');
say('3. Sanity-check greetings before launch: `--explain` a few Guru Besar and a few');
say('   single-name contacts. A mangled honorific in line one wastes the send.');

writeFileSync(join(outDir, 'report.txt'), lines.join('\n') + '\n');
say();
say(`Wrote ${opts.outDir}/: tier1.csv tier2.csv tier3.csv verify-queue.csv excluded.csv report.txt`);
