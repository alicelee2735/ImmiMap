import type {
  CreateOrganizationInput,
  OrganizationFilters,
  OrganizationWithServices,
  UpdateOrganizationInput,
} from "@/types/database.types";
import {
  getSupabaseAdminClient,
  getSupabaseClient,
  isSupabaseConfigured,
} from "@/lib/supabaseClient";
import { canonicalizeWebsiteUrl } from "@/lib/website-corrections";
import { parseLanguageEvidence } from "@/lib/language-evidence";
import {
  parseWebsiteScope,
  toMapImmigrationService,
} from "@/lib/organization-mappers";
import type { ImmigrationService } from "@/types/immimap";

export { organizationToImmigrationService } from "@/lib/organization-mappers";

type OrgRow = {
  id: string;
  name: string;
  description: string | null;
  website_url: string | null;
  website_scope?: "local" | "parent" | null;
  is_website_active?: boolean | null;
  website_checked_at?: string | null;
  website_check_error?: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
  legacy_id: string | null;
  org_type: "NGO" | "Law Firm" | null;
  pricing: string | null;
  thumbnail_image_url: string | null;
  intake_status: "OPEN" | "LIMITED" | "WAITLISTED" | null;
  languages: string[] | null;
  languages_confirmed?: boolean | null;
  languages_evidence?: unknown;
  catchment_note: string | null;
  verified?: boolean | null;
  org_services: Array<{
    services: { id?: string; name: string } | null;
  }>;
};

const CORE_ORG_FIELDS = `
  id,
  name,
  description,
  website_url,
  address,
  city,
  state,
  lat,
  lng,
  legacy_id,
  org_type,
  pricing,
  thumbnail_image_url,
  intake_status,
  languages,
  languages_confirmed,
  catchment_note,
  verified
`;

const LINK_STATUS_FIELDS = `
  is_website_active,
  website_checked_at,
  website_check_error
`;

const MAP_ORG_FIELDS = `
  id,
  name,
  address,
  city,
  state,
  lat,
  lng,
  legacy_id,
  org_type,
  pricing,
  languages,
  verified
`;

function buildOrgSelect(
  category?: string,
  includeLinkStatus = true,
  includeWebsiteScope = true,
  includeLanguagesEvidence = true,
) {
  const extras = [
    includeWebsiteScope ? "website_scope" : null,
    includeLanguagesEvidence ? "languages_evidence" : null,
    includeLinkStatus ? LINK_STATUS_FIELDS : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(",\n  ");
  const fields = extras ? `${CORE_ORG_FIELDS},\n  ${extras}` : CORE_ORG_FIELDS;
  const orgServices = category
    ? "org_services!inner ( services!inner ( id, name ) )"
    : "org_services ( services ( id, name ) )";

  return `${fields}, ${orgServices}`;
}

function isMissingLinkStatusColumnError(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return (
    message.includes("is_website_active") ||
    message.includes("website_checked_at") ||
    message.includes("website_check_error") ||
    error.code === "42703" ||
    error.code === "PGRST204"
  );
}

function isMissingWebsiteScopeColumnError(
  error: { message?: string; code?: string } | null,
): boolean {
  if (!error) return false;
  return (error.message ?? "").includes("website_scope");
}

function isMissingLanguagesEvidenceColumnError(
  error: { message?: string; code?: string } | null,
): boolean {
  if (!error) return false;
  return (error.message ?? "").includes("languages_evidence");
}

function mapRow(row: OrgRow): OrganizationWithServices | null {
  if (
    row.lat == null ||
    row.lng == null ||
    !row.city ||
    !row.state
  ) {
    return null;
  }

  const services = (row.org_services ?? [])
    .map((link) => link.services)
    .filter((service): service is { id?: string; name: string } =>
      Boolean(service?.name),
    )
    .map((service) => ({
      id: service.id ?? "",
      name: service.name,
    }));

  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    website_url: canonicalizeWebsiteUrl(row.website_url ?? undefined),
    website_scope: parseWebsiteScope(row.website_scope),
    is_website_active: row.is_website_active ?? true,
    website_checked_at: row.website_checked_at ?? null,
    website_check_error: row.website_check_error ?? null,
    address: row.address ?? undefined,
    city: row.city,
    state: row.state,
    lat: row.lat,
    lng: row.lng,
    services,
    legacy_id: row.legacy_id ?? undefined,
    org_type: row.org_type ?? undefined,
    pricing: row.pricing ?? undefined,
    thumbnail_image_url: row.thumbnail_image_url ?? undefined,
    intake_status: row.intake_status ?? undefined,
    languages: row.languages ?? undefined,
    languages_confirmed: row.languages_confirmed ?? undefined,
    languages_evidence: parseLanguageEvidence(row.languages_evidence),
    catchment_note: row.catchment_note ?? undefined,
    verified: row.verified === true,
  };
}

