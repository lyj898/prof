// Configuration for the outreach ranking pipeline (scripts/rank-outreach.mjs).
//
// This file holds every judgement call that depends on WHAT WE ARE SELLING. The ranking
// script itself holds no opinions about the offer — edit this file, re-run `npm run rank`,
// and the tiers change. Nothing here touches data/universities/*.json.
//
// THE OFFER (settled 2026-08-19) — "Nalar Creators": we invite a lecturer to hand over
// teaching material they ALREADY have (slides, lecture notes, a syllabus — no new writing),
// we produce it into short courses with AI assistance, and distribute them on Nalar to
// students beyond their own university. They are named as the course author, they approve
// before publication, and they earn a revenue share per course.
//
// Two consequences drive the scoring below:
//   1. This is an INDIVIDUAL CONTRIBUTOR ask, not an institutional sale. The person who
//      says yes has material ready and something to gain from reach — a teaching-active
//      mid-career lecturer. Deans and department heads are a DISTRIBUTION channel (they
//      circulate the invitation internally), not contributors; they score low here on
//      purpose and belong in a separate campaign — filter `academic_title` on the CSV.
//   2. What matters is WHAT THEY TEACH, not what they research. A narrow specialism is
//      worth little even from a distinguished professor if few students would take it.

// ---------------------------------------------------------------------------------------
// 1. FIT — would a student PAY for a course from this person?  (max 40 points)
// ---------------------------------------------------------------------------------------
// RETUNED 2026-09-02. This used to score faculty breadth: national enrolment as a proxy
// for audience size, so every business/health/law lecturer scored 20. That cannot tell a
// digital-marketing lecturer apart from a general-management one, and it is the wrong
// axis anyway — enrolment measures how many students are FORCED to take a subject, not
// how many would BUY a course in it.
//
// The axis that matters: university students are price-sensitive and do not pay for
// interesting. They pay for three things — passing, graduating, and getting hired. So the
// bands below score TOPIC, not discipline, and the strong band is the five clusters where
// student willingness-to-pay is real AND the material already exists as a taught course
// (the offer is "send what you already have", so anything requiring new writing is out).
//
// Matched case-insensitively as substrings against `department` and `research_area`.
// Indonesian and English terms both matter — the directory mixes languages freely
// (e.g. "Akuntansi keuangan, kinerja perusahaan" vs "Corporate governance, firm value").
//
// Weights are additive but the FIT total is capped at FIT_MAX, so many weak terms cannot
// outrank one strong term. Keep `strong` short and specific.
export const FIT_MAX = 40;

// Was 0.5 (department weighted double). Now equal: the TOPIC signal lives in
// research_area — `department` is usually just the faculty ("Fakultas Ekonomi dan
// Bisnis"), which says nothing about what would sell. Same lesson as the subject-line
// fix in gen-batch.mjs, where a generic department was overriding the real specialism.
export const RESEARCH_AREA_WEIGHT = 1.0;

