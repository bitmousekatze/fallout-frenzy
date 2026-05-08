import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL ?? "https://vcszgmnofrldtdsomdsx.supabase.co";
const key = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjc3pnbW5vZnJsZHRkc29tZHN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5NTk4MjMsImV4cCI6MjA5MDUzNTgyM30.fmrv1slHgTDRWoSpu96i1w1SScu_s2KXrUkq0BekABY";

export const supabase = createClient(url, key);
