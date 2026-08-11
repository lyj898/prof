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
