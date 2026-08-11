# Professor Directory

Internal reference directory of Indonesian universities and their professors/faculty —
built to support YOUR Venture (a Y Ventures Group program) outreach to academia.

This is a **pure reference directory** — universities and professors only. No outreach
status tracking, no priority/tier ranking, no CRM/pipeline fields.

## Stack

- **Astro** with the dashboard as a single `client:only` React island (`src/pages/index.astro`).
- **Supabase** (Postgres + Auth). Anonymous-sign-in-with-email-allowlist, no public signup.
- **xlsx** (SheetJS) for client-side Excel export.

## Local setup

Requires Node 18+ and npm.

```bash
npm install
```

### 1. Supabase project

Create a Supabase project (via the dashboard or CLI), then link it:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
```

### 2. Apply the schema

```bash
npm run db:push
```

This runs `supabase/migrations/..._init.sql` — enums, `universities` + `professors`
tables, indexes, `updated_at` trigger, and RLS (full access for any authenticated user,
no anon access). Migrations are **schema only**; seed data is handled by the seed script
(below).

(No CLI? Paste `..._init.sql` into the Supabase dashboard SQL editor and run it.)

### 3. Environment

Copy the example and fill in values from **Supabase → Project Settings → API**:

```bash
cp .env.example .env.local
```

```
PUBLIC_SUPABASE_URL="https://YOUR-PROJECT-REF.supabase.co"
PUBLIC_SUPABASE_ANON_KEY="YOUR-ANON-PUBLIC-KEY"
```

`.env.local` is gitignored — never commit it.

### 4. Auth settings (Supabase dashboard)

- **Authentication → Sign In / Providers:** enable "Allow anonymous sign-ins".
- **Authentication → Sign In / Providers:** enable "Allow new users to sign up".
- **Authentication → URL Configuration → Site URL / Redirect URLs:** add
  `http://localhost:4321` (and `https://prof.yvjobs.online` once deployed).
- The team allow-list lives in `src/lib/allowlist.ts` (currently a single email:
  `alex@yventures.com.sg`) — this is a soft UI gate, not real per-user auth.

### 5. Run

```bash
npm run dev
```

Open <http://localhost:4321>, sign in with the allow-listed email.

## Populating data (seed)

University data lives as one JSON file per university in **`data/universities/`** (source
of truth, version-controlled). To load or update the database, run:

```bash
npm run seed
```

Requires `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` (see step 3). The script
(`scripts/seed.mjs`) upserts through the Supabase API:

- **universities** — upserted by `slug` (re-running updates fields from the JSON).
- **professors** — inserted only when no professor with the same `name` already exists
  for that university, so edits made in the app UI are never overwritten.

It's idempotent — safe to run as often as you like.

### Adding a university / professor

1. Create or edit `data/universities/<slug>.json` (copy an existing one as a template).
   Shape:
   ```json
   {
     "slug": "universitas-indonesia",
     "name": "Universitas Indonesia",
     "type": "Universitas",
     "city": "Depok",
     "province": "Jawa Barat",
     "website": "https://www.ui.ac.id",
     "professors": [
       {
         "name": "Prof. …",
         "department": "Fakultas Ilmu Komputer",
         "title": "Guru Besar",
         "research_area": "…",
         "email": null,
         "phone": null,
         "linkedin": null,
         "google_scholar": null,
         "website": null,
         "notes": "…"
       }
     ]
   }
   ```
   Enum fields must match the DB: `type` (Universitas/Institut/Politeknik/Sekolah
   Tinggi/Akademi), `title` (Guru Besar/Lektor Kepala/Lektor/Asisten Ahli/Dosen/
   Dekan/Wakil Dekan/Ketua Jurusan/Prodi/Guru Besar Emeritus).
2. **Only include professors you can verify** from a public source (university faculty
   page, LinkedIn, Google Scholar). Leave fields `null` rather than guessing, and note
   the source / any uncertainty in `notes`.
3. `npm run seed`.

The `data/universities/*.json` files currently cover all ~161 universities (seeded from
the sibling `yourventure` Campus Directory's list) but with **empty `professors` arrays**
except for Universitas Indonesia, which has a small sample of verified professors. Populate
the rest incrementally, university by university.

## Deployment

Deployed as a static site to **GitHub Pages** at `prof.yvjobs.online`. Every push to
`main` triggers `.github/workflows/deploy.yml` (build → Pages). The public build is safe:
the browser only ever holds the publishable key, and all data is gated by RLS + the auth
allow-list.
