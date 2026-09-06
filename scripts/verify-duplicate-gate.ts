/**
 * Read-only verification that the two EOIR sync structural fixes actually
 * close the gap the audit found:
 *
 *  1. planChanges()'s DuplicateMatcher candidate pool now includes every
 *     existing row, regardless of legacy_id scheme.
 *  2. syncEoirOrganizations() now blocks (skips) an insert outright when a
 *     record matches an existing row above the matcher's acceptance
 *     threshold, instead of inserting it and merely flagging it.
 *
 * For each of the cross-source pairs the audit found (a curated row and an
 * already-synced `doj-ra-*` row describing the same real office), this
 * script simulates "what if the EOIR side had not been synced yet": it
 * removes that row from the candidate set and re-derives a roster-shaped
 * record from its own stored data, then runs the record back through the
 * FIXED planChanges(). If the fix works, the result is never a fresh
 * `insert` — it is a `skip` that names the curated row as the match, i.e.
 * the same duplicate is resolvable via a legacy_id backfill onto the
 * curated row rather than ever becoming a second row in the first place.
 *
 * Nothing is written. Usage:
 *   npx tsx scripts/verify-duplicate-gate.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createIngestClient } from "../src/lib/ingestion/eoir/client";
import { organizationSourceFamily } from "../src/lib/ingestion/eoir/constants";
import { DuplicateMatcher, zipFromAddress } from "../src/lib/ingestion/eoir/match";
import type { MatchCandidate } from "../src/lib/ingestion/eoir/match";
import { buildNaturalKey } from "../src/lib/ingestion/eoir/normalize";
import { planChanges } from "../src/lib/ingestion/eoir/sync-organizations";
import type { ExistingRow } from "../src/lib/ingestion/eoir/sync-organizations";
import type { EoirOfficeRecord } from "../src/lib/ingestion/eoir/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

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

type Row = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  address: string | null;
  legacy_id: string | null;
  lat: number | null;
  lng: number | null;
  description: string | null;
  pricing: string | null;
  intake_status: string | null;
};

function sourceFamily(row: Row) {
  return organizationSourceFamily(row.legacy_id);
}

/** Strips ", City, ST ZIP" off the end of a stored `address` value. */
function streetFromAddress(address: string, city: string | null): string {
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

function toExistingRow(row: Row): ExistingRow {
  return {
    id: row.id,
    legacy_id: row.legacy_id,
    name: row.name,
    city: row.city,
    state: row.state,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    description: row.description,
    pricing: row.pricing,
    intake_status: row.intake_status,
    // Not fetched by this script's query; irrelevant to the duplicate-gate
    // behavior being verified here.
    languages: null,
  };
}

/** Rebuilds a roster-shaped record from an already-synced EOIR row. */
function toSyntheticRecord(row: Row): EoirOfficeRecord {
  const zip = zipFromAddress(row.address) ?? "";
  const street = streetFromAddress(row.address ?? "", row.city);
  return {
    name: row.name,
    officeLabel: null,
    street,
    city: row.city ?? "",
    // EoirOfficeRecord.state is typed USState; every stored row here already
    // came from the EOIR roster, so it is always a valid two-letter code.
    state: (row.state ?? "") as EoirOfficeRecord["state"],
    zip,
    phone: null,
    dateRecognized: null,
    expirationDate: null,
    status: null,
    pendingRenewal: false,
    sourcePage: 0,
  };
}

async function fetchAllRows(supabase: Awaited<ReturnType<typeof createIngestClient>>) {
  const rows: Row[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("organizations")
      .select(
        "id, name, city, state, address, legacy_id, lat, lng, description, pricing, intake_status",
      )
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as Row[]));
    if (data.length < pageSize) break;
  }
  return rows;
}