async function resolveServiceIds(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  serviceNames: string[],
): Promise<string[]> {
  const ids: string[] = [];

  for (const name of serviceNames) {
    const { data: existing } = await supabase
      .from("services")
      .select("id")
      .eq("name", name)
      .maybeSingle();

    if (existing) {
      ids.push(existing.id);
      continue;
    }

    const { data: created, error } = await supabase
      .from("services")
      .insert({ name })
      .select("id")
      .single();

    if (error) {
      throw error;
    }

    ids.push(created.id);
  }

  return ids;
}

async function linkOrgServices(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  orgId: string,
  serviceNames: string[],
) {
  await supabase.from("org_services").delete().eq("org_id", orgId);

  if (serviceNames.length === 0) {
    return;
  }

  const serviceIds = await resolveServiceIds(supabase, serviceNames);
  const links = serviceIds.map((serviceId) => ({
    org_id: orgId,
    service_id: serviceId,
  }));

  const { error } = await supabase.from("org_services").insert(links);
  if (error) {
    throw error;
  }
}

/** PostgREST's default max-rows. Unpaged `.select()` silently stops here. */
const POSTGREST_PAGE_SIZE = 1000;

export async function fetchOrganizations(
  filters: OrganizationFilters = {},
): Promise<OrganizationWithServices[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const supabase = getSupabaseAdminClient();
  const states = filters.state
    ? Array.isArray(filters.state)
      ? filters.state
      : [filters.state]
    : [];

  const loadPage = (
    from: number,
    includeLinkStatus: boolean,
    includeWebsiteScope: boolean,
    includeLanguagesEvidence: boolean,
  ) => {
    let query = supabase
      .from("organizations")
      .select(
        buildOrgSelect(
          filters.category,
          includeLinkStatus,
          includeWebsiteScope,
          includeLanguagesEvidence,
        ),
      )
      .order("name")
      .order("id")
      .range(from, from + POSTGREST_PAGE_SIZE - 1);

    if (filters.name) {
      query = query.ilike("name", `%${filters.name}%`);
    }
    if (filters.city) {
      query = query.ilike("city", `%${filters.city}%`);
    }
    if (states.length === 1) {
      query = query.eq("state", states[0]);
    } else if (states.length > 1) {
      query = query.in("state", states);
    }
    if (filters.category) {
      query = query.eq("org_services.services.name", filters.category);
    }

    return query;
  };

  const loadPages = async (
    includeLinkStatus: boolean,
    includeWebsiteScope: boolean,
    includeLanguagesEvidence: boolean,
  ) => {
    const rows: OrgRow[] = [];
    for (let from = 0; ; from += POSTGREST_PAGE_SIZE) {
      const { data, error } = await loadPage(
        from,
        includeLinkStatus,
        includeWebsiteScope,
        includeLanguagesEvidence,
      );
      if (error) return { rows, error };
      if (!data || data.length === 0) break;
      rows.push(...(data as unknown as OrgRow[]));
      if (data.length < POSTGREST_PAGE_SIZE) break;
    }
    return { rows, error: null };
  };

  let includeLinkStatus = true;
  let includeWebsiteScope = true;
  let includeLanguagesEvidence = true;
  let { rows, error } = await loadPages(
    includeLinkStatus,
    includeWebsiteScope,
    includeLanguagesEvidence,
  );

  if (isMissingWebsiteScopeColumnError(error)) {
    includeWebsiteScope = false;
    ({ rows, error } = await loadPages(
      includeLinkStatus,
      includeWebsiteScope,
      includeLanguagesEvidence,
    ));
  }
  if (isMissingLanguagesEvidenceColumnError(error)) {
    includeLanguagesEvidence = false;
    ({ rows, error } = await loadPages(
      includeLinkStatus,
      includeWebsiteScope,
      includeLanguagesEvidence,
    ));
  }
  // Pre-migration environments: fall back without link-status columns.
  if (isMissingLinkStatusColumnError(error)) {
    includeLinkStatus = false;
    ({ rows, error } = await loadPages(
      includeLinkStatus,
      includeWebsiteScope,
      includeLanguagesEvidence,
    ));
  }

  if (error) {
    throw error;
  }

  return rows
    .map(mapRow)
    .filter((org): org is OrganizationWithServices => org !== null);
}

/**
 * Slim catalog for the map: every mappable point, without detail-sheet
 * fields (description, website, website_scope, intake, catchment,
 * languages_evidence).
 */
export async function fetchMapOrganizations(): Promise<ImmigrationService[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const supabase = getSupabaseAdminClient();
  const select = `${MAP_ORG_FIELDS}, org_services ( services ( name ) )`;
  const rows: OrgRow[] = [];

  for (let from = 0; ; from += POSTGREST_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("organizations")
      .select(select)
      .order("name")
      .order("id")
      .range(from, from + POSTGREST_PAGE_SIZE - 1);

    if (error) {
      throw error;
    }
    if (!data || data.length === 0) break;
    rows.push(...(data as unknown as OrgRow[]));
    if (data.length < POSTGREST_PAGE_SIZE) break;
  }

  return rows
    .map(mapRow)
    .filter((org): org is OrganizationWithServices => org !== null)
    .map(toMapImmigrationService)
    .filter((service): service is ImmigrationService => service !== null);
}

