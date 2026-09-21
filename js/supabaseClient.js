import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Ropero comparte el proyecto Supabase de Launch Control, pero vive en su
// propio schema de Postgres ("ropero") para no mezclar datos ni tablas.
export const supabase = createClient(
  window.APP_CONFIG.SUPABASE_URL,
  window.APP_CONFIG.SUPABASE_ANON_KEY,
  { db: { schema: "ropero" } }
);
