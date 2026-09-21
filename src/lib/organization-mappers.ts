import { isEoirLegacyId } from "@/lib/ingestion/eoir/constants";
import { parseLanguageEvidence } from "@/lib/language-evidence";
import { canonicalizeWebsiteUrl, wasWebsiteHostCorrected } from "@/lib/website-corrections";
import type { LanguageEvidence, OrganizationWithServices } from "@/types/database.types";
import type {
  ImmigrationService,
  PricingLabel,
  ServiceOffering,
  USState,
} from "@/types/immimap";

const PRICING_LABELS = new Set<PricingLabel>(["Pro bono", "Low-cost", "Paid"]);

/** Confirmed fee labels only. Null, blank, and unknown strings stay unknown. */
export function parsePricingLabel(value: unknown): PricingLabel | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return PRICING_LABELS.has(trimmed as PricingLabel)
    ? (trimmed as PricingLabel)
    : undefined;
}

export type WebsiteScope = "local" | "parent";

export function parseWebsiteScope(value: unknown): WebsiteScope | null {
  if (value === "local" || value === "parent") return value;
  return null;
}

/** Row shape both the full and map-index mappers accept. */
export type MappableOrganization = Pick<
  OrganizationWithServices,
  | "id"
  | "name"
  | "city"
  | "state"
  | "lat"
  | "lng"
> & {
  description?: string;
  website_url?: string;
  website_scope?: WebsiteScope | null;
  is_website_active?: boolean | null;
  address?: string;
  services: Array<{ id?: string; name: string }>;
  legacy_id?: string;
  org_type?: "NGO" | "Law Firm";
  pricing?: string;
  thumbnail_image_url?: string;
  intake_status?: OrganizationWithServices["intake_status"];
  languages?: string[];
  languages_confirmed?: boolean;
  languages_evidence?: LanguageEvidence[] | null;
  catchment_note?: string;
  verified?: boolean;
};

export function organizationToImmigrationService(
  org: MappableOrganization,
): ImmigrationService | null {
  if (!org.address) {
    return null;
  }

  const servicesOffered = org.services
    .map((service) => service.name)
    .filter((name): name is ServiceOffering => Boolean(name));

  const latitude = Number(org.lat);
  const longitude = Number(org.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const languagesEvidence = parseLanguageEvidence(org.languages_evidence);
  const pricing = parsePricingLabel(org.pricing);

  return {
    id: org.legacy_id ?? org.id,
    dbId: org.id,
    name: org.name,
    type: org.org_type ?? "NGO",
    state: org.state as USState,
    city: org.city,
    address: org.address,
    latitude,
    longitude,
    ...(pricing ? { pricing } : {}),
    services_offered: servicesOffered,
    thumbnail_image_url: org.thumbnail_image_url ?? "",
    website: canonicalizeWebsiteUrl(org.website_url),
    isWebsiteActive: wasWebsiteHostCorrected(org.website_url)
      ? true
      : (org.is_website_active ?? true),
    description: org.description,
    intakeStatus: org.intake_status,
    languages: org.languages,
    languagesConfirmed: org.languages_confirmed ?? true,
    ...(languagesEvidence.length > 0 ? { languagesEvidence } : {}),
    catchmentNote: org.catchment_note,
    verified: org.verified === true,
    eoirSourced: isEoirLegacyId(org.legacy_id),
    websiteScope: parseWebsiteScope(org.website_scope),
  };
}

/**
 * Pin / filter / search / result-card fields only. Detail-sheet fields
 * (description, website, websiteScope, intake, catchment, languagesEvidence)
 * stay off this payload and load from GET /api/organizations/[id].
 */
export function toMapImmigrationService(
  org: MappableOrganization,
): ImmigrationService | null {
  if (!org.address) {
    return null;
  }

  const servicesOffered = org.services
    .map((service) => service.name)
    .filter((name): name is ServiceOffering => Boolean(name));

  const latitude = Number(org.lat);
  const longitude = Number(org.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const pricing = parsePricingLabel(org.pricing);

  return {
    id: org.legacy_id ?? org.id,
    dbId: org.id,
    name: org.name,
    type: org.org_type ?? "NGO",
    state: org.state as USState,
    city: org.city,
    address: org.address,
    latitude,
    longitude,
    ...(pricing ? { pricing } : {}),
    services_offered: servicesOffered,
    thumbnail_image_url: "",
    languages: org.languages,
    verified: org.verified === true,
    eoirSourced: isEoirLegacyId(org.legacy_id),
  };
}
