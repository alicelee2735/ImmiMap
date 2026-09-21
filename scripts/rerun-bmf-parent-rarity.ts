/**
 * Re-score the Milestone 1 cross-city parent bucket (122 EINs) after
 * rarity-gated findMatchesAnywhere. Report-only. No writes.
 *
 * Usage:
 *   npx tsx scripts/rerun-bmf-parent-rarity.ts
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createIngestClient } from "../src/lib/ingestion/eoir/client";
import {
  DuplicateMatcher,
  needsEinCrossVerification,
  zipFromAddress,
  type MatchCandidate,
} from "../src/lib/ingestion/eoir/match";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const PRIOR_PATH = join(__dirname, "reports/bmf-p84-q71-match.json");
const OUT_PATH = join(__dirname, "reports/bmf-parent-rarity-rerun.json");

const CONFIRMED_REAL = [
  "AL OTRO LADO INC",
  "PRIME-ECUMENICAL COMMITMENT TO REFUGEES",
  "COLORADO HOSTING ASYLUM NETWORK",
  "UKRAINIAN COMMUNITY CENTER OF WASHINGTON",
  "SOMALI BANTU ASSOCIATION OF AMERICA",
  "IMMIGRATION AID RESOURCE CENTER",
  "NATIONAL ASSOCIATION OF NEW AMERICANS INC",
  "WITHOUT BORDERS WORLDWIDE INC",
] as const;

/** Frozen from the rarity-only parent re-run: 16 generic collisions that still matched. */
const RARITY_SURVIVORS = [
  "A&A IMMIGRATION LEGAL CLINIC NFP",
  "CASA DE VENEZUELA MINNESOTA",
  "CASA DE VENEZUELA NEW ENGLAND INC",
  "CASA JUAN DIEGO",
  "CLEARING THE PATH IMMIGRATION & REFUGEE SERVICES INC",
  "GREATER VALLEY IMMIGRATION CITIZENSHIP & EDUCATION SERVICES",
  "HOPE RESOURCES IMMIGRATION SERVICES",
  "IMMIGRATION LEGAL SERVICES OF LONG ISLAND",
  "IMMIGRATION STAR SUPPORT SERVICES I NC",
  "LA CASA DE LA AMISTAD",
  "MI CASA ES SU CASA",
  "MI CASA TU CASA",
  "OPEN ARMS IMMIGRATION SERVICES",
  "US IMMIGRATION HOPE INC",
  "WELCOME",
  "WELCOME CENTER INC",
] as const;
const GENERIC_EVAL = new Set([
  "immigration",
  "services",
  "service",
  "center",
  "legal",
  "clinic",
  "foundation",
  "immigrant",
  "community",
  "american",
  "international",
  "refugee",
  "association",
  "project",
  "hope",
  "welcome",
  "casa",
  "advocacy",
  "new",
  "el",
  "on",
]);

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

function genericOnly(tokens: string[]): boolean {
  return tokens.length > 0 && tokens.every((t) => GENERIC_EVAL.has(t) || t.length <= 2);
}

function zip5(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length < 5) return null;
  return digits.slice(0, 5);
}

function samePlace(
  incoming: { city: string; state: string; zip: string | null },
  hit: { city: string | null; state: string | null; zip: string | null },
): boolean {
  if (hit.zip && incoming.zip && hit.zip === incoming.zip) return true;
  if (!hit.city || !incoming.city) return false;
  if ((hit.state ?? incoming.state) !== incoming.state) return false;
  return hit.city.trim().toLowerCase() === incoming.city.trim().toLowerCase();
}

async function loadCatalog(): Promise<MatchCandidate[]> {
  const client = await createIngestClient();
  const rows: MatchCandidate[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("organizations")
      .select("id, name, city, state, address, legacy_id")
      .order("name")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const row of data as Array<{
      id: string;
      name: string;
      city: string | null;
      state: string | null;
      address: string | null;
      legacy_id: string | null;
    }>) {
      rows.push({
        id: row.id,
        name: row.name,
        city: row.city,
        state: row.state,
        zip: zipFromAddress(row.address) ?? zip5(row.address),
        legacyId: row.legacy_id,
      });
    }
    if (data.length < PAGE) break;
  }
  return rows;
}