export async function createOrganization(
  input: CreateOrganizationInput,
): Promise<OrganizationWithServices> {
  const supabase = getSupabaseAdminClient();
  const { service_names = [], ...orgFields } = input;

  // Select without link-status columns so create works before and after migration 006.
  let { data, error } = await supabase
    .from("organizations")
    .insert(orgFields)
    .select(buildOrgSelect(undefined, false, true, true))
    .single();

  if (isMissingWebsiteScopeColumnError(error)) {
    const retry = await supabase
      .from("organizations")
      .insert(orgFields)
      .select(buildOrgSelect(undefined, false, false, true))
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (isMissingLanguagesEvidenceColumnError(error)) {
    const retry = await supabase
      .from("organizations")
      .insert(orgFields)
      .select(buildOrgSelect(undefined, false, false, false))
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error || !data) {
    throw error ?? new Error("Failed to create organization.");
  }

  const row = data as unknown as OrgRow;

  if (service_names.length > 0) {
    await linkOrgServices(supabase, row.id, service_names);
    const refreshed = await fetchOrganizationById(row.id);
    if (!refreshed) {
      throw new Error("Failed to load organization after create.");
    }
    return refreshed;
  }

  const mapped = mapRow(row);
  if (!mapped) {
    throw new Error("Created organization is missing required location fields.");
  }

  return mapped;
}

export async function fetchOrganizationById(
  id: string,
): Promise<OrganizationWithServices | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const supabase = getSupabaseClient();
  let includeLinkStatus = true;
  let includeWebsiteScope = true;
  let includeLanguagesEvidence = true;
  let { data, error } = await supabase
    .from("organizations")
    .select(
      buildOrgSelect(
        undefined,
        includeLinkStatus,
        includeWebsiteScope,
        includeLanguagesEvidence,
      ),
    )
    .eq("id", id)
    .maybeSingle();

  if (isMissingWebsiteScopeColumnError(error)) {
    includeWebsiteScope = false;
    const retry = await supabase
      .from("organizations")
      .select(
        buildOrgSelect(
          undefined,
          includeLinkStatus,
          includeWebsiteScope,
          includeLanguagesEvidence,
        ),
      )
      .eq("id", id)
      .maybeSingle();
    data = retry.data;
    error = retry.error;
  }

  if (isMissingLanguagesEvidenceColumnError(error)) {
    includeLanguagesEvidence = false;
    const retry = await supabase
      .from("organizations")
      .select(
        buildOrgSelect(
          undefined,
          includeLinkStatus,
          includeWebsiteScope,
          includeLanguagesEvidence,
        ),
      )
      .eq("id", id)
      .maybeSingle();
    data = retry.data;
    error = retry.error;
  }

  if (isMissingLinkStatusColumnError(error)) {
    includeLinkStatus = false;
    const retry = await supabase
      .from("organizations")
      .select(
        buildOrgSelect(
          undefined,
          includeLinkStatus,
          includeWebsiteScope,
          includeLanguagesEvidence,
        ),
      )
      .eq("id", id)
      .maybeSingle();
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  return mapRow(data as unknown as OrgRow);
}

export async function updateOrganization(
  id: string,
  input: UpdateOrganizationInput,
): Promise<OrganizationWithServices> {
  const supabase = getSupabaseAdminClient();
  const { service_names, ...orgFields } = input;

  if (Object.keys(orgFields).length > 0) {
    const { error } = await supabase
      .from("organizations")
      .update(orgFields)
      .eq("id", id);

    if (error) {
      throw error;
    }
  }

  if (service_names) {
    await linkOrgServices(supabase, id, service_names);
  }

  const refreshed = await fetchOrganizationById(id);
  if (!refreshed) {
    throw new Error("Organization not found after update.");
  }

  return refreshed;
}

export async function deleteOrganization(id: string): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase.from("organizations").delete().eq("id", id);

  if (error) {
    throw error;
  }
}

export type ServiceCategoryCount = {
  name: string;
  count: number;
};

/**
 * Live provider counts per service category, derived from the same
 * organization rows shown on the map (valid lat/lng + city/state). Used by
 * the homepage "wayfinding board" hero — never hardcode these numbers.
 */
export async function fetchServiceCategoryCounts(): Promise<ServiceCategoryCount[]> {
  const organizations = await fetchOrganizations();
  const counts = new Map<string, number>();

  for (const org of organizations) {
    for (const service of org.services) {
      counts.set(service.name, (counts.get(service.name) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function parseOrganizationFilters(
  searchParams: URLSearchParams,
): OrganizationFilters {
  const states = searchParams.getAll("state").filter(Boolean);
  const category = searchParams.get("category") ?? undefined;

  return {
    name: searchParams.get("name") ?? undefined,
    city: searchParams.get("city") ?? undefined,
    state: states.length > 1 ? states : states[0],
    category: category || undefined,
  };
}
