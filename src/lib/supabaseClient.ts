import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let browserClient: SupabaseClient | null = null;

/**
 * Next.js patches `fetch` and caches GET by URL. PostgREST pagination lives
 * in the Range header, so a cached first page would be replayed forever.
 */
function uncachedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return fetch(input, { ...init, cache: "no-store" });
}

export function createSupabaseClient(): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: uncachedFetch },
  });
}

/** Singleton for client components and server reads using the anon key. */
export function getSupabaseClient(): SupabaseClient {
  if (!browserClient) {
    browserClient = createSupabaseClient();
  }
  return browserClient;
}

/** Server-only client for API mutations (bypasses RLS when service role is set). */
export function getSupabaseAdminClient(): SupabaseClient {
  const adminKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !adminKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or Supabase credentials for admin operations.",
    );
  }

  return createClient(url, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: uncachedFetch },
  });
}

export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey);
}
