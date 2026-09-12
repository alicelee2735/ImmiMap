/**
 * Snapshots the live `organizations` table into the static catalog used when
 * Supabase is not configured (volunteer first run, missing env, API 503).
 *
 * Writes:
 *   src/data/services.json            — curated rows (svc-* / keyless)
 *   src/data/services-expansion.json  — EOIR R&A and pro bono rows
 *
 * Together the two files should equal every mappable live org. Do not edit
 * them by hand; they will drift. After any manual address/name/merge/delete
 * on production, re-run this script and commit the JSON plus an entry in
 * docs/manual-data-corrections.md.
 *
 * Usage:
 *   npm run db:export-catalog
 *
 * Requires in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Do not use scripts/generate-expansion-orgs.mjs for this. That file is the
 * original synthetic seed list and would restore deleted/stale listings.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createIngestClient } from "../src/lib/ingestion/eoir/client";
import {
  isEoirLegacyId,
  organizationSourceFamily,
} from "../src/lib/ingestion/eoir/constants";
import { canonicalizeWebsiteUrl, wasWebsiteHostCorrected } from "../src/lib/website-corrections";
import type {
  ImmigrationService,
  PricingLabel,
  ProviderType,
  ServiceOffering,
  USState,
} from "../src/types/immimap";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const PAGE_SIZE = 1000;

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

type LiveRow = {
  id: string;
  name: string;
  description: string | null;
  website_url: string | null;
  is_website_active: boolean | null;
  address: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
  legacy_id: string | null;
  org_type: ProviderType | null;
  pricing: string | null;
  thumbnail_image_url: string | null;
  intake_status: ImmigrationService["intakeStatus"] | null;
  languages: string[] | null;
  languages_confirmed: boolean | null;
  catchment_note: string | null;
  verified: boolean | null;
  org_services: Array<{ services: { id: string; name: string } | null } | null>;
};

const SELECT = `
  id, name, description, website_url, is_website_active, address, city, state,
  lat, lng, legacy_id, org_type, pricing, thumbnail_image_url, intake_status,
  languages, languages_confirmed, catchment_note, verified,
  org_services ( services ( id, name ) )
`;

function toCatalogEntry(row: LiveRow): ImmigrationService | null {
  if (
    row.lat == null ||
    row.lng == null ||
    !row.city ||
    !row.state ||
    !row.address
  ) {
    return null;
  }

  const latitude = Number(row.lat);
  const longitude = Number(row.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const servicesOffered = (row.org_services ?? [])
    .map((link) => link?.services?.name)
    .filter((name): name is ServiceOffering => Boolean(name));

  const entry: ImmigrationService = {
    id: row.legacy_id ?? row.id,
    dbId: row.id,
    name: row.name,
    type: row.org_type ?? "NGO",
    state: row.state as USState,
    city: row.city,
    address: row.address,
    latitude,
    longitude,
    pricing: (row.pricing as PricingLabel) ?? "Low-cost",
    services_offered: servicesOffered,
    thumbnail_image_url: row.thumbnail_image_url ?? "",
    verified: row.verified === true,
    eoirSourced: isEoirLegacyId(row.legacy_id),
  };

  const website = canonicalizeWebsiteUrl(row.website_url);
  if (website) entry.website = website;
  entry.isWebsiteActive = wasWebsiteHostCorrected(row.website_url)
    ? true
    : (row.is_website_active ?? true);
  if (row.description) entry.description = row.description;
  if (row.intake_status) entry.intakeStatus = row.intake_status;
  if (row.languages && row.languages.length > 0) {
    entry.languages = row.languages;
  }
  entry.languagesConfirmed = row.languages_confirmed ?? true;
  if (row.catchment_note) entry.catchmentNote = row.catchment_note;

  return entry;
}

function sortEntries(a: ImmigrationService, b: ImmigrationService) {
  return (
    a.state.localeCompare(b.state) ||
    (a.city ?? "").localeCompare(b.city ?? "") ||
    a.name.localeCompare(b.name) ||
    a.id.localeCompare(b.id)
  );
}

async function main() {
  const supabase = await createIngestClient();
  const rows: LiveRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("organizations")
      .select(SELECT)
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as unknown as LiveRow[]));
    if (data.length < PAGE_SIZE) break;
  }

  const curated: ImmigrationService[] = [];
  const eoir: ImmigrationService[] = [];
  let skipped = 0;

  for (const row of rows) {
    const entry = toCatalogEntry(row);
    if (!entry) {
      skipped += 1;
      continue;
    }
    if (organizationSourceFamily(row.legacy_id) === "curated") {
      curated.push(entry);
    } else {
      eoir.push(entry);
    }
  }

  curated.sort(sortEntries);
  eoir.sort(sortEntries);

  const curatedPath = join(root, "src/data/services.json");
  const eoirPath = join(root, "src/data/services-expansion.json");
  writeFileSync(curatedPath, `${JSON.stringify(curated, null, 2)}\n`);
  writeFileSync(eoirPath, `${JSON.stringify(eoir, null, 2)}\n`);

  console.log(
    `Exported ${curated.length} curated → src/data/services.json`,
  );
  console.log(
    `Exported ${eoir.length} EOIR/pro bono → src/data/services-expansion.json`,
  );
  console.log(`Skipped ${skipped} live row(s) missing address/city/state/pin`);
  console.log(`Live rows read: ${rows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
