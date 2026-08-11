-- Professor Directory — initial schema
-- Pure reference directory: universities + the professors/faculty within them. No
-- outreach status, no priority/tier ranking, no CRM/pipeline tracking.

-- ── Enums ────────────────────────────────────────────────────────────────────
create type institution_type as enum ('Universitas','Institut','Politeknik','Sekolah Tinggi','Akademi');

-- Indonesian academic-rank ladder (jenjang jabatan fungsional) plus common
-- leadership titles found on faculty pages. Doesn't map 1:1 onto US ranks.
create type professor_title as enum (
  'Guru Besar',
  'Lektor Kepala',
  'Lektor',
  'Asisten Ahli',
  'Dosen',
  'Dekan',
  'Wakil Dekan',
  'Ketua Jurusan/Prodi',
  'Guru Besar Emeritus'
);

-- ── Tables ───────────────────────────────────────────────────────────────────
create table universities (
  id         uuid primary key default gen_random_uuid(),
  slug       text unique not null,
  name       text not null,
  type       institution_type not null,
  city       text not null,
  province   text not null,
  website    text,
  created_at timestamptz default now()
);

create table professors (
  id             uuid primary key default gen_random_uuid(),
  university_id  uuid references universities(id) on delete cascade,
  name           text not null,
  department     text,             -- faculty/department, e.g. "Fakultas Ilmu Komputer"
  title          professor_title not null default 'Dosen',
  research_area  text,
  email          text,
  phone          text,
  linkedin       text,
  google_scholar text,
  website        text,             -- personal/faculty page
  notes          text,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

create index professors_university_id_idx on professors (university_id);

-- Keep updated_at fresh on every professors update.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger professors_set_updated_at
  before update on professors
  for each row
  execute function set_updated_at();

-- ── Row Level Security ───────────────────────────────────────────────────────
-- Enable RLS on both tables; any authenticated user gets full read/write.
-- No anon access.
alter table universities enable row level security;
alter table professors   enable row level security;

create policy "universities: full access for authenticated"
  on universities
  for all
  to authenticated
  using (true)
  with check (true);

create policy "professors: full access for authenticated"
  on professors
  for all
  to authenticated
  using (true)
  with check (true);
