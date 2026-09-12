/**
 * Seeds organizations, services, and org_services from services.json +
 * services-expansion.json. For an empty local database only — do not run
 * against production (it upserts by legacy_id and would clobber live rows).
 *
 * Those JSON files are a fallback snapshot. Refresh them from production
 * with `npm run db:export-catalog` after manual corrections; see
 * docs/manual-data-corrections.md.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-organizations.mjs
 */
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const servicesPath = join(root, "src/data/services.json");
const expansionPath = join(root, "src/data/services-expansion.json");
const envPath = join(root, ".env.local");

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(envPath);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: ws },
});

const raw = [
  ...JSON.parse(readFileSync(servicesPath, "utf8")),
  ...JSON.parse(readFileSync(expansionPath, "utf8")),
];

function cityFromAddress(address) {
  const parts = address.split(",").map((part) => part.trim());
  if (parts.length >= 3) {
    return parts[parts.length - 2];
  }
  return null;
}

async function upsertServiceOffering(name) {
  const { data: existing, error: selectError } = await supabase
    .from("services")
    .select("id")
    .eq("name", name)
    .maybeSingle();

  if (selectError) {
    throw selectError;
  }

  if (existing) {
    return existing.id;
  }

  const { data, error } = await supabase
    .from("services")
    .insert({ name })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return data.id;
}

async function seed() {
  const offeringIds = new Map();

  for (const entry of raw) {
    for (const offering of entry.services_offered ?? []) {
      if (!offeringIds.has(offering)) {
        offeringIds.set(offering, await upsertServiceOffering(offering));
      }
    }
  }

  for (const entry of raw) {
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .upsert(
        {
          legacy_id: entry.id,
          name: entry.name,
          description: entry.description ?? null,
          website_url: entry.website ?? null,
          address: entry.address,
          city: cityFromAddress(entry.address),
          state: entry.state,
          lat: entry.latitude,
          lng: entry.longitude,
          org_type: entry.type,
          pricing: entry.pricing,
          thumbnail_image_url: entry.thumbnail_image_url,
          intake_status: entry.intakeStatus ?? null,
          languages: entry.languages ?? null,
          catchment_note: entry.catchmentNote ?? null,
          verified: entry.verified === true,
          languages_confirmed: entry.languagesConfirmed ?? true,
        },
        { onConflict: "legacy_id" },
      )
      .select("id")
      .single();

    if (orgError) {
      throw orgError;
    }

    await supabase.from("org_services").delete().eq("org_id", org.id);

    const links = (entry.services_offered ?? []).map((offering) => ({
      org_id: org.id,
      service_id: offeringIds.get(offering),
    }));

    if (links.length > 0) {
      const { error: linkError } = await supabase
        .from("org_services")
        .insert(links);

      if (linkError) {
        throw linkError;
      }
    }

    console.log(`Seeded: ${entry.name}`);
  }

  console.log(`Done. Seeded ${raw.length} organizations.`);
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
