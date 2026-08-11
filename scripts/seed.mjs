// Seed / import pipeline for the Professor Directory.
//
// Reads every data/universities/*.json file and upserts it into Supabase via the API.
// This is the reusable way to populate the DB as we add universities — edit/add a JSON
// file, then run `npm run seed`.
//
// Auth: uses the Supabase SERVICE ROLE (secret) key, which bypasses RLS. That key is
// read from the environment (SUPABASE_SERVICE_ROLE_KEY in .env.local) and must NEVER be
// committed or exposed to the browser. `npm run seed` loads it via `node --env-file`.
//
// Idempotency:
//   - universities -> upsert by slug (re-running updates university fields from the JSON)
//   - professors   -> inserted only if no professor with the same name already exists for
//                     that university, so manual edits made in the app UI are never clobbered.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const url = process.env.PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    '\n✖ Missing env. Add these to .env.local (gitignored), then run `npm run seed`:\n' +
      '    PUBLIC_SUPABASE_URL=...            (already set for the app)\n' +
      '    SUPABASE_SERVICE_ROLE_KEY=...      (Supabase → Settings → API Keys → secret key)\n',
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'universities');
const files = readdirSync(dataDir)
  .filter((f) => f.endsWith('.json'))
  .sort();

if (files.length === 0) {
  console.log('No university files in data/universities/. Nothing to seed.');
  process.exit(0);
}

let totalProfessorsInserted = 0;
let totalProfessorsSkipped = 0;
let hadError = false;

for (const file of files) {
  const { professors = [], ...university } = JSON.parse(readFileSync(join(dataDir, file), 'utf8'));

  // Upsert the university by its unique slug.
  const { data: row, error: universityErr } = await supabase
    .from('universities')
    .upsert(university, { onConflict: 'slug' })
    .select('id')
    .single();

  if (universityErr) {
    console.error(`✖ ${university.slug}: university upsert failed — ${universityErr.message}`);
    hadError = true;
    continue;
  }
  const universityId = row.id;

  // Insert only professors whose name isn't already present for this university.
  const { data: existing, error: exErr } = await supabase
    .from('professors')
    .select('name')
    .eq('university_id', universityId);

  if (exErr) {
    console.error(`✖ ${university.slug}: reading existing professors failed — ${exErr.message}`);
    hadError = true;
    continue;
  }

  const present = new Set((existing ?? []).map((p) => p.name));
  const toInsert = professors
    .filter((p) => !present.has(p.name))
    .map((p) => ({ ...p, university_id: universityId }));
  const skipped = professors.length - toInsert.length;

  if (toInsert.length > 0) {
    const { error: insErr } = await supabase.from('professors').insert(toInsert);
    if (insErr) {
      console.error(`✖ ${university.slug}: inserting professors failed — ${insErr.message}`);
      hadError = true;
      continue;
    }
  }

  totalProfessorsInserted += toInsert.length;
  totalProfessorsSkipped += skipped;
  console.log(
    `✓ ${university.name.padEnd(40)} +${toInsert.length} professors` +
      (skipped ? ` (${skipped} already present)` : ''),
  );
}

console.log(
  `\nDone — ${files.length} university file(s). Professors inserted: ${totalProfessorsInserted}, ` +
    `skipped (already there): ${totalProfessorsSkipped}.`,
);

process.exit(hadError ? 1 : 0);
