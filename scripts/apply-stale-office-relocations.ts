/**
 * Relocate three confirmed stale office addresses and re-geocode the pins.
 *
 * Usage:
 *   npx tsx scripts/apply-stale-office-relocations.ts
 *   npx tsx scripts/apply-stale-office-relocations.ts --apply
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createIngestClient } from "../src/lib/ingestion/eoir/client";
import { censusGeocoder } from "../src/lib/ingestion/eoir/geocode";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const APPLY_REPORT_PATH = join(
  __dirname,
  "reports/stale-office-relocations-apply.json",
);

type Relocation = {
  id: string;
  name: string;
  fromAddress: string;
  toAddress: string;
  geocodeStreet: string;
  city: string;
  state: string;
  zip: string;
};

const RELOCATIONS: Relocation[] = [
  {
    id: "2dc4817d-0f58-4fb4-b213-ce4839df8bf3",
    name: "Human Rights First",
    fromAddress: "75 Broad Street, 31st Floor, New York, NY 10004",
    toAddress: "121 W 36th Street, PMB 520, New York, NY 10018",
    geocodeStreet: "121 W 36th Street",
    city: "New York",
    state: "NY",
    zip: "10018",
  },
  {
    id: "8b72f250-3b0b-4da9-b8bc-214b9aaa1f50",
    name: "Human Rights First",
    fromAddress: "805 15th Street, NW, Suite 900, Washington, DC 20005",
    toAddress: "825 21st Street NW, PMB 253, Washington, DC 20006",
    geocodeStreet: "825 21st Street NW",
    city: "Washington",
    state: "DC",
    zip: "20006",
  },
  {
    id: "7cac35e7-479e-4f6a-b9bb-b92fa34f359f",
    name: "Tahirih Justice Center",
    fromAddress: "230 Peachtree Street NW, Suite 1960, Atlanta, GA 30303",
    toAddress: "550 Pharr Road NE, Suite 215, Atlanta, GA 30305",
    geocodeStreet: "550 Pharr Road NE",
    city: "Atlanta",
    state: "GA",
    zip: "30305",
  },
];

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

async function main() {
  const apply = process.argv.includes("--apply");
  const client = await createIngestClient();
  const ids = RELOCATIONS.map((row) => row.id);

  const { data: existing, error: readError } = await client
    .from("organizations")
    .select("id, name, city, state, address, lat, lng")
    .in("id", ids);
  if (readError) {
    throw new Error(`Failed to read rows: ${readError.message}`);
  }
  const byId = new Map(
    (existing ?? []).map((row) => [row.id as string, row]),
  );

  const geocodes = await censusGeocoder.geocode(
    RELOCATIONS.map((row) => ({
      id: row.id,
      street: row.geocodeStreet,
      city: row.city,
      state: row.state,
      zip: row.zip,
    })),
  );

  const plan = RELOCATIONS.map((row) => {
    const current = byId.get(row.id);
    const geocode = geocodes.get(row.id);
    return {
      id: row.id,
      name: row.name,
      city: row.city,
      state: row.state,
      fromAddress: current?.address ?? null,
      fromLat: current?.lat ?? null,
      fromLng: current?.lng ?? null,
      expectedFrom: row.fromAddress,
      toAddress: row.toAddress,
      geocode,
    };
  });

  const unmatched = plan.filter(
    (row) => row.geocode?.status !== "matched" || row.geocode.lat == null,
  );
  const addressMismatch = plan.filter(
    (row) => row.fromAddress !== row.expectedFrom,
  );

  console.log(
    `\nStale office relocations (${apply ? "WRITE" : "dry-run"})` +
      `\n  rows ${plan.length}` +
      `\n  census matched ${plan.length - unmatched.length}` +
      `\n  address mismatch ${addressMismatch.length}\n`,
  );
  for (const row of plan) {
    console.log(
      `  ${row.id}  ${row.fromAddress}  →  ${row.toAddress}` +
        `\n    pin ${row.fromLat}, ${row.fromLng}  →  ${row.geocode?.lat}, ${row.geocode?.lng}` +
        `  (${row.geocode?.matchedAddress ?? row.geocode?.status})`,
    );
  }

  if (!apply) {
    mkdirSync(dirname(APPLY_REPORT_PATH), { recursive: true });
    writeFileSync(
      APPLY_REPORT_PATH,
      JSON.stringify({ generatedAt: new Date().toISOString(), apply, plan }, null, 2),
    );
    console.log(`\nDry-run plan written to ${APPLY_REPORT_PATH}`);
    console.log("Re-run with --apply to write.\n");
    return;
  }

  if (unmatched.length) {
    throw new Error(
      `Census did not match: ${unmatched.map((row) => row.id).join(", ")}`,
    );
  }
  if (addressMismatch.length) {
    throw new Error(
      `Stored address changed since review: ${addressMismatch
        .map((row) => row.id)
        .join(", ")}`,
    );
  }

  const failures: Array<{ id: string; error: string }> = [];
  const results = [];
  for (const row of plan) {
    const { data, error } = await client
      .from("organizations")
      .update({
        address: row.toAddress,
        lat: row.geocode?.lat,
        lng: row.geocode?.lng,
      })
      .eq("id", row.id)
      .eq("address", row.expectedFrom)
      .select("id, address, lat, lng");
    if (error) {
      failures.push({ id: row.id, error: error.message });
      continue;
    }
    if (!data?.length) {
      failures.push({ id: row.id, error: "update missed (address changed)" });
      continue;
    }
    results.push(data[0]);
  }

  mkdirSync(dirname(APPLY_REPORT_PATH), { recursive: true });
  writeFileSync(
    APPLY_REPORT_PATH,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), apply, plan, results, failures },
      null,
      2,
    ),
  );

  console.log(`\n  wrote     ${results.length}`);
  console.log(`  failures  ${failures.length}`);
  console.log(`  report    ${APPLY_REPORT_PATH}\n`);
  if (failures.length || results.length !== 3) {
    throw new Error(`Expected 3 writes, got ${results.length}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