async function main() {
  if (!existsSync(PRIOR_PATH)) {
    throw new Error(`Missing ${PRIOR_PATH}; run scripts/match-bmf-p84-q71.ts first.`);
  }
  const prior = JSON.parse(readFileSync(PRIOR_PATH, "utf8")) as {
    sameCity: Array<{ incoming: { name: string } }>;
    parent: Array<{
      incoming: {
        ein: string;
        name: string;
        city: string;
        state: string;
        zip: string | null;
      };
      matches: Array<{ matchedOn: string[] }>;
    }>;
    netNew: Array<{ name: string }>;
  };

  const catalog = await loadCatalog();
  // Unique-name DF is catalog-only: a token is a parent signal if it is rare
  // among stored organization names, not among the incoming BMF roster.
  const matcher = new DuplicateMatcher(
    catalog.map((row) => row.name),
    catalog,
  );

  const genericPrior = prior.parent.filter((row) => genericOnly(row.matches[0]?.matchedOn ?? []));
  const genericNames = new Set(genericPrior.map((row) => row.incoming.name));

  const rescored = prior.parent.map((row) => {
    const incoming = row.incoming;
    const matches = matcher
      .findMatchesAnywhere({
        name: incoming.name,
        city: incoming.city,
        state: incoming.state,
        zip: incoming.zip,
      })
      .filter((hit) => !samePlace(incoming, hit.candidate))
      .map((hit) => ({
        name: hit.candidate.name,
        city: hit.candidate.city,
        state: hit.candidate.state,
        score: Number(hit.score.toFixed(4)),
        via: hit.via,
        matchedOn: hit.matchedOn,
        einCrossCheckRequired: needsEinCrossVerification({
          matchedOn: hit.matchedOn,
          via: hit.via,
          incomingName: incoming.name,
          catalogName: hit.candidate.name,
          isParentIdentifyingToken: (token) => matcher.isParentIdentifyingToken(token),
        }),
      }));
    return { incoming, matches };
  });

  const stillMatched = rescored.filter((row) => row.matches.length > 0);
  const realResults = CONFIRMED_REAL.map((name) => {
    const row = stillMatched.find((r) => r.incoming.name === name) ??
      rescored.find((r) => r.incoming.name === name);
    return {
      name,
      stillMatches: (row?.matches.length ?? 0) > 0,
      matches: row?.matches ?? [],
    };
  });
  const genericStill = stillMatched.filter((row) => genericNames.has(row.incoming.name));
  const genericExcluded = genericPrior.length - genericStill.length;

  const survivorRows = RARITY_SURVIVORS.map((name) => {
    const row =
      stillMatched.find((r) => r.incoming.name === name) ??
      rescored.find((r) => r.incoming.name === name);
    const matches = row?.matches ?? [];
    return {
      name,
      stillMatches: matches.length > 0,
      matchedOn: [...new Set(matches.flatMap((m) => m.matchedOn))].sort(),
      matches,
    };
  });
  const survivorsExcluded = survivorRows.filter((row) => !row.stillMatches);
  const survivorsBorderline = survivorRows.filter((row) => row.stillMatches);
  const einCrossCheck = stillMatched.filter((row) =>
    row.matches.some((hit) => hit.einCrossCheckRequired),
  );

  const report = {
    generatedAt: new Date().toISOString(),
    writes: false,
    parentIdentifyingDfMax: matcher.parentIdentifyingDfMax,
    priorParentCount: prior.parent.length,
    priorGenericCollisions: genericPrior.length,
    confirmedReal: CONFIRMED_REAL.length,
    stillMatchedCount: stillMatched.length,
    confirmedRealStillMatching: realResults.filter((r) => r.stillMatches).length,
    confirmedRealDropped: realResults.filter((r) => !r.stillMatches).map((r) => r.name),
    genericStillMatching: genericStill.length,
    genericExcluded,
    raritySurvivors: RARITY_SURVIVORS.length,
    raritySurvivorsExcluded: survivorsExcluded.length,
    raritySurvivorsBorderline: survivorsBorderline.length,
    einCrossCheckRequiredCount: einCrossCheck.length,
    einCrossCheck: einCrossCheck.map((row) => ({
      ein: row.incoming.ein,
      name: row.incoming.name,
      matches: row.matches.filter((hit) => hit.einCrossCheckRequired),
    })),
    survivorRows,
    realResults,
    remainingParents: stillMatched.map((row) => ({
      name: row.incoming.name,
      ein: row.incoming.ein,
      city: row.incoming.city,
      state: row.incoming.state,
      wasGenericCollision: genericNames.has(row.incoming.name),
      wasConfirmedReal: (CONFIRMED_REAL as readonly string[]).includes(
        row.incoming.name,
      ),
      matches: row.matches,
    })),
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    parentIdentifyingDfMax: report.parentIdentifyingDfMax,
    confirmedRealStillMatching: `${report.confirmedRealStillMatching}/${report.confirmedReal}`,
    raritySurvivorsExcluded: `${report.raritySurvivorsExcluded}/${report.raritySurvivors}`,
    raritySurvivorsBorderline: report.raritySurvivorsBorderline,
    einCrossCheckRequiredCount: report.einCrossCheckRequiredCount,
    excluded: survivorsExcluded.map((row) => row.name),
    borderline: survivorsBorderline.map((row) => ({
      name: row.name,
      matchedOn: row.matchedOn,
    })),
  }, null, 2));
  console.log(`report ${OUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
