// Shared types + the enum option lists that drive the form dropdowns and pill filters.
// Keep these in sync with the Postgres enums in supabase/migrations/20260811000001_init.sql.

export const INSTITUTION_TYPES = [
  'Universitas',
  'Institut',
  'Politeknik',
  'Sekolah Tinggi',
  'Akademi',
] as const;
export type InstitutionType = (typeof INSTITUTION_TYPES)[number];

export const PROFESSOR_TITLES = [
  'Guru Besar',
  'Lektor Kepala',
  'Lektor',
  'Asisten Ahli',
  'Dosen',
  'Dekan',
  'Wakil Dekan',
  'Ketua Jurusan/Prodi',
  'Guru Besar Emeritus',
] as const;
export type ProfessorTitle = (typeof PROFESSOR_TITLES)[number];

export interface University {
  id: string;
  slug: string;
  name: string;
  type: InstitutionType;
  city: string;
  province: string;
  website: string | null;
  created_at: string;
}

export interface Professor {
  id: string;
  university_id: string;
  name: string;
  department: string | null;
  title: ProfessorTitle;
  research_area: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  google_scholar: string | null;
  website: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// A university row plus the count of its professors, as rendered in the table.
export interface UniversityWithCount extends University {
  professor_count: number;
}

// Fields the user edits when creating a university (id/slug/created_at handled elsewhere).
export type UniversityFormValues = {
  name: string;
  type: InstitutionType;
  city: string;
  province: string;
  website: string;
};

// Fields the user edits when adding/editing a professor.
export type ProfessorFormValues = {
  name: string;
  department: string;
  title: ProfessorTitle;
  research_area: string;
  email: string;
  phone: string;
  linkedin: string;
  google_scholar: string;
  website: string;
  notes: string;
};
