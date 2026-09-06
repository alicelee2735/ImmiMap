/**
 * Maps parsed roster records onto the `organizations` schema.
 *
 * EOIR publishes no stable organization identifier, so the natural key is
 * synthesized. It must be deterministic across runs (or every sync inserts
 * duplicates) and unique per office (or co-located offices overwrite each
 * other — the roster really does list two distinct "Principal Office" rows
 * for the same organization, city and ZIP).
 */
import { createHash } from "node:crypto";

import {
  EOIR_ASSUMED_LANGUAGES,
  EOIR_DEFAULT_PRICING,
  EOIR_KEY_PREFIX,
  EOIR_PRO_BONO_KEY_PREFIX,
  EOIR_PRO_BONO_SOURCE_ATTRIBUTION,
  EOIR_SOURCE_ATTRIBUTION,
} from "@/lib/ingestion/eoir/constants";
import type {
  EoirOfficeRecord,
  GeocodeRequest,
  GeocodeResult,
} from "@/lib/ingestion/eoir/types";
import { canonicalizeWebsiteUrl } from "@/lib/website-corrections";
import {
  addressRoleFromLabel,
  type AddressRole,
} from "@/lib/ingestion/eoir/office-label";

/** Row shape written to `organizations`, excluding db-managed columns. */
export type OrganizationUpsert = {
  legacy_id: string;
  name: string;
  description: string;
  address: string;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
  org_type: "NGO" | "Law Firm";
  pricing: string;
  intake_status: "OPEN";
  /**
   * Inserts always land unverified. Updates must never write this column —
   * automated roster data is not a review.
   */
  verified: false;
  /** The English baseline inference — see EOIR_ASSUMED_LANGUAGES. */
  languages: string[];
  /**
   * Always false on a roster-authored row: this is an inference, never a
   * confirmed answer from the office. An update must never flip this back
   * to false once a human has confirmed a real language list (see
   * buildUpdatePayload), and never sets it true either.
   */
  languages_confirmed: false;
  website_url?: string;
  catchment_note?: string;
  /**
   * Physical vs mailing as declared on the listing. Omitted when the source
   * did not label one. Stored, not shown in the public UI today.
   */
  address_role?: AddressRole;
};

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/**
 * Collapses a street address to its semantic content so trivial edits
 * ("Suite"/"Ste.", "117 South Crest" vs "117 Southcrest") do not mint a new
 * key on the next run.
 */
