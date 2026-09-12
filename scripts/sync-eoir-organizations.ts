/**
 * Syncs the DOJ EOIR Recognition & Accreditation roster into `organizations`.
 *
 * Dry run is the default; nothing is written without --apply.
 *
 * Usage:
 *   npm run db:sync-eoir                 # dry run, prints the plan
 *   npm run db:sync-eoir -- --report     # dry run + JSON report file
 *   npm run db:sync-eoir -- --apply      # write to Supabase
 *   npm run db:sync-eoir -- --limit 25 --verbose
 *
 * Flags:
 *   --apply              perform writes (omit to preview)
 *   --limit <n>          only process the first n roster records
 *   --skip-geocode       parse and plan without calling the geocoder
 *   --no-regeocode       leave coordinates untouched even when filling a blank address
 *   --report [path]      write a JSON plan/duplicate report
 *   --verbose            progress logging
 *
 * Requires in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   (server-side only — never expose to clients)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { syncEoirOrganizations } from "../src/lib/ingestion/eoir/sync-organizations";
import { formatProximityFlag } from "../src/lib/ingestion/eoir/proximity-triage";

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

const argv = process.argv.slice(2);

function hasFlag(name: string): boolean {
  return argv.includes(`--${name}`);
}

function flagValue(name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const next = argv[index + 1];
  return next && !next.startsWith("--") ? next : undefined;
}

async function main() {
  const apply = hasFlag("apply");
  const limitRaw = flagValue("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  const wantsReport = hasFlag("report");

  if (limitRaw && (!Number.isFinite(limit) || (limit ?? 0) <= 0)) {
    console.error(`Invalid --limit value: ${limitRaw}`);
    process.exit(1);
  }

  const summary = await syncEoirOrganizations({
    apply,
    limit,
    skipGeocode: hasFlag("skip-geocode"),
    regeocodeExisting: !hasFlag("no-regeocode"),
    verbose: hasFlag("verbose"),
    includePlan: wantsReport,
  });

  const label = summary.dryRun ? "DRY RUN (no writes)" : "APPLIED";
  const verb = summary.dryRun ? "would be" : "were";

  console.log(`
EOIR organization sync — ${label}
────────────────────────────────────────────────
source            ${summary.sourceUrl}
roster updated    ${summary.reportUpdatedAt ?? "unknown"}
parser            ${summary.parser}
rows parsed       ${summary.rowsParsed}
rows processed    ${summary.rowsProcessed}

inserted          ${summary.inserted}    (${verb} created)
updated           ${summary.updated}
re-keyed          ${summary.rekeyed}     (v1 key → address-scoped key)
skipped           ${summary.skipped}     (matched an existing row — blocked, not inserted)
duplicates        ${summary.duplicatesFlagged}     (matches behind the skips above)

geocode matched   ${summary.geocodeMatched}
geocode failed    ${summary.geocodeFailed}
coords refreshed  ${summary.regeocodedExisting}
curated kept      ${summary.curatedPreserved}     (name/description/pricing/intake/address/lat-lng/verified left as-is)

duration          ${(summary.durationMs / 1000).toFixed(1)}s
status            ${summary.ok ? "ok" : "FAILED"}
`);

  if (summary.duplicateCandidates.length > 0) {
    console.log(
      `Skipped — blocked pending human resolution (${summary.skipped} record(s)):`,
    );
    for (const candidate of summary.duplicateCandidates.slice(0, 40)) {
      console.log(
        `  • "${candidate.name}" (${candidate.city}, ${candidate.state}) ` +
          `resembles existing "${candidate.conflictsWith}" (score ${candidate.matchScore})`,
      );
    }
    if (summary.duplicateCandidates.length > 40) {
      console.log(`  … and ${summary.duplicateCandidates.length - 40} more`);
    }
    console.log("");
  }

  if (summary.addressLikeNames.length > 0) {
    console.log(
      `Address-like names (${summary.addressLikeNames.length} — flagged, not rewritten):`,
    );
    for (const flag of summary.addressLikeNames.slice(0, 40)) {
      const where = [flag.city, flag.state].filter(Boolean).join(", ");
      const id = flag.existingId ?? flag.legacyId ?? "incoming";
      console.log(
        `  • [${flag.source}] "${flag.name}" (${where || "?"})  ${id}  (${flag.reasons.join(", ")})`,
      );
    }
    if (summary.addressLikeNames.length > 40) {
      console.log(`  … and ${summary.addressLikeNames.length - 40} more`);
    }
    console.log("");
  }

  if (summary.proximityFlags.length > 0) {
    console.log(
      `Proximity review (${summary.proximityFlags.length} — same street or ≤100 m on the same road, shared name token, matcher did not hold; not merged):`,
    );
    for (const flag of summary.proximityFlags.slice(0, 40)) {
      console.log(`  • ${formatProximityFlag(flag)}`);
    }
    if (summary.proximityFlags.length > 40) {
      console.log(`  … and ${summary.proximityFlags.length - 40} more`);
    }
    console.log("");
  }

  if (summary.parseAbandonments.length > 0) {
    console.log(
      `Parse abandonments (${summary.parseAbandonments.length} — no address before next heading):`,
    );
    for (const block of summary.parseAbandonments) {
      const label = block.name ?? "(unnamed block)";
      console.log(
        `  • p.${block.sourcePage} [${block.reason}] "${label}"`,
      );
      for (const line of block.lines) {
        console.log(`      ${line}`);
      }
    }
    console.log("");
  }

  if (summary.geocodeFailures.length > 0) {
    const byReason = new Map<string, number>();
    for (const failure of summary.geocodeFailures) {
      byReason.set(failure.reason, (byReason.get(failure.reason) ?? 0) + 1);
    }

    console.log("Geocode failures by reason:");
    for (const [reason, count] of [...byReason].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(4)}  ${reason}`);
    }
    console.log(
      "  (stored without coordinates; the app filters these out of the map " +
        "until a later run or a paid fallback resolves them)",
    );
    console.log("");
  }

  for (const warning of summary.warnings) console.warn(`warning: ${warning}`);
  for (const error of summary.errors) console.error(`error:   ${error}`);

  if (wantsReport) {
    // scripts/reports/ is gitignored, so plans never land in version control.
    const reportsDir = join(root, "scripts", "reports");
    const path = flagValue("report") ?? join(reportsDir, "eoir-sync-plan.json");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(summary, null, 2));
    console.log(`\nReport written to ${path}`);
  }

  process.exit(summary.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
