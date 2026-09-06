/**
 * Read-only audit for duplicate organizations across the FULL `organizations`
 * table. The sync matcher already compares incoming records against every
 * stored row; this script still pairs the live table against itself so a
 * reviewer can see every collision the current matcher would flag.
 *
 * Pairs accepted only via the parenthetical-acronym signal (score below both
 * overlap thresholds) are printed first for human review. Nothing is merged.
 *
 * Nothing is written. Usage:
 *   npx tsx scripts/audit-duplicate-organizations.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createIngestClient } from "../src/lib/ingestion/eoir/client";
import {
  organizationSourceFamily,
  organizationSourceLabel,
  type OrganizationSourceFamily,
} from "../src/lib/ingestion/eoir/constants";
import { DuplicateMatcher, zipFromAddress } from "../src/lib/ingestion/eoir/match";
import type { MatchCandidate } from "../src/lib/ingestion/eoir/match";

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
  org_type: string | null;
  verified: boolean | null;
};

function source(row: Row): string {
  return organizationSourceLabel(row.legacy_id);
}

function family(row: Row): OrganizationSourceFamily {
  return organizationSourceFamily(row.legacy_id);
}

async function fetchAllRows(supabase: Awaited<ReturnType<typeof createIngestClient>>) {
  const rows: Row[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("organizations")
      .select("id, name, city, state, address, legacy_id, org_type, verified")
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

  const byBucket = new Map<string, number>();
  for (const row of rows) {
    const bucket = source(row);
    byBucket.set(bucket, (byBucket.get(bucket) ?? 0) + 1);
  }
  console.log("Source breakdown (display labels; svc-* and keyless are both curated):");
  for (const [bucket, count] of [...byBucket.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count.toString().padStart(5)}  ${bucket}`);
  }

  const byFamily = new Map<OrganizationSourceFamily, number>();
  for (const row of rows) {
    const bucket = family(row);
    byFamily.set(bucket, (byFamily.get(bucket) ?? 0) + 1);
  }
  console.log("Family breakdown:");
  for (const [bucket, count] of [...byFamily.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count.toString().padStart(5)}  ${bucket}`);
  }

  // Deliberately ignore legacy_id when building the candidate pool — this is
  // the full-dataset audit, not a re-run of the sync-time matcher.
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
  const pairs: Array<{
    a: Row;
    b: Row;
    score: number;
    sameZip: boolean;
    matchedOn: string[];
    via: "overlap" | "acronym";
  }> = [];

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
      seenPairs.add(pairKey);

      const other = byId.get(match.candidate.id);
      if (!other) continue;

      pairs.push({
        a: row,
        b: other,
        score: match.score,
        sameZip: match.sameZip,
        matchedOn: match.matchedOn,
        via: match.via,
      });
    }
  }

  pairs.sort((x, y) => y.score - x.score);

  const acronymOnly = pairs.filter((p) => p.via === "acronym");
  const overlapPairs = pairs.filter((p) => p.via === "overlap");
  const familiesOf = (p: (typeof pairs)[number]) =>
    new Set([family(p.a), family(p.b)]);
  const isEoirFamily = (f: OrganizationSourceFamily) =>
    f === "eoir_roster" || f === "eoir_probono";
  const crossSource = overlapPairs.filter((p) => {
    const families = familiesOf(p);
    return families.has("curated") && [...families].some(isEoirFamily);
  });
  const curatedVsCurated = overlapPairs.filter(
    (p) => family(p.a) === "curated" && family(p.b) === "curated",
  );
  const sameEoirNamespace = overlapPairs.filter((p) => {
    const fa = family(p.a);
    return fa === family(p.b) && isEoirFamily(fa);
  });
  const eoirRosterVsProBono = overlapPairs.filter((p) => {
    const families = familiesOf(p);
    return families.has("eoir_roster") && families.has("eoir_probono");
  });
  const invisibleToSyncMatcher = pairs.filter(
    (p) => p.a.legacy_id !== null && p.b.legacy_id !== null,
  );

  function printPair({
    a,
    b,
    score,
    sameZip,
    matchedOn,
    via,
  }: (typeof pairs)[number]) {
    const srcA = source(a);
    const srcB = source(b);
    const bothKeyed = a.legacy_id !== null && b.legacy_id !== null;

    console.log(
      `\n  via ${via}  score ${score.toFixed(2)}  ${sameZip ? "(same ZIP)" : "(city only)"}  matched on: ${matchedOn.join(", ") || "(name only)"}`,
    );
    console.log(`  [${srcA}]`);
    console.log(`    name        ${a.name}`);
    console.log(`    address     ${a.address ?? "—"}`);
    console.log(`    city/state  ${a.city ?? "—"}, ${a.state ?? "—"}`);
    console.log(`    legacy_id   ${a.legacy_id ?? "NULL"}`);
    console.log(`    id          ${a.id}`);
    console.log(`  [${srcB}]`);
    console.log(`    name        ${b.name}`);
    console.log(`    address     ${b.address ?? "—"}`);
    console.log(`    city/state  ${b.city ?? "—"}, ${b.state ?? "—"}`);
    console.log(`    legacy_id   ${b.legacy_id ?? "NULL"}`);
    console.log(`    id          ${b.id}`);
    if (bothKeyed) {
      console.log(`    ⚠ both rows already have a legacy_id`);
    }
  }

  console.log(`\n${"═".repeat(78)}`);
  console.log(
    `SECTION 0 — NEWLY CAUGHT VIA PARENTHETICAL ACRONYM (human review, no merge): ${acronymOnly.length}`,
  );
  console.log(
    "These pairs sit below both overlap thresholds and were accepted only because",
  );
  console.log(
    "a short branded name's only non-city token equals a parenthetical acronym.",
  );
  console.log(`${"═".repeat(78)}`);
  for (const pair of acronymOnly) printPair(pair);

  console.log(`\n${"═".repeat(78)}`);
  console.log(`SECTION 1 — CROSS-SOURCE DUPLICATES (overlap, curated × EOIR): ${crossSource.length}`);
  console.log("One hand-entered row and one EOIR-sourced row (roster or pro bono).");
  console.log("svc-* and keyless are both curated; they do not count as cross-source.");
  console.log(`${"═".repeat(78)}`);
  for (const pair of crossSource) printPair(pair);

  console.log(`\n\n${"═".repeat(78)}`);
  console.log(`SECTION 1b — CURATED × CURATED MATCHER HITS: ${curatedVsCurated.length}`);
  console.log("Two hand-entered rows (svc-* seed and/or keyless). Outside the EOIR");
  console.log("sync's scope — a different kind of duplicate, if they are duplicates.");
  console.log(`${"═".repeat(78)}`);
  for (const pair of curatedVsCurated) printPair(pair);

  if (eoirRosterVsProBono.length > 0) {
    console.log(`\n\n${"═".repeat(78)}`);
    console.log(`SECTION 1c — EOIR ROSTER × PRO BONO: ${eoirRosterVsProBono.length}`);
    console.log(`${"═".repeat(78)}`);
    for (const pair of eoirRosterVsProBono) printPair(pair);
  }

  console.log(`\n\n${"═".repeat(78)}`);
  console.log(`SECTION 2 — SAME-SOURCE EOIR REPEATS: ${sameEoirNamespace.length}`);
  console.log("Same org name + city, both rows from one EOIR list. Often a");
  console.log("genuinely distinct office at a different street address (check the");
  console.log("address column) — but some may be roster-side duplicates.");
  console.log(`${"═".repeat(78)}`);
  for (const pair of sameEoirNamespace) printPair(pair);

  console.log(`\n\n${"═".repeat(78)}`);
  console.log("SUMMARY");
  console.log(`${"═".repeat(78)}`);
  console.log(`  total pairs                            ${pairs.length}`);
  console.log(`  newly caught (acronym signal only)     ${acronymOnly.length}`);
  console.log(`  overlap cross-source (curated × eoir)  ${crossSource.length}`);
  console.log(`  overlap curated × curated              ${curatedVsCurated.length}`);
  console.log(`  overlap same-source EOIR repeats       ${sameEoirNamespace.length}`);
  console.log(`  overlap roster × pro bono              ${eoirRosterVsProBono.length}`);
  console.log(`  pairs with both rows already keyed     ${invisibleToSyncMatcher.length}`);
  console.log(`  (a later ingest of either name would skip rather than insert)`);
  console.log(`${"═".repeat(78)}`);
  console.log("\nRead-only audit. Nothing was written.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