async function main() {
  const supabase = await createIngestClient();
  console.log("Fetching all organizations…");
  const rows = await fetchAllRows(supabase);
  console.log(`  ${rows.length} rows total\n`);

  // Recompute the audit's cross-source pairs fresh, using the exact same
  // unrestricted candidate pool as scripts/audit-duplicate-organizations.ts.
  const candidates: MatchCandidate[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    city: row.city,
    state: row.state,
    zip: zipFromAddress(row.address),
  }));
  const matcher = new DuplicateMatcher(rows.map((r) => r.name), candidates);
  const byId = new Map(rows.map((row) => [row.id, row]));

  const seenPairs = new Set<string>();
  const crossSourcePairs: Array<{ eoir: Row; curated: Row; score: number }> = [];

  for (const row of rows) {
    const matches = matcher.findMatches({
      name: row.name,
      city: row.city ?? "",
      state: row.state ?? "",
      zip: zipFromAddress(row.address),
    });
    for (const match of matches) {
      if (match.candidate.id === row.id) continue;
      const pairKey = [row.id, match.candidate.id].sort().join("|");
      if (seenPairs.has(pairKey)) continue;
      const other = byId.get(match.candidate.id);
      if (!other) continue;
      if (sourceFamily(row) === sourceFamily(other)) continue;

      seenPairs.add(pairKey);
      const eoir = sourceFamily(row) === "eoir_roster" ? row : other;
      const curated = eoir === row ? other : row;
      // Only pairs where exactly one side is the EOIR roster row are the
      // "same office, two namespaces" scenario this fix targets. svc-* and
      // keyless are both curated and must not enter this set.
      if (sourceFamily(eoir) !== "eoir_roster") continue;
      if (sourceFamily(curated) !== "curated") continue;

      crossSourcePairs.push({ eoir, curated, score: match.score });
    }
  }

  console.log(`Found ${crossSourcePairs.length} cross-source pairs to verify.\n`);

  // Simulate the whole roster syncing again against a database where these
  // pairs' EOIR side had not landed yet — as ONE planChanges() call, so the
  // matcher's rarity weighting is computed from a realistic, roster-sized
  // corpus rather than a single name (which would badly distort the
  // corroborated-match scores this fix is meant to catch).
  const targetIds = new Set(crossSourcePairs.map((p) => p.eoir.id));
  const eoirRows = rows.filter((row) => row.legacy_id?.startsWith("doj-ra-"));
  const allSyntheticRecords = eoirRows.map(toSyntheticRecord);
  const existingWithoutTargets = rows
    .filter((row) => !targetIds.has(row.id))
    .map(toExistingRow);

  const { changes, duplicates } = planChanges(
    allSyntheticRecords,
    existingWithoutTargets,
  );
  const changeByKey = new Map(changes.map((c) => [c.naturalKey, c]));
  const duplicatesByKey = new Map<string, typeof duplicates>();
  for (const d of duplicates) {
    const list = duplicatesByKey.get(d.naturalKey) ?? [];
    list.push(d);
    duplicatesByKey.set(d.naturalKey, list);
  }

  let blockedCorrectly = 0;
  let blockedWrongMatch = 0;
  let insertedAnyway = 0;
  const failures: string[] = [];

  for (const { eoir, curated, score } of crossSourcePairs) {
    const naturalKey = buildNaturalKey(toSyntheticRecord(eoir));
    const change = changeByKey.get(naturalKey);
    const matchesForRecord = duplicatesByKey.get(naturalKey) ?? [];

    if (!change || change.action === "insert") {
      insertedAnyway += 1;
      failures.push(
        `INSERT (not blocked): "${eoir.name}" (${eoir.city}, ${eoir.state}) — would create a fresh duplicate of curated row ${curated.id}`,
      );
      continue;
    }

    const matchedCurated = matchesForRecord.some((d) => d.existingId === curated.id);
    if (change.action === "skip" && matchedCurated) {
      blockedCorrectly += 1;
    } else {
      blockedWrongMatch += 1;
      failures.push(
        `BLOCKED, but not against the expected row: "${eoir.name}" (${eoir.city}, ${eoir.state}) — ` +
          `action=${change.action}, matched=${matchesForRecord.map((d) => d.existingId).join(",") || "none"}, expected=${curated.id} (audit score ${score.toFixed(2)})`,
      );
    }
  }

  console.log(`${"═".repeat(78)}`);
  console.log("VERIFICATION RESULT");
  console.log(`${"═".repeat(78)}`);
  console.log(
    `  correctly blocked, matched the right curated row   ${blockedCorrectly}`,
  );
  console.log(
    `  blocked, but matched a different/no row (bug)      ${blockedWrongMatch}`,
  );
  console.log(
    `  inserted anyway as a fresh duplicate (bug)         ${insertedAnyway}`,
  );
  console.log(`${"═".repeat(78)}`);

  if (failures.length > 0) {
    console.log("\nDetails on non-clean results:");
    for (const failure of failures) console.log(`  • ${failure}`);
  } else {
    console.log(
      "\nEvery cross-source pair simulated as a fresh sync run is now blocked" +
        " and correctly points at the curated row it duplicates — resolvable" +
        " via a legacy_id backfill, never a fresh insert.",
    );
  }

  console.log("\nRead-only verification. Nothing was written.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
