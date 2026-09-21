/**
 * Report-only scan: cosmetic name normalization candidates.
 *
 * Usage:
 *   npx tsx scripts/scan-cosmetic-org-names.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createIngestClient } from "../src/lib/ingestion/eoir/client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const REPORT_PATH = join(__dirname, "reports/cosmetic-name-scan.json");

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

const FROZEN_IDS = new Set([
  "a005adae-f1f6-413a-9841-5971dc0fabc1", // Centro Legal
  "62afde7d-0942-4e4f-8f04-3d6647677d9a", // HIAS NY
  "a1cc3830-eaad-42df-a91b-cad43ca90a6d", // BDS Immigration Unit
  "b0a8485b-242a-4b23-b0be-8842f7b77676", // BDS 177 Livingston 7th
  "6250d305-bcb2-4f3a-bd13-557112357269", // BDS 180 Livingston
  "64fe3d89-0569-4bc5-8c62-e2f2f90e0b4f", // IIBA
  "c5540727-e37c-43a6-91ef-1bfe483a0007", // CRLAF
  "2dc4817d-0f58-4fb4-b213-ce4839df8bf3", // HRF NY
  "8b72f250-3b0b-4da9-b8bc-214b9aaa1f50", // HRF DC
  "7cac35e7-479e-4f6a-b9bb-b92fa34f359f", // Tahirih Atlanta
]);

const FROZEN_NAME_RE =
  /\b(centro legal de la raza|hias|brooklyn defender|immigration institute of the bay area|california rural legal assistance|human rights first|tahirih justice center)\b/i;

const KNOWN_ACRONYMS = new Set([
  "RAICES",
  "AILA",
  "BAJI",
  "MIRA",
  "SSIP",
  "WACC",
  "NALEO",
  "CLINIC",
  "KIND",
  "HIAS",
  "CRLA",
  "CRLAF",
  "BDS",
  "IIBA",
  "EOIR",
  "USCIS",
  "DACA",
  "VAWA",
  "TPS",
  "SIJS",
  "ABA",
  "IRC",
  "CWS",
  "LIRS",
  "UNHCR",
  "NYIC",
  "NILC",
  "ACLU",
  "NAACP",
  "YMCA",
  "YWCA",
  "UNLV",
  "UFW",
  "HRF",
  "IAN",
  "DOJ",
  "ICE",
  "LSNA",
  "RIAC",
  "CCUSA",
  "SFBFS",
  "CCEB",
]);

const SMALL = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "de",
  "del",
  "el",
  "for",
  "in",
  "la",
  "las",
  "los",
  "nor",
  "of",
  "on",
  "or",
  "the",
  "to",
  "vs",
  "via",
  "y",
]);

const SUFFIX_RE =
  /[,\s]+(?:Inc\.?|Incorporated|LLC|L\.L\.C\.?|Ltd\.?|Limited|LLP|L\.L\.P\.?|PLLC|P\.L\.L\.C\.?|P\.?C\.?|Corp\.?|Corporation|Co\.?)\s*$/i;

type OrgRow = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  website_url: string | null;
};

function lettersOnly(name: string): string {
  return name.replace(/[^A-Za-z]/g, "");
}

function isAllCapsName(name: string): boolean {
  const letters = lettersOnly(name);
  if (letters.length < 8) return false;
  if (!/[A-Z]/.test(letters)) return false;
  if (/[a-z]/.test(name)) return false;
  return true;
}

function isKnownAcronymName(name: string): boolean {
  const core = name.replace(/\s+/g, " ").trim();
  if (KNOWN_ACRONYMS.has(core)) return true;
  const paren = core.match(/\(([A-Za-z][A-Za-z0-9.&]{1,12})\)\s*$/);
  if (paren && KNOWN_ACRONYMS.has(paren[1].toUpperCase())) {
    const rest = core.replace(/\s*\([^)]+\)\s*$/, "").trim();
    return KNOWN_ACRONYMS.has(rest) || rest === paren[1];
  }
  return false;
}

function titleCaseToken(token: string, index: number, last: boolean): string {
  if (/^[A-Z]{2,8}(?:\/[A-Z]{2,8})?$/.test(token) && KNOWN_ACRONYMS.has(token)) {
    return token;
  }
  if (/^[A-Z]{2,8}$/.test(token) && token.length <= 5 && index > 0) {
    // Leave embedded acronyms like "UFW", "NYC" if already all-caps in a mixed name.
    // For a fully ALL-CAPS name we still title-case short words unless known.
    if (KNOWN_ACRONYMS.has(token)) return token;
  }
  const lower = token.toLowerCase();
  const stripped = lower.replace(/[^a-z0-9]/g, "");
  if (KNOWN_ACRONYMS.has(stripped.toUpperCase()) && stripped.length >= 3) {
    const upper = stripped.toUpperCase();
    return token.replace(new RegExp(stripped, "i"), upper);
  }
  if (index > 0 && !last && SMALL.has(stripped)) {
    return token.replace(/[A-Za-z]+/, stripped);
  }
  return token.replace(/[A-Za-zÀ-ÿ]+/g, (word) => {
    if (word.includes("'") && word.length <= 3) {
      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    }
    return word[0].toUpperCase() + word.slice(1).toLowerCase();
  });
}

function toTitleCase(name: string): string {
  const parts = name.trim().split(/(\s+|[-/])/);
  const words = parts.filter((p) => !/^\s+$/.test(p) && p !== "-" && p !== "/");
  let wordIndex = 0;
  return parts
    .map((part) => {
      if (/^\s+$/.test(part) || part === "-" || part === "/") return part;
      const out = titleCaseToken(part, wordIndex, wordIndex === words.length - 1);
      wordIndex += 1;
      return out;
    })
    .join("");
}

function stripSuffix(name: string): string {
  return name.replace(SUFFIX_RE, "").replace(/[,\s]+$/, "").trim();
}

async function main() {
  const client = await createIngestClient();
  const PAGE = 1000;
  const rows: OrgRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("organizations")
      .select("id, name, city, state, website_url")
      .order("name")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...(data as OrgRow[]));
    if (data.length < PAGE) break;
  }

  const suffixHits: OrgRow[] = [];
  const capsHits: OrgRow[] = [];
  const frozenSkipped: OrgRow[] = [];

  for (const row of rows) {
    const frozen = FROZEN_IDS.has(row.id) || FROZEN_NAME_RE.test(row.name);
    const suffix = SUFFIX_RE.test(row.name);
    const caps = isAllCapsName(row.name) && !isKnownAcronymName(row.name);
    if (!suffix && !caps) continue;
    if (frozen) {
      frozenSkipped.push(row);
      continue;
    }
    if (suffix) suffixHits.push(row);
    if (caps) capsHits.push(row);
  }

  const uniqueSuffix = new Map<string, number>();
  for (const row of suffixHits) {
    uniqueSuffix.set(row.name, (uniqueSuffix.get(row.name) ?? 0) + 1);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    totalOrgs: rows.length,
    suffixRowCount: suffixHits.length,
    suffixDistinctNames: uniqueSuffix.size,
    capsRowCount: capsHits.length,
    frozenSkipped: frozenSkipped.map((row) => ({
      id: row.id,
      name: row.name,
    })),
    allCaps: capsHits.map((row) => ({
      id: row.id,
      name: row.name,
      proposed: toTitleCase(row.name),
      city: row.city,
      state: row.state,
    })),
    suffixes: suffixHits.map((row) => ({
      id: row.id,
      name: row.name,
      proposed: stripSuffix(row.name),
      city: row.city,
      state: row.state,
      website: row.website_url,
    })),
  };

  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(
    `orgs ${rows.length}\n` +
      `suffix rows ${suffixHits.length} (${uniqueSuffix.size} distinct names)\n` +
      `all-caps rows ${capsHits.length}\n` +
      `frozen skipped ${frozenSkipped.length}\n` +
      `report ${REPORT_PATH}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
