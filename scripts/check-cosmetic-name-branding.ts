/**
 * Report-only: website/logo branding check for cosmetic name normalization.
 *
 * Loads live organizations, finds legal-suffix and ALL-CAPS candidates,
 * fetches the org's own site when we have one, and proposes a change only
 * when branding omits the suffix (or when ALL-CAPS is a caps-lock artifact).
 *
 * Usage:
 *   npx tsx scripts/check-cosmetic-name-branding.ts
 *   npx tsx scripts/check-cosmetic-name-branding.ts --concurrency 8
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createIngestClient } from "../src/lib/ingestion/eoir/client";
import { hostOf } from "../src/lib/ingestion/website-discovery";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const REPORT_PATH = join(__dirname, "reports/cosmetic-name-branding.json");
const DISCOVERY_PATH = join(__dirname, "reports/website-discovery.json");

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
  "a005adae-f1f6-413a-9841-5971dc0fabc1",
  "62afde7d-0942-4e4f-8f04-3d6647677d9a",
  "a1cc3830-eaad-42df-a91b-cad43ca90a6d",
  "b0a8485b-242a-4b23-b0be-8842f7b77676",
  "6250d305-bcb2-4f3a-bd13-557112357269",
  "64fe3d89-0569-4bc5-8c62-e2f2f90e0b4f",
  "c5540727-e37c-43a6-91ef-1bfe483a0007",
  "2dc4817d-0f58-4fb4-b213-ce4839df8bf3",
  "8b72f250-3b0b-4da9-b8bc-214b9aaa1f50",
  "7cac35e7-479e-4f6a-b9bb-b92fa34f359f",
]);

const FROZEN_NAME_RE =
  /\b(centro legal de la raza|hias|brooklyn defender|immigration institute of the bay area|california rural legal assistance|human rights first|tahirih justice center)\b/i;

const INTENTIONAL_CAPS = new Set([
  "CAIR-CA",
  "MARU",
  "VALORUS",
  "VECINA",
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

const SUFFIX_TOKEN =
  String.raw`Inc\.?|Incorporated|LLC|L\.L\.C\.?|Ltd\.?|Limited|LLP|L\.L\.P\.?|PLLC|P\.L\.L\.C\.?|P\.C\.|Corp\.?|Corporation|A\.P\.C\.|APLC|APC`;

const SUFFIX_FIND_RE = new RegExp(`\\b(?:${SUFFIX_TOKEN})\\b`, "i");
const SUFFIX_IN_BRAND_RE =
  /(?<![A-Za-z])(?:incorporated|inc\.?|l\.l\.c\.?|llc|l\.l\.p\.?|llp|p\.l\.l\.c\.?|pllc|ltd\.?|limited|corp(?:oration)?|a\.p\.c\.|aplc|apc)(?![A-Za-z])/i;

const DIRECTORY_HOST_RE =
  /(calbar\.ca\.gov|statebar|justia\.com|avvo\.com|martindale\.com|findlaw\.com|superlawyers\.com|guidestar\.org|charitynavigator\.org|propublica\.org|causeiq\.com|opencorporates\.com|facebook\.com|instagram\.com|linkedin\.com|twitter\.com|x\.com|yelp\.com|yellowpages\.com|immigrationadvocates\.org|immigrationlawhelp\.org|lawhelp\.org|lsc\.gov|justice\.gov|americanbar\.org|irs\.gov|bbb\.org|idealist\.org|greatnonprofits\.org|chamberofcommerce\.com|mapquest\.com|wikipedia\.org|zoominfo\.com|dnb\.com|bizapedia\.com|sunbiz\.org|sos\.ca\.gov|charitiesnys\.com)/i;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

type OrgRow = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  website_url: string | null;
};

type DiscoveryHit = {
  id: string;
  url: string | null;
  title: string | null;
  tier: string;
  host: string | null;
};

type BrandSignals = {
  url: string | null;
  source: "stored" | "discovery" | "none";
  title: string | null;
  ogSiteName: string | null;
  h1: string | null;
  jsonLdName: string | null;
  logoAlt: string | null;
  fetchError: string | null;
};

function parseArgs(argv: string[]) {
  const options = { concurrency: 8, timeoutMs: 10_000, limit: null as number | null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--concurrency") options.concurrency = Math.max(1, Number(argv[++i]) || 8);
    else if (arg === "--timeout") options.timeoutMs = Math.max(2000, Number(argv[++i]) || 10_000);
    else if (arg === "--limit") {
      const n = Number(argv[++i]);
      options.limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    }
  }
  return options;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function firstMatch(html: string, re: RegExp): string | null {
  const match = html.match(re);
  if (!match?.[1]) return null;
  return decodeEntities(match[1].replace(/<[^>]+>/g, " "));
}

function extractJsonLdName(html: string): string | null {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    try {
      const parsed = JSON.parse(match[1]) as unknown;
      const found = findOrgName(parsed);
      if (found) return found;
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return null;
}

function findOrgName(node: unknown): string | null {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findOrgName(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== "object") return null;
  const record = node as Record<string, unknown>;
  const type = record["@type"];
  const types = Array.isArray(type) ? type.map(String) : type ? [String(type)] : [];
  const isOrg = types.some((t) =>
    /organization|ngo|nonprofit|localbusiness|legal|attorney|government/i.test(t),
  );
  if (isOrg && typeof record.name === "string" && record.name.trim()) {
    return decodeEntities(record.name);
  }
  if (record["@graph"]) return findOrgName(record["@graph"]);
  return null;
}

function extractBrand(html: string): Omit<BrandSignals, "url" | "source" | "fetchError"> {
  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const ogSiteName =
    firstMatch(html, /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i) ??
    firstMatch(html, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i);
  const h1 = firstMatch(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const jsonLdName = extractJsonLdName(html);
  const header = html.slice(0, Math.min(html.length, 80_000));
  const logoAlt =
    firstMatch(header, /<img[^>]+alt=["']([^"']{2,80})["'][^>]*>/i) ??
    firstMatch(header, /<img[^>]+alt=["']([^"']{2,80})["']/i);
  return { title, ogSiteName, h1, jsonLdName, logoAlt };
}

async function fetchHtml(
  url: string,
  timeoutMs: number,
): Promise<{ html: string | null; error: string | null; finalUrl: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/html|xml|text|json/i.test(contentType)) {
      return { html: null, error: `non-html ${contentType}`, finalUrl: response.url };
    }
    const html = await response.text();
    if (!response.ok) {
      return { html, error: `HTTP ${response.status}`, finalUrl: response.url };
    }
    return { html, error: null, finalUrl: response.url };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { html: null, error: message, finalUrl: null };
  } finally {
    clearTimeout(timer);
  }
}

function usableUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = hostOf(url);
    if (!host) return null;
    if (DIRECTORY_HOST_RE.test(host) || DIRECTORY_HOST_RE.test(url)) return null;
    return url;
  } catch {
    return null;
  }
}

function hasDba(name: string): boolean {
  return /\bd\/?b\/?a\b/i.test(name);
}

function stripCosmeticSuffix(name: string): string | null {
  if (hasDba(name)) return null;
  let next = name;
  next = next.replace(new RegExp(`,\\s*(?:${SUFFIX_TOKEN})(?=\\s*\\()`, "i"), "");
  next = next.replace(new RegExp(`\\s+(?:${SUFFIX_TOKEN})(?=\\s*\\()`, "i"), "");
  next = next.replace(new RegExp(`,\\s*(?:${SUFFIX_TOKEN})(?=\\s+[A-Za-z/"'])`, "i"), "");
  next = next.replace(new RegExp(`\\s+(?:${SUFFIX_TOKEN})(?=\\s+[A-Za-z/"'])`, "i"), "");
  next = next.replace(new RegExp(`[,-]?\\s*(?:${SUFFIX_TOKEN})\\s*$`, "i"), "");
  next = next.replace(/[,\s]+$/g, "").replace(/\s+/g, " ").trim();
  if (!next || next === name) return null;
  return next;
}

function distinctiveTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !SMALL.has(t) && !/^(inc|llc|ltd|llp|corp|corporation|incorporated)$/.test(t));
}

function brandMentionsName(brand: string, stripped: string): boolean {
  const brandNorm = brand.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const tokens = distinctiveTokens(stripped);
  if (tokens.length === 0) return false;
  const hits = tokens.filter((t) => brandNorm.includes(t)).length;
  return hits >= Math.min(2, tokens.length) || hits / tokens.length >= 0.5;
}

function visualBrandFields(signals: BrandSignals): string[] {
  return [signals.ogSiteName, signals.h1, signals.logoAlt].filter(
    (v): v is string => Boolean(v && v.trim()),
  );
}

function titleCaseToken(token: string, index: number, last: boolean): string {
  if (/^QC$/i.test(token)) return "QC";
  const stripped = token.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (index > 0 && !last && SMALL.has(stripped)) {
    return token.replace(/[A-Za-z]+/, stripped);
  }
  return token.replace(/[A-Za-zÀ-ÿ]+/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
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

function isAllCapsName(name: string): boolean {
  if (!/[A-Z]/.test(name) || /[a-z]/.test(name)) return false;
  return lettersOnly(name).length >= 3;
}

function lettersOnly(name: string): string {
  return name.replace(/[^A-Za-z]/g, "");
}

function loadDiscoveryById(): Map<string, DiscoveryHit> {
  const map = new Map<string, DiscoveryHit>();
  if (!existsSync(DISCOVERY_PATH)) return map;
  const data = JSON.parse(readFileSync(DISCOVERY_PATH, "utf8")) as {
    highLocal?: DiscoveryHit[];
    highParent?: DiscoveryHit[];
    high?: DiscoveryHit[];
    low?: DiscoveryHit[];
  };
  for (const row of [...(data.highLocal ?? []), ...(data.highParent ?? []), ...(data.high ?? [])]) {
    if (row.id && row.url) map.set(row.id, row);
  }
  return map;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
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

  const discovery = loadDiscoveryById();
  const frozen: OrgRow[] = [];
  const suffixRows: OrgRow[] = [];
  const capsRows: OrgRow[] = [];
  const dbaHeld: OrgRow[] = [];

  for (const row of rows) {
    const frozenHit = FROZEN_IDS.has(row.id) || FROZEN_NAME_RE.test(row.name);
    const hasSuffix = SUFFIX_FIND_RE.test(row.name);
    const caps = isAllCapsName(row.name) && !INTENTIONAL_CAPS.has(row.name);
    if (!hasSuffix && !caps) continue;
    if (frozenHit) {
      frozen.push(row);
      continue;
    }
    if (caps) capsRows.push(row);
    if (!hasSuffix) continue;
    if (hasDba(row.name)) {
      dbaHeld.push(row);
      continue;
    }
    suffixRows.push(row);
  }

  const byName = new Map<string, OrgRow[]>();
  for (const row of suffixRows) {
    const list = byName.get(row.name) ?? [];
    list.push(row);
    byName.set(row.name, list);
  }
  let names = [...byName.keys()].sort((a, b) => a.localeCompare(b));
  if (options.limit) names = names.slice(0, options.limit);

  type NameVerdict = {
    name: string;
    proposed: string | null;
    action: "strip" | "keep";
    reason: string;
    rowCount: number;
    brandUrl: string | null;
    brandTitle: string | null;
    ogSiteName: string | null;
    h1: string | null;
    jsonLdName: string | null;
    cities: string[];
  };

  const htmlCache = new Map<string, Awaited<ReturnType<typeof fetchHtml>>>();

  const verdicts = await mapPool(names, options.concurrency, async (name): Promise<NameVerdict> => {
    const group = byName.get(name)!;
    const proposed = stripCosmeticSuffix(name);
    const cities = [
      ...new Set(group.map((row) => [row.city, row.state].filter(Boolean).join(", ")).filter(Boolean)),
    ];
    if (!proposed) {
      return {
        name,
        proposed: null,
        action: "keep",
        reason: "suffix is not a clean trailing/mid legal token",
        rowCount: group.length,
        brandUrl: null,
        brandTitle: null,
        ogSiteName: null,
        h1: null,
        jsonLdName: null,
        cities,
      };
    }

    let source: BrandSignals["source"] = "none";
    let url: string | null = null;
    let discoveryTitle: string | null = null;
    for (const row of group) {
      const stored = usableUrl(row.website_url);
      if (stored) {
        url = stored;
        source = "stored";
        break;
      }
    }
    if (!url) {
      for (const row of group) {
        const hit = discovery.get(row.id);
        const discovered = usableUrl(hit?.url);
        if (discovered) {
          url = discovered;
          source = "discovery";
          discoveryTitle = hit?.title ?? null;
          if (hit?.tier === "high" || !discoveryTitle) break;
        }
      }
    }

    const signals: BrandSignals = {
      url,
      source,
      title: discoveryTitle,
      ogSiteName: null,
      h1: null,
      jsonLdName: null,
      logoAlt: null,
      fetchError: null,
    };

    if (url) {
      let fetched = htmlCache.get(url);
      if (!fetched) {
        fetched = await fetchHtml(url, options.timeoutMs);
        htmlCache.set(url, fetched);
      }
      if (fetched.error && !fetched.html) {
        signals.fetchError = fetched.error;
      } else if (fetched.html) {
        const extracted = extractBrand(fetched.html);
        signals.title = extracted.title ?? signals.title;
        signals.ogSiteName = extracted.ogSiteName;
        signals.h1 = extracted.h1;
        signals.jsonLdName = extracted.jsonLdName;
        signals.logoAlt = extracted.logoAlt;
        if (fetched.finalUrl && DIRECTORY_HOST_RE.test(fetched.finalUrl)) {
          return {
            name,
            proposed,
            action: "keep",
            reason: "site redirected to a directory listing",
            rowCount: group.length,
            brandUrl: fetched.finalUrl,
            brandTitle: signals.title,
            ogSiteName: signals.ogSiteName,
            h1: signals.h1,
            jsonLdName: signals.jsonLdName,
            cities,
          };
        }
      }
    }

    const visual = visualBrandFields(signals);
    const titleField = signals.title?.trim() ? [signals.title] : [];
    const jsonLd = signals.jsonLdName?.trim() ? [signals.jsonLdName] : [];
    const fields = [...visual, ...titleField, ...jsonLd];
    if (!url) {
      return {
        name,
        proposed,
        action: "keep",
        reason: "no own website to check branding",
        rowCount: group.length,
        brandUrl: null,
        brandTitle: null,
        ogSiteName: null,
        h1: null,
        jsonLdName: null,
        cities,
      };
    }
    if (fields.length === 0) {
      return {
        name,
        proposed,
        action: "keep",
        reason: signals.fetchError ? `fetch failed (${signals.fetchError})` : "no brand text on site",
        rowCount: group.length,
        brandUrl: url,
        brandTitle: null,
        ogSiteName: null,
        h1: null,
        jsonLdName: null,
        cities,
      };
    }
    const visualWithSuffix = visual.filter((field) => SUFFIX_IN_BRAND_RE.test(field));
    const visualWithout = visual.filter(
      (field) => !SUFFIX_IN_BRAND_RE.test(field) && brandMentionsName(field, proposed),
    );
    if (visualWithSuffix.length > 0 && visualWithout.length === 0) {
      return {
        name,
        proposed,
        action: "keep",
        reason: "own site/logo still uses the legal suffix",
        rowCount: group.length,
        brandUrl: url,
        brandTitle: signals.title,
        ogSiteName: signals.ogSiteName,
        h1: signals.h1,
        jsonLdName: signals.jsonLdName,
        cities,
      };
    }
    if (visualWithout.length > 0) {
      return {
        name,
        proposed,
        action: "strip",
        reason: `logo/h1/site name omits suffix (${source})`,
        rowCount: group.length,
        brandUrl: url,
        brandTitle: signals.title,
        ogSiteName: signals.ogSiteName,
        h1: signals.h1,
        jsonLdName: signals.jsonLdName,
        cities,
      };
    }
    const titleHasSuffix = titleField.some((field) => SUFFIX_IN_BRAND_RE.test(field));
    const titleMatches = titleField.some((field) => brandMentionsName(field, proposed));
    if (titleHasSuffix) {
      return {
        name,
        proposed,
        action: "keep",
        reason: "page title still uses the legal suffix",
        rowCount: group.length,
        brandUrl: url,
        brandTitle: signals.title,
        ogSiteName: signals.ogSiteName,
        h1: signals.h1,
        jsonLdName: signals.jsonLdName,
        cities,
      };
    }
    if (
      titleMatches ||
      jsonLd.some((field) => brandMentionsName(field, proposed) && !SUFFIX_IN_BRAND_RE.test(field))
    ) {
      return {
        name,
        proposed,
        action: "strip",
        reason: `page title/JSON-LD brands without suffix (${source})`,
        rowCount: group.length,
        brandUrl: url,
        brandTitle: signals.title,
        ogSiteName: signals.ogSiteName,
        h1: signals.h1,
        jsonLdName: signals.jsonLdName,
        cities,
      };
    }
    return {
      name,
      proposed,
      action: "keep",
      reason: "brand text does not clearly match this organization",
      rowCount: group.length,
      brandUrl: url,
      brandTitle: signals.title,
      ogSiteName: signals.ogSiteName,
      h1: signals.h1,
      jsonLdName: signals.jsonLdName,
      cities,
    };
  });

  const strip = verdicts.filter((v) => v.action === "strip");
  const keep = verdicts.filter((v) => v.action === "keep");
  const capsProposed = capsRows.map((row) => ({
    id: row.id,
    name: row.name,
    proposed: row.name === "AKWAABA QC" ? "Akwaaba QC" : toTitleCase(row.name),
    city: row.city,
    state: row.state,
    note:
      row.name === "AKWAABA QC"
        ? 'Site title is "Akwaaba Quad Cities"; QC is the Quad Cities acronym — title-case the word, keep QC.'
        : "ALL-CAPS name with no independent brand confirmation in this pass",
  }));

  const report = {
    generatedAt: new Date().toISOString(),
    totalOrgs: rows.length,
    frozenSkipped: frozen.map((row) => ({ id: row.id, name: row.name })),
    capsIntentionalKept: ["CAIR-CA", "MARU", "VALORUS", "VECINA"],
    dbaHeld: [...new Set(dbaHeld.map((row) => row.name))],
    suffixDistinctChecked: verdicts.length,
    stripDistinct: strip.length,
    stripRows: strip.reduce((n, v) => n + v.rowCount, 0),
    keepDistinct: keep.length,
    allCapsProposed: capsProposed,
    strip,
    keep,
  };

  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(
    [
      `orgs ${rows.length}`,
      `frozen ${frozen.length}`,
      `dba held ${report.dbaHeld.length} names`,
      `suffix checked ${verdicts.length} names / strip ${strip.length} (${report.stripRows} rows) / keep ${keep.length}`,
      `all-caps proposed ${capsProposed.length}`,
      `report ${REPORT_PATH}`,
    ].join("\n"),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
