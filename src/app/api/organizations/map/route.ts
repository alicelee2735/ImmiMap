import { jsonWithCache, MAP_ORGANIZATIONS_CACHE_CONTROL } from "@/lib/api-cache";
import { getErrorMessage } from "@/lib/errors";
import { fetchMapOrganizations } from "@/lib/organizations";
import { isSupabaseConfigured } from "@/lib/supabaseClient";

export const revalidate = 600;

export async function GET() {
  if (!isSupabaseConfigured()) {
    return Response.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  }

  try {
    const services = await fetchMapOrganizations();
    return jsonWithCache(
      { services },
      { cacheControl: MAP_ORGANIZATIONS_CACHE_CONTROL },
    );
  } catch (error) {
    const message = getErrorMessage(error, "Failed to fetch organizations.");
    return Response.json({ error: message }, { status: 500 });
  }
}
