import type { PricingLabel } from "@/types/immimap";

/** Landing page that links the current R&A roster PDFs. */
export const EOIR_RA_PAGE_URL =
  "https://www.justice.gov/eoir/recognition-accreditation-roster-reports";

/**
 * Link text of the roster variant we ingest. The href behind it is a numeric
 * justice.gov media id that changes when EOIR republishes, so the fetcher
 * resolves the URL by matching this label instead of hardcoding an id.
 */
export const EOIR_RA_BY_STATE_LINK_LABEL =
  "Organizations and Representatives, Listed by State";

/**
 * Last known good URL for the by-state roster. Only used if label matching
 * fails, so a page redesign degrades to a stale-but-valid document rather
 * than an empty run.
 */
export const EOIR_RA_BY_STATE_FALLBACK_URL =
  "https://www.justice.gov/eoir/media/1398081/dl?inline";

/** Pro Bono list of legal service providers, published as a two-column PDF. */
export const EOIR_PRO_BONO_PAGE_URL =
  "https://www.justice.gov/eoir/list-pro-bono-legal-service-providers";
export const EOIR_PRO_BONO_LIST_URL =
  "https://www.justice.gov/eoir/file/probonofulllist/download";
export const EOIR_PRO_BONO_LINK_LABEL = "List of Pro Bono Legal Service Providers";

/** Free, key-less US Census Bureau geocoder. */
export const CENSUS_GEOCODER_BATCH_URL =
  "https://geocoding.geo.census.gov/geocoder/locations/addressbatch";
export const CENSUS_GEOCODER_ONELINE_URL =
  "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

/** Census address-range benchmark. "Current" tracks the live TIGER data. */
export const CENSUS_BENCHMARK = "Public_AR_Current";

/**
 * Census documents a 10,000-record ceiling, but large uploads routinely take
 * minutes and time out. Smaller batches complete reliably and let a single
 * failure cost only part of the run.
 */
export const CENSUS_BATCH_LIMIT = 500;

/** Attempts per batch before its addresses are recorded as failures. */
export const CENSUS_BATCH_ATTEMPTS = 3;

/** Roster downloads are ~1MB; allow generous headroom on cold cron starts. */
export const FETCH_TIMEOUT_MS = 60_000;
/** Per-batch budget. A 500-row batch normally returns in well under a minute. */
export const GEOCODE_TIMEOUT_MS = 90_000;

/**
 * Floor for a trustworthy parse. The roster held ~1,558 offices as of
 * 2026-08; a result far below this means the layout changed and the run
 * should be treated as suspect rather than silently deleting coverage.
 */
export const MIN_EXPECTED_RECORDS = 900;

/**
 * Floor for the pro bono list after same-office court listings are
 * collapsed. The July 2026 edition yielded ~170 unique offices; a result
 * far below this means the two-column layout moved.
 */
export const MIN_EXPECTED_PRO_BONO_RECORDS = 80;

/**
 * DOJ recognition under 8 C.F.R. § 1292.11 requires providing services at
 * no or nominal cost, so every recognized organization maps to pro bono.
 */
export const EOIR_DEFAULT_PRICING: PricingLabel = "Pro bono";

export const EOIR_SOURCE_ATTRIBUTION =
  "EOIR Recognition & Accreditation (R&A) roster";

export const EOIR_PRO_BONO_SOURCE_ATTRIBUTION =
  "EOIR List of Pro Bono Legal Service Providers";

/** Prefix for synthesized natural keys, matching existing rows. */
export const EOIR_KEY_PREFIX = "doj-ra";

/** Prefix for pro bono list keys. Distinct from the R&A roster scheme. */
export const EOIR_PRO_BONO_KEY_PREFIX = "doj-probono";

/**
 * Recognition under 8 C.F.R. Part 1292 means representing clients before
 * U.S. immigration courts, which operate in English — a safe baseline
 * inference, but only an inference. Never extended with guessed languages
 * (Spanish, Mandarin, etc.); those stay empty until a human confirms them.
 */
export const EOIR_ASSUMED_LANGUAGES: readonly string[] = ["English"];

export function isEoirLegacyId(legacyId: string | null | undefined): boolean {
  return typeof legacyId === "string" && legacyId.startsWith(`${EOIR_KEY_PREFIX}-`);
}

export function isEoirProBonoLegacyId(
  legacyId: string | null | undefined,
): boolean {
  return (
    typeof legacyId === "string" &&
    legacyId.startsWith(`${EOIR_PRO_BONO_KEY_PREFIX}-`)
  );
}

/**
 * Coarse ingest family for duplicate audits. `svc-*` seed keys and keyless
 * hand-entered rows are both curated — comparing their display labels as if
 * they were different sources was how CRLA Sacramento vs LSNC landed in the
 * curated × EOIR tally.
 */
export type OrganizationSourceFamily =
  | "curated"
  | "eoir_roster"
  | "eoir_probono";

export function organizationSourceFamily(
  legacyId: string | null | undefined,
): OrganizationSourceFamily {
  if (isEoirLegacyId(legacyId)) return "eoir_roster";
  if (isEoirProBonoLegacyId(legacyId)) return "eoir_probono";
  return "curated";
}

/** Fine-grained label for printing. Do not use inequality of these as "cross-source". */
export function organizationSourceLabel(
  legacyId: string | null | undefined,
): string {
  if (!legacyId) return "curated (keyless)";
  if (isEoirLegacyId(legacyId)) return "eoir_organizations";
  if (isEoirProBonoLegacyId(legacyId)) return "eoir_probono";
  if (legacyId.startsWith("svc-")) return "curated (svc- seed)";
  return `curated (${legacyId.split("-")[0]}- seed)`;
}