export const FIT_KEYWORDS = {
  // THE FIVE LAUNCH CLUSTERS. Real willingness to pay, and the material already exists.
  strong: {
    weight: 20,
    terms: [
      // Surviving the skripsi. Every Indonesian undergraduate must produce a thesis, it
      // is their single biggest source of anxiety, there is already a grey market
      // charging for help, and EVERY lecturer has methodology material on disk. This is
      // also where a named professor is worth most: the student is really buying
      // "will this satisfy my supervisor".
      'metodologi penelitian', 'metode penelitian', 'research method', 'penelitian kualitatif',
      'penelitian kuantitatif', 'statistik', 'statistic', 'spss', 'biostatist',
      'academic writing', 'penulisan ilmiah', 'karya tulis',
      // Personal finance and investing. Indonesia has had a large under-30 retail
      // investing boom, so this sells on aspiration AND employability.
      'financial literacy', 'literasi keuangan', 'pasar modal', 'capital market',
      'investment', 'investasi', 'portfolio', 'manajemen keuangan', 'financial management',
      'behavioral financ', 'perbankan', 'banking',
      // Digital and social media marketing — the legitimate, already-taught version of
      // "how to be an influencer".
      'digital marketing', 'pemasaran digital', 'social media', 'media sosial',
      'e-commerce', 'komunikasi pemasaran', 'marketing communication', 'branding',
      'consumer behavio', 'perilaku konsumen', 'content',
      // Data analytics and programming. Biggest supply in the directory and the
      // strongest employability pull.
      'data mining', 'data scien', 'machine learning', 'artificial intelligence',
      'business intelligence', 'analytics', 'analitik', 'python', 'basis data',
      'database', 'pemrograman', 'programming', 'big data',
      // English for academic and professional use — large existing paid market.
      'english language', 'bahasa inggris', 'applied linguistic', 'tesol', 'elt',
      'penerjemah', 'translation', 'toefl', 'ielts',
      // HEALTH PROFESSIONS - promoted from `weak` on 2026-09-03. Two reasons.
      // (a) Path A: nursing and midwifery are among the largest student cohorts in
      //     Indonesia, so one course sells into a big captive audience.
      // (b) Path B option value: each of these professions ends in a national
      //     competency exam (UKom Ners, UKom Bidan, UKMPPD, UKAI, UKMP2DG), and these
      //     are the people who would later validate an exam-prep question bank.
      // The BARE words 'kesehatan'/'health' stay in `weak`: they match whole faculties
      // ("Fakultas Ilmu Kesehatan") and are too blunt to carry 20 points.
      'keperawatan', 'nursing', 'ners',
      'kebidanan', 'midwif',
      'kedokteran', 'medic', 'dokter',
      'farmasi', 'pharmac', 'apoteker',
      'kedokteran gigi', 'dental', 'kesehatan masyarakat', 'public health',
      'gizi', 'nutrition',
      // Direct competency-exam signals: rare in research_area, but precise when present.
      'uji kompetensi', 'ukom', 'ukni', 'ukmppd', 'ukai', 'osce', 'pendidikan profesi',
    ],
  },
  // Sellable, but thinner demand, more competition, or a narrower buyer.
  medium: {
    weight: 10,
    terms: [
      'kewirausahaan', 'entrepreneur', 'umkm', 'startup', 'business model', 'inovasi bisnis',
      'perpajakan', 'taxation', 'tax', 'audit', 'akuntansi keuangan', 'financial accounting',
      'management accounting', 'akuntansi biaya',
      'syariah', 'sharia', 'islamic bank', 'islamic econom', 'islamic financ', 'zakat', 'wakaf',
      'sumber daya manusia', 'human resource', 'organizational behavio', 'perilaku organisasi',
      'rekrutmen', 'career', 'karir',
      'public speaking', 'retorika', 'komunikasi bisnis', 'business communication',
      'public relation', 'humas',
      'kesehatan mental', 'mental health', 'gizi', 'nutrition',
      'user experience', 'ui/ux', 'mobile programming', 'web', 'multimedia',
      'desain komunikasi visual', 'supply chain', 'operations management',
      'manajemen proyek', 'project management',
    ],
  },
  // Broad faculty labels, kept only so a plausible generalist still outranks an
  // unsellable specialism. Demoted from `strong` in the 2026-09-02 retune: on their own
  // these say almost nothing about whether a course would sell.
  weak: {
    weight: 4,
    terms: [
      'manajemen', 'management', 'akuntansi', 'accounting', 'ekonomi', 'economic',
      'bisnis', 'business', 'keuangan', 'finance', 'pemasaran', 'marketing',
      'hukum', 'law', 'informatika', 'informatics', 'ilmu komputer', 'computer science',
      'sistem informasi', 'information system', 'teknologi informasi',
      'komunikasi', 'communication', 'psikolog', 'psycholog',
      'pendidikan', 'education', 'administrasi', 'administration',
      'matematika', 'mathematic', 'sosiolog', 'sociolog', 'bahasa', 'language',
      // Faculty-level health words only; the specific professions moved to `strong`.
      'kesehatan', 'health',
    ],
  },
};

// ---------------------------------------------------------------------------------------
// 2. CONTRIBUTOR LIKELIHOOD — who will actually hand over material?  (max 25 points)
// ---------------------------------------------------------------------------------------
// Keyed on the `title` field. The directory uses exactly 9 values (verified 2026-08-19).
// This ranks WILLINGNESS TO CONTRIBUTE, which is close to the inverse of institutional
// seniority — the earlier version of this table ranked decision authority for an MoU-style
// sale and pointed the campaign at the wrong people entirely.
//
// The reasoning: a mid-career lecturer teaches heavily, has polished material sitting on
// disk, and gains real career value from national reach plus a named course credit. A Guru
// Besar has the prestige but the least to gain and the least time. An administrator has a
// job that is mostly not teaching.
export const SENIORITY_MAX = 25;

