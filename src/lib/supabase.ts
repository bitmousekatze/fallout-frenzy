import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL ?? "https://vcszgmnofrldtdsomdsx.supabase.co";
const key = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "sb_publishable_k020Q6QKO1yuGFm88KSg1w_EvZjpqm3";

export const supabase = createClient(url, key);
