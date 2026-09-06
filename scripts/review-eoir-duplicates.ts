/**
 * Cross-references existing key-less `organizations` rows against a saved
 * EOIR sync plan, using the same matcher the sync itself uses.
 *
 * The sync reports duplicates from the roster's point of view ("this record
 * resembles an existing row"). This inverts that: for each key-less row, does
 * the plan intend to insert a second copy of it, and if not, why not. That is
 * the view needed to decide whether a plan is safe to apply.
 *
 * Read-only. Requires a plan from: npm run db:sync-eoir -- --report
 *
 * Usage:
 *   npx tsx scripts/review-eoir-duplicates.ts [path-to-plan.json]
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createIngestClient } from "../src/lib/ingestion/eoir/client";
import {
  DuplicateMatcher,
  zipFromAddress,
  zipFromNaturalKey,
} from "../src/lib/ingestion/eoir/match";
import type { MatchCandidate } from "../src/lib/ingestion/eoir/match";
import type { PlannedChange } from "../src/lib/ingestion/eoir/types";

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

/** PostgREST's default max-rows. Unpaged `.select()` silently stops here. */
const POSTGREST_PAGE_SIZE = 1000;

type KeylessRow = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  address: string | null;
  org_type: string | null;
};

async function fetchKeylessRows(
  supabase: Awaited<ReturnType<typeof createIngestClient>>,
): Promise<KeylessRow[]> {
  const rows: KeylessRow[] = [];
  for (let from = 0; ; from += POSTGREST_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("organizations")
      .select("id, name, city, state, address, org_type")
      .is("legacy_id", null)
      .order("name")
      .order("id")
      .range(from, from + POSTGREST_PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as KeylessRow[]));
    if (data.length < POSTGREST_PAGE_SIZE) break;
  }
  return rows;
}

async function main() {
  const planPath =
    process.argv[2] ?? join(root, "scripts", "reports", "eoir-sync-plan.json");

  if (!existsSync(planPath)) {
    console.error(
      `No plan at ${planPath}.\nRun: npm run db:sync-eoir -- --report`,
    );
    process.exit(1);
  }

  const report = JSON.parse(readFileSync(planPath, "utf8")) as {
    plan?: PlannedChange[];
  };
  const plan = report.plan ?? [];

  if (plan.length === 0) {
    console.error("Plan contains no per-record entries (was --report used?).");
    process.exit(1);
  }

  const supabase = await createIngestClient();
  const keyless = await fetchKeylessRows(supabase);

  const candidates: MatchCandidate[] = keyless.map((row) => ({
    id: row.id,
    name: row.name,
    city: row.city,
    state: row.state,
    zip: zipFromAddress(row.address),
  }));

  const matcher = new DuplicateMatcher(
    plan.map((change) => change.name),
    candidates,
  );

  // Invert the matcher's output: keyed by existing row rather than by record.
  const hits = new Map<string, Array<{ change: PlannedChange; score: number }>>();

  for (const change of plan) {
    if (change.action !== "insert") continue;

    for (const match of matcher.findMatches({
      name: change.name,
      city: change.city,
      state: change.state,
      zip: zipFromNaturalKey(change.naturalKey),
    })) {
      const bucket = hits.get(match.candidate.id) ?? [];
      bucket.push({ change, score: match.score });
      hits.set(match.candidate.id, bucket);
    }
  }

  const paired = keyless.filter((row) => hits.has(row.id));
  const absent = keyless.filter((row) => !hits.has(row.id));
  const lawFirms = absent.filter((row) => row.org_type === "Law Firm").length;

  console.log(`
EOIR plan × existing key-less rows
────────────────────────────────────────────────
plan records            ${plan.length}
key-less existing rows  ${keyless.length}

would be duplicated     ${paired.length}
no roster counterpart   ${absent.length}
`);

  console.log(`DUPLICATE PAIRS (${paired.length})`);
  console.log("─".repeat(72));

  for (const row of paired) {
    console.log(
      `\n  existing  "${row.name}"\n            ${row.city ?? "?"}, ${row.state ?? "?"} ${zipFromAddress(row.address) ?? ""}  [${row.org_type ?? "unknown"}]`,
    );

    for (const { change, score } of hits.get(row.id) ?? []) {
      console.log(
        `  roster    "${change.name}"\n            ${change.city}, ${change.state} ${zipFromNaturalKey(change.naturalKey) ?? ""}  (score ${score.toFixed(2)})`,
      );
    }
  }

  console.log(`\n\nNO COUNTERPART IN THE ROSTER (${absent.length})`);
  console.log("─".repeat(72));
  for (const row of absent) {
    console.log(
      `  ${row.name} — ${row.city ?? "?"}, ${row.state ?? "?"}  [${row.org_type ?? "unknown"}]`,
    );
  }

  // Law firms cannot appear on the roster: recognition under 8 C.F.R.
  // § 1292.11 is limited to non-profit organizations.
  console.log(`
────────────────────────────────────────────────
${lawFirms} of the ${absent.length} unmatched rows are private law firms, which are
ineligible for EOIR recognition and can never appear in this roster.
`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