export const SENIORITY_SCORES = {
  'Lektor Kepala': 25,          // Senior lecturer — polished material, still building profile
  'Lektor': 23,                 // Teaching-active mid-career, strongest visibility motive
  'Dosen': 18,                  // 2,881 rows; unranked but teaching-active by default
  'Asisten Ahli': 15,           // Junior — eager, material may be rougher
  'Guru Besar': 10,             // Prestige adds course credibility; least time, least upside
  'Ketua Jurusan/Prodi': 8,     // Admin load; better used as a distribution channel
  'Guru Besar Emeritus': 6,     // Retired — time-rich but engagement uncertain
  'Wakil Dekan': 4,             // Distribution channel, not a contributor
  'Dekan': 3,                   // Distribution channel, not a contributor
};

export const SENIORITY_DEFAULT = 15;

// ---------------------------------------------------------------------------------------
// 3. UNIVERSITY TIER — weak signal, and genuinely two-sided  (max 4 points)
// ---------------------------------------------------------------------------------------
// Deliberately small. A top-tier name adds credibility to the finished course, but those
// lecturers are the busiest and have the least to gain from extra reach — a lecturer at a
// mid-tier university gains far more from national distribution and is likelier to say yes.
// The two effects roughly cancel, so this is a tiebreaker, not a driver. (It was 8 points
// when this scored an institutional sale, where prestige tracked budget.)
//
// Explicit list rather than a professor-count heuristic: our per-university counts reflect
// how hard WE researched each one, not how big it is, so counting would be circular.
// Slugs must match data/universities/<slug>.json.
export const TIER_1_UNIVERSITIES = new Set([
  'universitas-indonesia',
  'institut-teknologi-bandung',
  'universitas-gadjah-mada',
  'ipb-university',
  'universitas-airlangga',
  'universitas-padjadjaran',
  'universitas-diponegoro',
  'institut-teknologi-sepuluh-nopember',
  'universitas-brawijaya',
  'universitas-hasanuddin',
  'universitas-sebelas-maret',
  'universitas-sumatera-utara-usu',
  'universitas-udayana',
  'universitas-negeri-yogyakarta',
  'universitas-negeri-jakarta',
  'universitas-negeri-malang',
  'universitas-pendidikan-indonesia',
]);

export const TIER_1_BONUS = 4;
export const TIER_2_BONUS = 2; // any other state university (name contains "Negeri")

// ---------------------------------------------------------------------------------------
// 4. EMAIL QUALITY  (max 12 points)
// ---------------------------------------------------------------------------------------
// Institutional addresses are both more deliverable and more likely to be read for
// professional mail. A professor's gmail.com address listed on a faculty page is usually
// real but more often stale, and freemail recipients report spam more readily.
export const EMAIL_MAX = 12;

export const EMAIL_SCORES = {
  institutional: 12, // *.ac.id, incl. subdomains like staff.uns.ac.id, apps.ipb.ac.id
  otherOrg: 7,       // .go.id, .or.id, company domains — real but unusual for faculty
  freemail: 4,       // gmail/yahoo/etc.
};

export const FREEMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.id', 'yahoo.co.uk',
  'ymail.com', 'rocketmail.com', 'hotmail.com', 'hotmail.co.id', 'outlook.com',
  'outlook.co.id', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com',
  'protonmail.com', 'proton.me', 'mail.com', 'gmx.com', 'zoho.com',
]);

// Known disposable/throwaway providers — a hit here is an automatic exclusion.
export const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com',
  'temp-mail.org', 'throwawaymail.com', 'yopmail.com', 'trashmail.com',
  'sharklasers.com', 'getnada.com', 'dispostable.com', 'maildrop.cc',
]);

// ---------------------------------------------------------------------------------------
// 5. PERSONALISATION MATERIAL  (max 15 points)
// ---------------------------------------------------------------------------------------
// A cold email to an academic lives or dies on the first line being specific. A row with
// no research_area cannot be personalised beyond name + department, so it is worth less
// even when the person is senior and well matched.
export const RICHNESS_MAX = 15;

export const RICHNESS_SCORES = {
  hasResearchArea: 8,
  researchAreaIsSpecific: 3, // >3 words — a real list beats a bare "Agricultural Economics"
  hasGoogleScholar: 2,
  hasPersonalProfilePage: 2, // a per-person URL, not a shared department directory
};

