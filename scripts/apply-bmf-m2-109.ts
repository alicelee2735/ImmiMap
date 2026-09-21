/**
 * Insert the Milestone 2 keyword 990/EZ net-new BMF organizations.
 *
 * Honesty defaults: HQ mailing (not an office), unverified, no service tags,
 * no language assumption, no pricing/intake claim. Providence EIN 47-3515841
 * is stored under its DBA "Refugee Dream Center" so it does not collide on
 * the map with Lansing's Refugee Development Center.
 *
 * Usage:
 *   npx tsx scripts/apply-bmf-m2-109.ts
 *   npx tsx scripts/apply-bmf-m2-109.ts --apply
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createIngestClient } from "../src/lib/ingestion/eoir/client";
import { censusGeocoder } from "../src/lib/ingestion/eoir/geocode";
import { IRS_EO_KEY_PREFIX } from "../src/lib/ingestion/eoir/constants";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const REVIEW_PATH = join(__dirname, "reports/bmf-m2-109-review.json");
const APPLY_REPORT_PATH = join(__dirname, "reports/bmf-m2-109-apply.json");

const CATCHMENT_NOTE =
  "IRS EO BMF HQ mailing address, not a confirmed service office.";

const DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  "473515841": "Refugee Dream Center",
  "263936253": "Refugee Development Center",
};

const SMALL_WORDS = new Set(["a", "an", "and", "at", "for", "in", "of", "the", "to"]);

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile(join(root, ".env.local"));

type ReviewRow = {
  ein: string;
  legacy_id: string;
  name: string;
  ntee: string;
  hq_mailing_address: string;
};

function titleCase(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && SMALL_WORDS.has(lower)) return lower;
      if (lower === "inc") return "Inc.";
      if (lower === "llc") return "LLC";
      if (lower === "nfp") return "NFP";
      if (lower === "ltd") return "Ltd.";
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function displayName(row: ReviewRow): string {
  return DISPLAY_NAME_OVERRIDES[row.ein] ?? titleCase(row.name);
}

function parseHqAddress(address: string): {
  street: string;
  city: string;
  state: string;
  zip: string;
} {
  const match = address
    .trim()
    .match(/^(.*),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?$/);
  if (!match) {
    throw new Error(`Unparseable HQ mailing address: ${address}`);
  }
  return {
    street: match[1].trim(),
    city: titleCase(match[2]),
    state: match[3],
    zip: match[4],
  };
}

function geocodeStreet(street: string): string {
  const trimmed = street.trim();
  if (/^p\.?\s*o\.?\s*box\b/i.test(trimmed)) return "";
  return trimmed
    .replace(
      /\s+(ste|suite|fl|floor|apt|unit|pmb|#)\b.*$/i,
      "",
    )
    .trim();
}

async function main() {
  const apply = process.argv.includes("--apply");
  const review = JSON.parse(readFileSync(REVIEW_PATH, "utf8")) as ReviewRow[];
  if (review.length !== 109) {
    throw new Error(`Expected 109 review rows, got ${review.length}`);
  }

  const parsed = review.map((row) => {
    const parts = parseHqAddress(row.hq_mailing_address);
    return {
      ein: row.ein,
      legacy_id: `${IRS_EO_KEY_PREFIX}-${row.ein}`,
      irsLegalName: row.name,
      name: displayName(row),
      ntee: row.ntee,
      address: row.hq_mailing_address,
      ...parts,
      geocodeStreet: geocodeStreet(parts.street),
    };
  });

  const geocodes = await censusGeocoder.geocode(
    parsed.map((row) => ({
      id: row.ein,
      street: row.geocodeStreet,
      city: row.city,
      state: row.state,
      zip: row.zip,
    })),
  );

  const unmatched = parsed.filter((row) => {
    const hit = geocodes.get(row.ein);
    return hit?.status !== "matched" || hit.lat == null || hit.lng == null;
  });

  if (unmatched.length > 0) {
    const zipRetry = await censusGeocoder.geocode(
      unmatched.map((row) => ({
        id: row.ein,
        street: "",
        city: row.city,
        state: row.state,
        zip: row.zip,
      })),
    );
    for (const row of unmatched) {
      const hit = zipRetry.get(row.ein);
      const previous = geocodes.get(row.ein);
      if (
        hit?.status === "matched" &&
        hit.lat != null &&
        hit.lng != null &&
        (previous?.status !== "matched" || previous.lat == null)
      ) {
        geocodes.set(row.ein, { ...hit, error: "zip-level fallback" });
      }
    }
  }

  const payloads = parsed.map((row) => {
    const geo = geocodes.get(row.ein);
    const matched = geo?.status === "matched" && geo.lat != null && geo.lng != null;
    return {
      legacy_id: row.legacy_id,
      name: row.name,
      description: null,
      address: row.address,
      city: row.city,
      state: row.state,
      lat: matched ? geo.lat : null,
      lng: matched ? geo.lng : null,
      org_type: "NGO" as const,
      pricing: null,
      intake_status: null,
      languages: [] as string[],
      languages_confirmed: false,
      catchment_note: CATCHMENT_NOTE,
      address_role: "mailing" as const,
      verified: false,
      geocodeStatus: geo?.status ?? "missing",
      geocodeError: geo?.error ?? null,
      irsLegalName: row.irsLegalName,
    };
  });

  const mappable = payloads.filter((row) => row.lat != null && row.lng != null);
  const unmappable = payloads.filter((row) => row.lat == null || row.lng == null);

  const report = {
    generatedAt: new Date().toISOString(),
    apply,
    planned: payloads.length,
    mappable: mappable.length,
    unmappable: unmappable.length,
    providenceDba: payloads.find((row) => row.legacy_id === "irs-eo-473515841")?.name,
    lansingName: payloads.find((row) => row.legacy_id === "irs-eo-263936253")?.name,
    unmappableNames: unmappable.map((row) => ({
      legacy_id: row.legacy_id,
      name: row.name,
      address: row.address,
      geocodeStatus: row.geocodeStatus,
      geocodeError: row.geocodeError,
    })),
    wrote: 0,
  };

  mkdirSync(dirname(APPLY_REPORT_PATH), { recursive: true });
  writeFileSync(APPLY_REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        planned: report.planned,
        mappable: report.mappable,
        unmappable: report.unmappable,
        providenceDba: report.providenceDba,
        lansingName: report.lansingName,
        apply,
      },
      null,
      2,
    ),
  );

  if (!apply) {
    console.log(`dry-run; report ${APPLY_REPORT_PATH}`);
    return;
  }

  const client = await createIngestClient();
  const inserts = payloads.map((row) => ({
    legacy_id: row.legacy_id,
    name: row.name,
    description: row.description,
    address: row.address,
    city: row.city,
    state: row.state,
    lat: row.lat,
    lng: row.lng,
    org_type: row.org_type,
    pricing: row.pricing,
    intake_status: row.intake_status,
    languages: row.languages,
    languages_confirmed: row.languages_confirmed,
    catchment_note: row.catchment_note,
    address_role: row.address_role,
    verified: row.verified,
  }));

  const BATCH = 50;
  let wrote = 0;
  for (let i = 0; i < inserts.length; i += BATCH) {
    const batch = inserts.slice(i, i + BATCH);
    const { data, error } = await client
      .from("organizations")
      .upsert(batch, { onConflict: "legacy_id" })
      .select("legacy_id");
    if (error) throw new Error(error.message);
    wrote += data?.length ?? 0;
  }

  report.wrote = wrote;
  writeFileSync(APPLY_REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`wrote ${wrote}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
