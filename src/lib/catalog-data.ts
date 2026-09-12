import servicesExpansionJson from "@/data/services-expansion.json";
import servicesJson from "@/data/services.json";
import type { ImmigrationService } from "@/types/immimap";
import { canonicalizeWebsiteUrl } from "@/lib/website-corrections";
import { isEoirLegacyId } from "@/lib/ingestion/eoir/constants";

/**
 * Offline snapshot of `organizations`, used when Supabase is not configured.
 * Regenerated from production with `npm run db:export-catalog` — do not edit
 * the JSON by hand (see docs/manual-data-corrections.md).
 */
export function getCatalogServices(): ImmigrationService[] {
  const rows = [
    ...(servicesJson as ImmigrationService[]),
    ...(servicesExpansionJson as ImmigrationService[]),
  ];
  return rows.map((service) => ({
    ...service,
    website: canonicalizeWebsiteUrl(service.website) ?? service.website,
    // Honor the exported flag. Inferring Verified from NGO type would badge
    // every EOIR roster row, most of which have never been manually reviewed.
    verified: service.verified === true,
    eoirSourced: service.eoirSourced ?? isEoirLegacyId(service.id),
  }));
}