// ---------------------------------------------------------------------------------------
// 6. EXCLUSIONS — never email these, regardless of score
// ---------------------------------------------------------------------------------------
// Shared/role mailboxes: a cold pitch to humas@ (public relations) or sekretariat@ is read
// by an administrator, not a decision maker, and is far likelier to be reported as spam.
// Matched against the local part only.
export const ROLE_LOCAL_PARTS =
  /^(info|informasi|admin|administrasi|contact|kontak|sekretariat|secretariat|humas|pr|fakultas|faculty|prodi|jurusan|dekanat|office|kantor|mail|email|webmaster|website|support|help|helpdesk|noreply|no-reply|donotreply|tu|akademik|academic|registrar|library|perpustakaan|lppm|bem|alumni)([._-]|$|[0-9])/i;

// ---------------------------------------------------------------------------------------
// 7. NAME PARSING — Indonesian academic naming
// ---------------------------------------------------------------------------------------
// Names in this dataset carry heavy credential decoration on both ends, e.g.
//   "Prof. Dr. Ir. Umar Khayam, S.T., M.T."     ->  Umar Khayam
//   "Nurlina, S.Kom., M.T."                     ->  Nurlina     (single name — common)
//   "Widodo, Dr.rer.nat., S.T., M.T."           ->  Widodo      (and he IS a doctor)
//   "Prof. Dr.-Ing. Yul Yunazwin Nazaruddin..." ->  Yul Yunazwin Nazaruddin
// Many Indonesians have no family name, so never assume a surname exists, and never infer
// gender from a name — see greetingFor() in rank-outreach.mjs.
//
// Both ends are handled STRUCTURALLY rather than by enumerating degrees, because the real
// data contains 579 distinct credential tokens (surveyed 2026-08-19) and any fixed list
// leaks. See rank-outreach.mjs for the two predicates that consume the sets below.

// Leading-position noise. A leading token is stripped when every dot/hyphen-separated atom
// in it appears here — so "Dr.rer.nat.", "Dr.-Ing." and "Eng." all strip, while the name
// initials "M.", "A.A.", "R.A." and the abbreviated given names "Moh.", "Muh.", "Abd."
// survive because 'm', 'a', 'r', 'moh' are deliberately NOT atoms.
export const HONORIFIC_ATOMS = new Set([
  // titles
  'prof', 'professor', 'assoc', 'asst', 'assist', 'em', 'emeritus',
  'dr', 'drs', 'dra', 'ir', 'dipl', 'h', 'hj', 'kh', 'apt',
  'dokter', 'drg', 'drh', 'dt', 'dg',
  // Latin/German doctorate qualifiers: "Dr. rer. nat.", "Dr. phil.", "Dr.Eng."
  'rer', 'nat', 'phil', 'oec', 'pol', 'jur', 'paed', 'med', 'habil',
  'techn', 'tech', 'ing', 'eng', 'sc', 'ec', 'sos',
  // Indonesian professional-title prefixes: Ars./Ar. (architect), Ling. (environmental)
  'ars', 'ar', 'ling',
]);

// Trailing-position noise, for pieces that contain NO dot (dotted pieces are always
// credentials). Verified against every non-dotted post-comma token in the dataset: the
// credentials all carry two or more capitals (MT, IPM, PhD, MSc, SpOG, CertSAP...), while
// the handful of genuine trailing name fragments — Edy, Suandi, Hamid, Nur, Feriyanto —
// carry exactly one. These are the credentials that break that rule, so list them.
export const CREDENTIAL_WORDS = new Set([
  'psikolog', 'apt', 'eng', 'ak', 'onk', 'hons', 'bd', 'ns', 'sp', 'jur', 'pol',
]);

// ---------------------------------------------------------------------------------------
// 8. TIER CUTS — how many contacts per wave
// ---------------------------------------------------------------------------------------
// Sized against SEND CAPACITY, not against how many good contacts exist. With a 3-step
// sequence each contact costs ~2.5 sends, so 1,500 contacts is ~3,750 sends — about five
// weeks on five warmed mailboxes at 30/day. Override at the CLI: `--tier1=800`.
export const TIER_CUTS = {
  tier1: 1500,
  tier2: 2000, // the next 2,000 after tier 1; everything remaining becomes tier 3
};
