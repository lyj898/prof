import { createClient } from '@supabase/supabase-js';

// Client-side Supabase client. The dashboard is a client:only React island, so all
// reads/writes happen live from the browser. The anon key is public by design;
// RLS restricts access to authenticated users.
const url = import.meta.env.PUBLIC_SUPABASE_URL;
const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

// Guard so a missing .env.local produces a clear on-screen message instead of a
// cryptic createClient crash.
export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true, // keep the anonymous session across visits
        autoRefreshToken: true,
      },
    })
  : null;

// PostgREST caps a single select() at 1000 rows by default. The professors table
// has grown well past that, so any "give me everything" query needs to page through
// .range() until a short page tells us we've hit the end.
export async function fetchAllRows<T>(
  table: string,
  select: string,
  filter?: (query: any) => any,
): Promise<{ data: T[]; error: { message: string } | null }> {
  if (!supabase) return { data: [], error: null };
  const pageSize = 1000;
  const all: T[] = [];
  let from = 0;
  while (true) {
    let query = supabase.from(table).select(select).range(from, from + pageSize - 1);
    if (filter) query = filter(query);
    const { data, error } = await query;
    if (error) return { data: all, error };
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return { data: all, error: null };
}
