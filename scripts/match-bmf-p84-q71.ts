/**
 * Report-only: IRS EO BMF P84 + Q71 vs the live organizations catalog.
 *
 * Stage 1: same-city/ZIP DuplicateMatcher (attach as source-key alias).
 * Stage 2: cross-city containment/acronym match (parent alias).
 * Remainder: net-new candidates.
 *
 * Usage:
 *   npx tsx scripts/match-bmf-p84-q71.ts
 *   npx tsx scripts/match-bmf-p84-q71.ts --limit 200
 *
 * Never writes to the database.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createIngestClient } from "../src/lib/ingestion/eoir/client";
import {
  organizationSourceFamily,
  organizationSourceLabel,
} from "../src/lib/ingestion/eoir/constants";
import {
  DuplicateMatcher,
  needsEinCrossVerification,
  zipFromAddress,
  type DuplicateMatch,
  type MatchCandidate,
} from "../src/lib/ingestion/eoir/match";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const REPORT_JSON = join(__dirname, "reports/bmf-p84-q71-match.json");
const REPORT_MD = join(__dirname, "reports/bmf-p84-q71-match.md");

const BMF_URLS = [
  "https://www.irs.gov/pub/irs-soi/eo1.csv",
  "https://www.irs.gov/pub/irs-soi/eo2.csv",
  "https://www.irs.gov/pub/irs-soi/eo3.csv",
  "https://www.irs.gov/pub/irs-soi/eo4.csv",
];

const US_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO",
  "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
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

function parseArgs(argv: string[]) {
  const options = { limit: null as number | null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--limit") {
      const n = Number(argv[++i]);
      options.limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    }
  }
  return options;
}

function padEin(ein: string): string {
  return ein.replace(/\D/g, "").padStart(9, "0");
}

function zip5(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length < 5) return null;
  return digits.slice(0, 5);
}

function nteeFamily(ntee: string): "P84" | "Q71" | null {
  const upper = ntee.trim().toUpperCase();
  if (upper.startsWith("P84")) return "P84";
  if (upper.startsWith("Q71")) return "Q71";
  return null;
}

type BmfRow = {
  ein: string;
  name: string;
  sortName: string | null;
  street: string | null;
  city: string;
  state: string;
  zip: string | null;
  ntee: string;
  nteeFamily: "P84" | "Q71";
  filingReq: string;
  affiliation: string;
  incomeAmt: string | null;
  revenueAmt: string | null;
};

async function loadBmf(): Promise<{ rows: BmfRow[]; scanned: number }> {
  const rows: BmfRow[] = [];
  let scanned = 0;
  for (const url of BMF_URLS) {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (ImmiMap BMF match dry-run)" },
    });
    if (!response.ok) throw new Error(`BMF ${url} HTTP ${response.status}`);
    const text = await response.text();
    const lines = text.split(/\r?\n/);
    const header = lines[0]?.split(",") ?? [];
    const idx = (name: string) => header.indexOf(name);
    const col = {
      ein: idx("EIN"),
      name: idx("NAME"),
      sort: idx("SORT_NAME"),
      street: idx("STREET"),
      city: idx("CITY"),
      state: idx("STATE"),
      zip: idx("ZIP"),
      ntee: idx("NTEE_CD"),
      status: idx("STATUS"),
      subsection: idx("SUBSECTION"),
      filing: idx("FILING_REQ_CD"),
      affiliation: idx("AFFILIATION"),
      income: idx("INCOME_AMT"),
      revenue: idx("REVENUE_AMT"),
    };
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      scanned += 1;
      const cells = parseCsvLine(line);
      const status = (cells[col.status] ?? "").trim();
      const subsection = (cells[col.subsection] ?? "").trim().padStart(2, "0");
      const state = (cells[col.state] ?? "").trim().toUpperCase();
      const family = nteeFamily(cells[col.ntee] ?? "");
      if (status !== "01" || subsection !== "03" || !family) continue;
      if (!US_STATES.has(state)) continue;
      const name = (cells[col.name] ?? "").trim();
      const city = (cells[col.city] ?? "").trim();
      if (!name || !city) continue;
      rows.push({
        ein: padEin(cells[col.ein] ?? ""),
        name,
        sortName: (cells[col.sort] ?? "").trim() || null,
        street: (cells[col.street] ?? "").trim() || null,
        city,
        state,
        zip: zip5(cells[col.zip]),
        ntee: (cells[col.ntee] ?? "").trim(),
        nteeFamily: family,
        filingReq: (cells[col.filing] ?? "").trim(),
        affiliation: (cells[col.affiliation] ?? "").trim(),
        incomeAmt: (cells[col.income] ?? "").trim() || null,
        revenueAmt: (cells[col.revenue] ?? "").trim() || null,
      });
    }
  }
  return { rows, scanned };
}

/** Minimal CSV parser for the BMF's quoted fields. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

type CatalogRow = MatchCandidate & {
  address: string | null;
  sourceFamily: ReturnType<typeof organizationSourceFamily>;
  sourceLabel: string;
};

async function loadCatalog(): Promise<CatalogRow[]> {
  const client = await createIngestClient();
  const rows: CatalogRow[] = [];
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
        address: row.address,
        sourceFamily: organizationSourceFamily(row.legacy_id),
        sourceLabel: organizationSourceLabel(row.legacy_id),
      });
    }
    if (data.length < PAGE) break;
  }
  return rows;
}

type Hit = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  legacyId: string | null;
  sourceLabel: string;
  score: number;
  sameZip: boolean;
  via: DuplicateMatch["via"];
  matchedOn: string[];
  einCrossCheckRequired: boolean;
};

function toHit(
  match: DuplicateMatch,
  catalog: Map<string, CatalogRow>,
  incomingName: string,
  isParentIdentifyingToken: (token: string) => boolean,
): Hit {
  const row = catalog.get(match.candidate.id);
  return {
    id: match.candidate.id,
    name: match.candidate.name,
    city: match.candidate.city,
    state: match.candidate.state,
    zip: match.candidate.zip,
    legacyId: match.candidate.legacyId ?? null,
    sourceLabel: row?.sourceLabel ?? "unknown",
    score: Number(match.score.toFixed(4)),
    sameZip: match.sameZip,
    via: match.via,
    matchedOn: match.matchedOn,
    einCrossCheckRequired: needsEinCrossVerification({
      matchedOn: match.matchedOn,
      via: match.via,
      incomingName,
      catalogName: match.candidate.name,
      isParentIdentifyingToken,
    }),
  };
}

function samePlace(
  incoming: BmfRow,
  hit: Hit,
): boolean {
  if (hit.zip && incoming.zip && hit.zip === incoming.zip) return true;
  if (!hit.city || !incoming.city) return false;
  if ((hit.state ?? incoming.state) !== incoming.state) return false;
  return hit.city.trim().toLowerCase() === incoming.city.trim().toLowerCase();
}

function filingLabel(code: string): string {
  if (code === "01") return "990/990-EZ";
  if (code === "02") return "990-N postcard";
  if (code === "00") return "not required";
  if (code === "06") return "church (not required)";
  return `filing ${code || "?"}`;
}

function compactIncoming(row: BmfRow) {
  return {
    ein: row.ein,
    name: row.name,
    sortName: row.sortName,
    city: row.city,
    state: row.state,
    zip: row.zip,
    street: row.street,
    ntee: row.ntee,
    nteeFamily: row.nteeFamily,
    filingReq: row.filingReq,
    filing: filingLabel(row.filingReq),
    affiliation: row.affiliation,
    incomeAmt: row.incomeAmt,
    revenueAmt: row.revenueAmt,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  console.log("loading BMF…");
  const bmf = await loadBmf();
  console.log(`BMF scanned ${bmf.scanned}; eligible ${bmf.rows.length}`);
  console.log("loading catalog…");
  const catalog = await loadCatalog();
  console.log(`catalog ${catalog.length}`);

  let incoming = bmf.rows;
  if (options.limit) incoming = incoming.slice(0, options.limit);

  const catalogById = new Map(catalog.map((row) => [row.id, row]));
  const corpus = [...incoming.map((row) => row.name), ...catalog.map((row) => row.name)];
  const matcher = new DuplicateMatcher(corpus, catalog);
  const parentMatcher = new DuplicateMatcher(
    catalog.map((row) => row.name),
    catalog,
  );

  const sameCity: Array<{
    incoming: ReturnType<typeof compactIncoming>;
    matches: Hit[];
    otherCityHits: Hit[];
  }> = [];
  const parent: Array<{
    incoming: ReturnType<typeof compactIncoming>;
    matches: Hit[];
  }> = [];
  const netNew: Array<ReturnType<typeof compactIncoming>> = [];

  for (const row of incoming) {
    const record = {
      name: row.name,
      city: row.city,
      state: row.state,
      zip: row.zip,
    };
    const isRare = (token: string) => parentMatcher.isParentIdentifyingToken(token);
    const local = matcher
      .findMatches(record)
      .map((hit) => toHit(hit, catalogById, row.name, isRare));
    if (local.length > 0) {
      const seen = new Set(local.map((hit) => hit.id));
      const elsewhere = parentMatcher
        .findMatchesAnywhere(record)
        .map((hit) => toHit(hit, catalogById, row.name, isRare))
        .filter((hit) => !seen.has(hit.id) && !samePlace(row, hit));
      sameCity.push({
        incoming: compactIncoming(row),
        matches: local,
        otherCityHits: elsewhere,
      });
      continue;
    }

    const anywhere = parentMatcher
      .findMatchesAnywhere(record)
      .map((hit) => toHit(hit, catalogById, row.name, isRare))
      .filter((hit) => !samePlace(row, hit));
    if (anywhere.length > 0) {
      parent.push({ incoming: compactIncoming(row), matches: anywhere });
      continue;
    }

    netNew.push(compactIncoming(row));
  }

  sameCity.sort((a, b) => a.incoming.name.localeCompare(b.incoming.name));
  parent.sort((a, b) => a.incoming.name.localeCompare(b.incoming.name));
  netNew.sort((a, b) => a.name.localeCompare(b.name));

  const catalogIdsHit = new Set<string>();
  for (const row of sameCity) {
    for (const hit of row.matches) catalogIdsHit.add(hit.id);
    for (const hit of row.otherCityHits) catalogIdsHit.add(hit.id);
  }
  for (const row of parent) {
    for (const hit of row.matches) catalogIdsHit.add(hit.id);
  }

  const nteeCount = (list: Array<{ nteeFamily: string }>) => ({
    P84: list.filter((row) => row.nteeFamily === "P84").length,
    Q71: list.filter((row) => row.nteeFamily === "Q71").length,
  });
  const filingCount = (list: Array<{ filingReq: string }>) => {
    const out: Record<string, number> = {};
    for (const row of list) {
      const key = filingLabel(row.filingReq);
      out[key] = (out[key] ?? 0) + 1;
    }
    return out;
  };

  const einCrossCheck = {
    sameCity: sameCity
      .filter((row) =>
        [...row.matches, ...row.otherCityHits].some((hit) => hit.einCrossCheckRequired),
      )
      .map((row) => ({
        ein: row.incoming.ein,
        name: row.incoming.name,
        city: row.incoming.city,
        state: row.incoming.state,
        hits: [...row.matches, ...row.otherCityHits]
          .filter((hit) => hit.einCrossCheckRequired)
          .map((hit) => ({
            name: hit.name,
            city: hit.city,
            state: hit.state,
            matchedOn: hit.matchedOn,
            via: hit.via,
            score: hit.score,
          })),
      })),
    parent: parent
      .filter((row) => row.matches.some((hit) => hit.einCrossCheckRequired))
      .map((row) => ({
        ein: row.incoming.ein,
        name: row.incoming.name,
        city: row.incoming.city,
        state: row.incoming.state,
        hits: row.matches
          .filter((hit) => hit.einCrossCheckRequired)
          .map((hit) => ({
            name: hit.name,
            city: hit.city,
            state: hit.state,
            matchedOn: hit.matchedOn,
            via: hit.via,
            score: hit.score,
          })),
      })),
  };

  const summary = {
    generatedAt: new Date().toISOString(),
    writes: false,
    bmfScanned: bmf.scanned,
    eligible: bmf.rows.length,
    scored: incoming.length,
    catalogSize: catalog.length,
    sameCityCount: sameCity.length,
    parentCount: parent.length,
    netNewCount: netNew.length,
    catalogRowsTouched: catalogIdsHit.size,
    einCrossCheckRequiredSameCity: einCrossCheck.sameCity.length,
    einCrossCheckRequiredParent: einCrossCheck.parent.length,
    sameCityByNtee: nteeCount(sameCity.map((row) => row.incoming)),
    parentByNtee: nteeCount(parent.map((row) => row.incoming)),
    netNewByNtee: nteeCount(netNew),
    netNewByFiling: filingCount(netNew),
    sameCityByFiling: filingCount(sameCity.map((row) => row.incoming)),
  };

  mkdirSync(dirname(REPORT_JSON), { recursive: true });
  writeFileSync(
    REPORT_JSON,
    JSON.stringify({ summary, einCrossCheck, sameCity, parent, netNew }, null, 2),
  );
  writeFileSync(
    REPORT_MD,
    renderMarkdown(summary, einCrossCheck, sameCity, parent, netNew),
  );

  console.log(JSON.stringify(summary, null, 2));
  console.log(`json ${REPORT_JSON}`);
  console.log(`md   ${REPORT_MD}`);
}

function renderMarkdown(
  summary: Record<string, unknown>,
  einCrossCheck: {
    sameCity: Array<{
      ein: string;
      name: string;
      city: string;
      state: string;
      hits: Array<{ name: string; matchedOn: string[] }>;
    }>;
    parent: Array<{
      ein: string;
      name: string;
      city: string;
      state: string;
      hits: Array<{ name: string; matchedOn: string[] }>;
    }>;
  },
  sameCity: Array<{ incoming: ReturnType<typeof compactIncoming>; matches: Hit[]; otherCityHits: Hit[] }>,
  parent: Array<{ incoming: ReturnType<typeof compactIncoming>; matches: Hit[] }>,
  netNew: Array<ReturnType<typeof compactIncoming>>,
): string {
  const lines: string[] = [];
  lines.push("# IRS BMF P84 + Q71 × live catalog (report-only)");
  lines.push("");
  lines.push("No writes. Stage 1 = same-city/ZIP name match. Stage 2 = cross-city brand/parent.");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(`| BMF rows scanned | ${summary.bmfScanned} |`);
  lines.push(`| Eligible (P84/Q71, status 01, 501(c)(3), US) | ${summary.eligible} |`);
  lines.push(`| Scored | ${summary.scored} |`);
  lines.push(`| Live catalog | ${summary.catalogSize} |`);
  lines.push(`| Same-city duplicate | **${summary.sameCityCount}** |`);
  lines.push(`| Cross-city parent | **${summary.parentCount}** |`);
  lines.push(`| Net-new | **${summary.netNewCount}** |`);
  lines.push(`| Catalog rows touched | ${summary.catalogRowsTouched} |`);
  lines.push(`| EIN cross-check required (same-city) | **${summary.einCrossCheckRequiredSameCity}** |`);
  lines.push(`| EIN cross-check required (parent) | **${summary.einCrossCheckRequiredParent}** |`);
  lines.push("");

  lines.push("## EIN cross-verification required (manual)");
  lines.push("");
  lines.push("Do not attach these from a containment score alone. Each match below");
  lines.push("rests on **exactly one rare token** and the two names are not the same");
  lines.push("legal-name token set. Compare GuideStar / ProPublica EINs before");
  lines.push("writing `irs-eo-{ein}` onto `organization_source_keys`. The matcher");
  lines.push("does not look EINs up. Rarity cannot tell a brand from an ethnicity");
  lines.push("or population-category word that is merely uncommon in this catalog");
  lines.push("(KCSC of Greater Washington scored 1.0 against NAKASEC on `korean`).");
  lines.push("");
  if (einCrossCheck.sameCity.length === 0 && einCrossCheck.parent.length === 0) {
    lines.push("None in this run.");
    lines.push("");
  } else {
    if (einCrossCheck.sameCity.length > 0) {
      lines.push("### Same-city");
      lines.push("");
      for (const row of einCrossCheck.sameCity) {
        const hit = row.hits
          .map((h) => `${h.name} (${h.matchedOn.join(", ")})`)
          .join("; ");
        lines.push(`- ${row.name} \`${row.ein}\` — ${row.city}, ${row.state} → ${hit}`);
      }
      lines.push("");
    }
    if (einCrossCheck.parent.length > 0) {
      lines.push("### Cross-city parent");
      lines.push("");
      for (const row of einCrossCheck.parent) {
        const hit = row.hits
          .map((h) => `${h.name} (${h.matchedOn.join(", ")})`)
          .join("; ");
        lines.push(`- ${row.name} \`${row.ein}\` — ${row.city}, ${row.state} → ${hit}`);
      }
      lines.push("");
    }
  }

  lines.push("## Same-city duplicates");
  lines.push("");
  lines.push("Would attach `irs-eo-{ein}` on `organization_source_keys` of the matched office. No new row.");
  lines.push("");
  for (const row of sameCity) {
    const inc = row.incoming;
    lines.push(
      `### ${inc.name} \`${inc.ein}\` — ${inc.city}, ${inc.state} ${inc.zip ?? ""} (${inc.nteeFamily}, ${inc.filing})`.trim(),
    );
    for (const hit of row.matches) {
      const flag = hit.einCrossCheckRequired ? " **EIN cross-check required**" : "";
      lines.push(
        `- **same city:** ${hit.name} — ${hit.city}, ${hit.state} [${hit.sourceLabel}] score ${hit.score} via ${hit.via} (${hit.matchedOn.join(", ")})${flag}`,
      );
    }
    for (const hit of row.otherCityHits) {
      const flag = hit.einCrossCheckRequired ? " **EIN cross-check required**" : "";
      lines.push(
        `- also other city: ${hit.name} — ${hit.city}, ${hit.state} [${hit.sourceLabel}] score ${hit.score}${flag}`,
      );
    }
    lines.push("");
  }

  lines.push("## Cross-city parents");
  lines.push("");
  lines.push("Same legal entity / national brand as catalog offices in other cities. Bucket as parent alias, not a new pin.");
  lines.push("");
  for (const row of parent) {
    const inc = row.incoming;
    lines.push(
      `### ${inc.name} \`${inc.ein}\` — ${inc.city}, ${inc.state} ${inc.zip ?? ""} (${inc.nteeFamily}, ${inc.filing})`.trim(),
    );
    for (const hit of row.matches) {
      const flag = hit.einCrossCheckRequired ? " **EIN cross-check required**" : "";
      lines.push(
        `- ${hit.name} — ${hit.city}, ${hit.state} [${hit.sourceLabel}] score ${hit.score} via ${hit.via} (${hit.matchedOn.join(", ")})${flag}`,
      );
    }
    lines.push("");
  }

  lines.push("## Net-new candidates");
  lines.push("");
  lines.push("Nothing in the live catalog matched. Not an apply list.");
  lines.push("");
  for (const row of netNew) {
    lines.push(
      `- ${row.name} \`${row.ein}\` — ${row.city}, ${row.state} ${row.zip ?? ""} — ${row.nteeFamily} / ${row.filing}`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
