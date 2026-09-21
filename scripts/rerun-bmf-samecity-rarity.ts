/**
 * Re-score the Milestone 1 same-city bucket (163 EINs) with the validated
 * parent token filter (shape + catalog unique-name rarity), still gated to
 * same city/ZIP. Report-only.
 *
 * Usage:
 *   npx tsx scripts/rerun-bmf-samecity-rarity.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createIngestClient } from "../src/lib/ingestion/eoir/client";
import {
  DuplicateMatcher,
  namesIndicateSameOffice,
  needsEinCrossVerification,
  zipFromAddress,
  type MatchCandidate,
} from "../src/lib/ingestion/eoir/match";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const PRIOR_PATH = join(__dirname, "reports/bmf-p84-q71-match.json");
const OUT_PATH = join(__dirname, "reports/bmf-samecity-rarity-rerun.json");

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
    sameCity: Array<{
      incoming: {
        ein: string;
        name: string;
        city: string;
        state: string;
        zip: string | null;
      };
      matches: Array<{
        id: string;
        name: string;
        city: string | null;
        state: string | null;
        matchedOn: string[];
        score: number;
      }>;
      otherCityHits: unknown[];
    }>;
  };

  const catalog = await loadCatalog();
  const matcher = new DuplicateMatcher(
    catalog.map((row) => row.name),
    catalog,
  );

  const rescored = prior.sameCity.map((row) => {
    const incoming = row.incoming;
    const matches = matcher
      .findMatchesAnywhere({
        name: incoming.name,
        city: incoming.city,
        state: incoming.state,
        zip: incoming.zip,
      })
      .filter((hit) => samePlace(incoming, hit.candidate))
      .map((hit) => ({
        id: hit.candidate.id,
        name: hit.candidate.name,
        city: hit.candidate.city,
        state: hit.candidate.state,
        zip: hit.candidate.zip,
        legacyId: hit.candidate.legacyId ?? null,
        score: Number(hit.score.toFixed(4)),
        via: hit.via,
        matchedOn: hit.matchedOn,
        nameLooksSame: namesIndicateSameOffice(incoming.name, hit.candidate.name),
        einCrossCheckRequired: needsEinCrossVerification({
          matchedOn: hit.matchedOn,
          via: hit.via,
          incomingName: incoming.name,
          catalogName: hit.candidate.name,
          isParentIdentifyingToken: (token) => matcher.isParentIdentifyingToken(token),
        }),
      }));
    const priorHit = row.matches[0];
    return {
      incoming,
      priorMatchedOn: priorHit?.matchedOn ?? [],
      priorName: priorHit?.name ?? null,
      priorId: priorHit?.id ?? null,
      priorOtherCityHits: row.otherCityHits.length,
      matches,
      nameLooksSameWithPrior:
        priorHit != null &&
        namesIndicateSameOffice(incoming.name, priorHit.name),
    };
  });

  const stillMatched = rescored.filter((row) => row.matches.length > 0);
  const excluded = rescored.filter((row) => row.matches.length === 0);
  const excludedButNameLike = excluded.filter((row) => row.nameLooksSameWithPrior);
  const einCrossCheck = stillMatched.filter((row) =>
    row.matches.some((hit) => hit.einCrossCheckRequired),
  );

  const report = {
    generatedAt: new Date().toISOString(),
    writes: false,
    parentIdentifyingDfMax: matcher.parentIdentifyingDfMax,
    priorSameCityCount: prior.sameCity.length,
    stillMatchedCount: stillMatched.length,
    autoExcludedCount: excluded.length,
    excludedButNameLikeCount: excludedButNameLike.length,
    einCrossCheckRequiredCount: einCrossCheck.length,
    einCrossCheck: einCrossCheck.map((row) => ({
      ein: row.incoming.ein,
      name: row.incoming.name,
      city: row.incoming.city,
      state: row.incoming.state,
      matches: row.matches.filter((hit) => hit.einCrossCheckRequired),
    })),
    stillMatched: stillMatched.map((row) => ({
      ein: row.incoming.ein,
      name: row.incoming.name,
      city: row.incoming.city,
      state: row.incoming.state,
      zip: row.incoming.zip,
      priorMatchedOn: row.priorMatchedOn,
      priorOtherCityHits: row.priorOtherCityHits,
      matches: row.matches,
    })),
    autoExcluded: excluded.map((row) => ({
      ein: row.incoming.ein,
      name: row.incoming.name,
      city: row.incoming.city,
      state: row.incoming.state,
      zip: row.incoming.zip,
      priorName: row.priorName,
      priorId: row.priorId,
      priorMatchedOn: row.priorMatchedOn,
      nameLooksSameWithPrior: row.nameLooksSameWithPrior,
      priorOtherCityHits: row.priorOtherCityHits,
    })),
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        parentIdentifyingDfMax: report.parentIdentifyingDfMax,
        priorSameCityCount: report.priorSameCityCount,
        stillMatchedCount: report.stillMatchedCount,
        autoExcludedCount: report.autoExcludedCount,
        excludedButNameLikeCount: report.excludedButNameLikeCount,
        einCrossCheckRequiredCount: report.einCrossCheckRequiredCount,
        excludedNameLike: excludedButNameLike.map((row) => ({
          name: row.incoming.name,
          priorName: row.priorName,
          priorMatchedOn: row.priorMatchedOn,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`report ${OUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
