import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.REACT_APP_SUPABASE_URL;

const supabaseKey =
  process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY ||
  process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error(
    "Missing REACT_APP_SUPABASE_URL",
  );
}

if (!supabaseKey) {
  throw new Error(
    "Missing Supabase publishable/anon key",
  );
}

export const supabase = createClient(
  supabaseUrl,
  supabaseKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);