export function normalizeStreet(street: string): string {
  return street
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(/\b(suite|ste|unit|apt|apartment|room|rm|floor|fl)\b/g, "ste")
    .replace(/\b(street|str)\b/g, "st")
    .replace(/\b(avenue|ave)\b/g, "ave")
    .replace(/\b(boulevard|blvd)\b/g, "blvd")
    .replace(/\b(road|rd)\b/g, "rd")
    .replace(/\b(drive|dr)\b/g, "dr")
    .replace(/\b(north|n)\b/g, "n")
    .replace(/\b(south|s)\b/g, "s")
    .replace(/\b(east|e)\b/g, "e")
    .replace(/\b(west|w)\b/g, "w")
    .replace(/\bpo box\b/g, "pobox")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/**
 * Street portion of a stored `address` ("131 Interpark Blvd, San Antonio, TX 78216").
 * Used by the post-sync proximity scan; the natural key is built from the
 * parsed street, not this reconstruction.
 */
export function streetFromStoredAddress(
  address: string,
  city: string | null,
): string {
  const trimmed = address.trim();
  if (!trimmed) return "";
  if (city?.trim()) {
    const marker = `, ${city.trim()},`;
    const idx = trimmed.toLowerCase().indexOf(marker.toLowerCase());
    if (idx !== -1) return trimmed.slice(0, idx).trim();
  }
  const parts = trimmed.split(",");
  if (parts.length <= 2) return parts[0]?.trim() ?? "";
  return parts.slice(0, -2).join(",").trim();
}

function addressFingerprint(street: string): string {
  return createHash("sha256")
    .update(normalizeStreet(street))
    .digest("hex")
    .slice(0, 8);
}

/**
 * Identity of one physical office, ignoring the legal name. Used to catch
 * same-batch fragments ("Immigration Clinic" vs the full UT Law name) that
 * mint different natural keys only because the name slug differs.
 */
export function addressIdentityKey(record: {
  street: string;
  state: string;
  zip: string;
}): string {
  return `${record.state}|${record.zip}|${normalizeStreet(record.street)}`;
}

/**
 * The pre-existing key format, without an address component. Retained so the
 * sync can recognize rows written by the previous ingest and re-key them in
 * place instead of inserting duplicates.
 */
export function buildLegacyKeyV1(
  record: EoirOfficeRecord,
  prefix: string = EOIR_KEY_PREFIX,
): string {
  return [
    prefix,
    slugify(record.name),
    slugify(record.city),
    record.zip,
  ].join("-");
}

/** Stable, collision-free natural key for one roster office. */
export function buildNaturalKey(
  record: EoirOfficeRecord,
  prefix: string = EOIR_KEY_PREFIX,
): string {
  return [
    prefix,
    slugify(record.name),
    slugify(record.city),
    record.zip,
    addressFingerprint(record.street),
  ].join("-");
}

function buildDescription(record: EoirOfficeRecord): string {
  const office = record.officeLabel ? ` (${record.officeLabel})` : "";
  const recognized = record.dateRecognized
    ? ` Recognized since ${record.dateRecognized}.`
    : "";
  const pending = record.pendingRenewal
    ? " Recognition renewal pending."
    : "";

  return (
    `DOJ-recognized nonprofit immigration legal service provider${office}.` +
    `${recognized}${pending} Source: ${EOIR_SOURCE_ATTRIBUTION}.`
  );
}

/**
 * The roster prints the street separately from the city/state/ZIP, but the
 * detail panel renders `address` on its own with no locality beside it, and
 * hand-seeded rows store the whole thing. Compose it so a roster row reads the
 * same as a curated one.
 */
export function formatAddress(record: EoirOfficeRecord): string {
  return `${record.street}, ${record.city}, ${record.state} ${record.zip}`;
}

export function toGeocodeRequest(
  record: EoirOfficeRecord,
  prefix: string = EOIR_KEY_PREFIX,
): GeocodeRequest {
  return {
    id: buildNaturalKey(record, prefix),
    street: record.street,
    city: record.city,
    state: record.state,
    zip: record.zip,
  };
}

/** Builds the row to upsert for one roster office. */
export function toOrganizationRow(
  record: EoirOfficeRecord,
  geocode: GeocodeResult | undefined,
): OrganizationUpsert {
  return {
    legacy_id: buildNaturalKey(record),
    name: record.name,
    description: buildDescription(record),
    address: formatAddress(record),
    city: record.city,
    state: record.state,
    lat: geocode?.lat ?? null,
    lng: geocode?.lng ?? null,
    // Recognition under 8 C.F.R. § 1292.11 is limited to non-profits.
    org_type: "NGO",
    pricing: EOIR_DEFAULT_PRICING,
    intake_status: "OPEN",
    // The Verified badge requires manual ImmiMap review; EOIR is not that.
    verified: false,
    // English is a safe baseline inference (see EOIR_ASSUMED_LANGUAGES doc),
    // but it is not a confirmed answer from the office.
    languages: [...EOIR_ASSUMED_LANGUAGES],
    languages_confirmed: false,
    ...optionalAddressRole(record),
  };
}

function formatProBonoCatchment(courts: string[]): string | undefined {
  if (courts.length === 0) return undefined;
  if (courts.length === 1) return `Listed by EOIR for ${courts[0]}.`;
  if (courts.length === 2) {
    return `Listed by EOIR for ${courts[0]} and ${courts[1]}.`;
  }
  return `Listed by EOIR for ${courts.slice(0, -1).join(", ")}, and ${courts[courts.length - 1]}.`;
}

/** Builds the row to upsert for one consolidated pro bono list office. */
export function toProBonoOrganizationRow(
  record: EoirOfficeRecord,
  geocode: GeocodeResult | undefined,
): OrganizationUpsert {
  const kindLabel =
    record.providerKind === "private_attorney"
      ? "private attorney"
      : record.providerKind === "referral"
        ? "referral service"
        : "nonprofit";

  const website = canonicalizeWebsiteUrl(record.website ?? undefined);
  const catchment = formatProBonoCatchment(record.courts ?? []);

  return {
    legacy_id: buildNaturalKey(record, EOIR_PRO_BONO_KEY_PREFIX),
    name: record.name,
    description:
      `EOIR-listed pro bono legal service provider (${kindLabel}). ` +
      `Source: ${EOIR_PRO_BONO_SOURCE_ATTRIBUTION}.`,
    address: formatAddress(record),
    city: record.city,
    state: record.state,
    lat: geocode?.lat ?? null,
    lng: geocode?.lng ?? null,
    org_type: record.providerKind === "private_attorney" ? "Law Firm" : "NGO",
    pricing: EOIR_DEFAULT_PRICING,
    intake_status: "OPEN",
    verified: false,
    languages: [...EOIR_ASSUMED_LANGUAGES],
    languages_confirmed: false,
    ...(website ? { website_url: website } : {}),
    ...(catchment ? { catchment_note: catchment } : {}),
    ...optionalAddressRole(record),
  };
}

function optionalAddressRole(
  record: EoirOfficeRecord,
): { address_role: AddressRole } | Record<string, never> {
  const role = addressRoleFromLabel(record.officeLabel);
  return role ? { address_role: role } : {};
}
