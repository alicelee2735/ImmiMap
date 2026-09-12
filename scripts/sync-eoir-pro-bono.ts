/**
 * Syncs the EOIR List of Pro Bono Legal Service Providers into `organizations`.
 *
 * Extends the existing EOIR roster sync (same matcher, geocoder, curated-wins
 * gate). Dry run is the default; nothing is written without --apply.
 *
 * Usage:
 *   npm run db:sync-eoir-probono                 # dry run, prints the plan
 *   npm run db:sync-eoir-probono -- --report     # dry run + JSON report file
 *   npm run db:sync-eoir-probono -- --apply      # write to Supabase
 *   npm run db:sync-eoir-probono -- --limit 25 --verbose
 *
 * Flags:
 *   --apply              perform writes (omit to preview)
 *   --limit <n>          only process the first n unique offices
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

import { isEoirLegacyId } from "../src/lib/ingestion/eoir/constants";
import { formatProximityFlag } from "../src/lib/ingestion/eoir/proximity-triage";
import { syncEoirProBonoOrganizations } from "../src/lib/ingestion/eoir/sync-organizations";
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

function existingKind(legacyId: string | null | undefined): string {
  if (!legacyId) return "curated (no legacy_id)";
  if (isEoirLegacyId(legacyId)) return "EOIR roster";
  if (legacyId.startsWith("doj-probono-")) return "EOIR pro bono";
  const scheme = legacyId.split("-")[0];
  return `curated (${scheme}-*)`;
}

function formatDuplicate(candidate: PlannedChange): string {
  const tokens = candidate.matchedOn?.length
    ? `; matched on ${candidate.matchedOn.join(", ")}`
    : "";
  const existingKey = candidate.conflictsWithLegacyId
    ? `; existing key ${candidate.conflictsWithLegacyId}`
    : "";
  const via = candidate.matchVia ? `; via ${candidate.matchVia}` : "";
  return (
    `  • "${candidate.name}" (${candidate.city}, ${candidate.state}) ` +
    `resembles existing "${candidate.conflictsWith}" ` +
    `[${existingKind(candidate.conflictsWithLegacyId)}] ` +
    `(score ${candidate.matchScore}${via}${tokens}${existingKey})`
  );
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

  const summary = await syncEoirProBonoOrganizations({
    apply,
    limit,
    skipGeocode: hasFlag("skip-geocode"),
    regeocodeExisting: !hasFlag("no-regeocode"),
    verbose: hasFlag("verbose"),
    includePlan: wantsReport,
  });

  const label = summary.dryRun ? "DRY RUN (no writes)" : "APPLIED";
  const verb = summary.dryRun ? "would be" : "were";
  const listings =
    typeof summary.listingsParsed === "number"
      ? String(summary.listingsParsed)
      : "n/a";

  console.log(`
EOIR pro bono list sync — ${label}
────────────────────────────────────────────────
source            ${summary.sourceUrl}
list updated      ${summary.reportUpdatedAt ?? "unknown"}
parser            ${summary.parser}
court listings    ${listings}
unique offices    ${summary.rowsParsed}
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
      `Skipped — blocked pending human resolution (${summary.skipped} office(s), ${summary.duplicateCandidates.length} match(es) against curated + EOIR roster):`,
    );
    for (const candidate of summary.duplicateCandidates) {
      console.log(formatDuplicate(candidate));
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
      `Parse abandonments (${summary.parseAbandonments.length} — no usable address before next heading):`,
    );
    for (const block of summary.parseAbandonments) {
      const name = block.name ?? "(unnamed block)";
      console.log(
        `  • p.${block.sourcePage} [${block.reason}] "${name}"`,
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
    console.log("  Failed addresses (inserted without coordinates, none fabricated):");
    for (const failure of summary.geocodeFailures) {
      console.log(
        `  • "${failure.name}" (${failure.city}, ${failure.state}) — ${failure.reason}`,
      );
    }
    console.log("");
  }

  if (summary.insertPreview && summary.insertPreview.length > 0) {
    console.log(
      `Insert sample (${summary.insertPreview.length} of ${summary.inserted} — exact payloads that would be written):`,
    );
    console.log(JSON.stringify(summary.insertPreview, null, 2));
    console.log("");
  }

  for (const warning of summary.warnings) console.warn(`warning: ${warning}`);
  for (const error of summary.errors) console.error(`error:   ${error}`);

  if (wantsReport) {
    const reportsDir = join(root, "scripts", "reports");
    const path =
      flagValue("report") ?? join(reportsDir, "eoir-probono-sync-plan.json");
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
