/**
 * Report-only website discovery for organizations with no stored website_url.
 *
 * Searches name + city, scores candidates by domain/title name match, and
 * writes a two-tier report. Never writes website URLs to the database.
 *
 * Usage:
 *   npm run db:discover-websites
 *   npm run db:discover-websites -- --limit 40
 *   npm run db:discover-websites -- --resume
 *
 * Optional search keys in .env.local (tried in order):
 *   SERPER_API_KEY, BRAVE_SEARCH_API_KEY
 * Falls back to DuckDuckGo HTML, then Bing HTML.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createIngestClient } from "../src/lib/ingestion/eoir/client";
import {
  chooseWebsiteMatch,
  type DiscoveryVerdict,
  type SearchHit,
} from "../src/lib/ingestion/website-discovery";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const reportsDir = join(__dirname, "reports");
const REPORT_PATH = join(reportsDir, "website-discovery.json");
const CHECKPOINT_PATH = join(reportsDir, "website-discovery-checkpoint.json");

type OrgRow = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  legacy_id: string | null;
};

type DiscoveryRow = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  legacy_id: string | null;
  query: string;
  searchProvider: string | null;
  searchError: string | null;
  hitCount: number;
  tier: "high" | "low";
  reason: string;
  url: string | null;
  host: string | null;
  title: string | null;
  score: number | null;
  matchReasons: string[];
  websiteScope: "local" | "parent" | null;
  alternatives: Array<{ url: string; host: string; title: string; score: number }>;
};

type Checkpoint = {
  completedIds: string[];
  rows: DiscoveryRow[];
};

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
  const options = {
    limit: null as number | null,
    concurrency: 2,
    sleepMs: 450,
    timeoutMs: 12_000,
    resume: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--limit") {
      const n = Number(argv[++i]);
      options.limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    } else if (arg === "--concurrency") {
      options.concurrency = Math.max(1, Number(argv[++i]) || 2);
    } else if (arg === "--sleep") {
      options.sleepMs = Math.max(0, Number(argv[++i]) || 0);
    } else if (arg === "--resume") {
      options.resume = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: npm run db:discover-websites -- [options]

Options:
  --limit N          Cap organizations searched
  --concurrency N    Parallel workers (default 2)
  --sleep MS         Delay after each org (default 450)
  --resume           Continue from the checkpoint file

This command never writes website_url values.
`);
      process.exit(0);
    }
  }
  return options;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
};

async function searchSerper(query: string, timeoutMs: number): Promise<SearchHit[] | null> {
  const key = process.env.SERPER_API_KEY;
  if (!key) return null;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await fetchWithTimeout(
      "https://google.serper.dev/search",
      {
        method: "POST",
        headers: {
          "X-API-KEY": key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ q: query, num: 8 }),
      },
      timeoutMs,
    );
    if (res.status === 429 || res.status === 503) {
      lastError = new Error(`Serper HTTP ${res.status}`);
      await sleep(800 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`Serper HTTP ${res.status}`);
    const data = (await res.json()) as {
      organic?: Array<{ title?: string; link?: string; snippet?: string }>;
    };
    return (data.organic ?? []).map((row) => ({
      title: row.title ?? "",
      url: row.link ?? "",
      snippet: row.snippet ?? "",
    }));
  }
  throw lastError ?? new Error("Serper retries exhausted");
}

async function searchBrave(query: string, timeoutMs: number): Promise<SearchHit[] | null> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return null;
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "8");
  const res = await fetchWithTimeout(
    url.toString(),
    {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": key,
      },
    },
    timeoutMs,
  );
  if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
  const data = (await res.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };
  return (data.web?.results ?? []).map((row) => ({
    title: row.title ?? "",
    url: row.url ?? "",
    snippet: row.description ?? "",
  }));
}

async function searchDuckDuckGo(query: string, timeoutMs: number): Promise<SearchHit[]> {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);
  const res = await fetchWithTimeout(
    url.toString(),
    { headers: { ...FETCH_HEADERS, Accept: "text/html" }, redirect: "follow" },
    timeoutMs,
  );
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  const html = await res.text();
  const results: SearchHit[] = [];
  const linkRe =
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(html)) && results.length < 8) {
    let link = match[1];
    const uddg = link.match(/[?&]uddg=([^&]+)/);
    if (uddg) {
      try {
        link = decodeURIComponent(uddg[1]);
      } catch {
        // keep wrapped link
      }
    }
    results.push({ title: stripHtml(match[2]), url: unwrapSearchUrl(link), snippet: "" });
  }
  const snipRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  const snips: string[] = [];
  while ((match = snipRe.exec(html)) && snips.length < 8) {
    snips.push(stripHtml(match[1]));
  }
  for (let i = 0; i < results.length; i += 1) {
    if (snips[i]) results[i].snippet = snips[i];
  }
  return results;
}

async function searchBing(query: string, timeoutMs: number): Promise<SearchHit[]> {
  const url = new URL("https://www.bing.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "10");
  const res = await fetchWithTimeout(
    url.toString(),
    { headers: { ...FETCH_HEADERS, Accept: "text/html" }, redirect: "follow" },
    timeoutMs,
  );
  if (!res.ok) throw new Error(`Bing HTTP ${res.status}`);
  const html = await res.text();
  const results: SearchHit[] = [];
  const blockRe =
    /<li class="b_algo"[\s\S]*?<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html)) && results.length < 8) {
    results.push({
      title: stripHtml(match[2]),
      url: unwrapSearchUrl(match[1]),
      snippet: "",
    });
  }
  return results;
}

async function webSearch(
  query: string,
  timeoutMs: number,
): Promise<{ provider: string | null; results: SearchHit[]; error: string | null }> {
  const errors: string[] = [];
  // When a search API key is configured, do not fall back to HTML scrapers.
  // Bing/DuckDuckGo HTML is too noisy and would contaminate a bulk report.
  const providers = process.env.SERPER_API_KEY
    ? [{ name: "serper", fn: searchSerper }]
    : process.env.BRAVE_SEARCH_API_KEY
      ? [{ name: "brave", fn: searchBrave }]
      : [
          { name: "serper", fn: searchSerper },
          { name: "brave", fn: searchBrave },
          { name: "bing", fn: searchBing },
          { name: "duckduckgo", fn: searchDuckDuckGo },
        ];
  for (const provider of providers) {
    try {
      const results = await provider.fn(query, timeoutMs);
      if (results === null) continue;
      if (results.length > 0) {
        return { provider: provider.name, results, error: null };
      }
      errors.push(`${provider.name}: empty`);
    } catch (error) {
      errors.push(
        `${provider.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return {
    provider: null,
    results: [],
    error: errors.join("; ") || "No search provider returned results",
  };
}

async function loadMissingOrgs(): Promise<OrgRow[]> {
  const supabase = await createIngestClient();
  const rows: OrgRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("organizations")
      .select("id, name, city, state, legacy_id, website_url")
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data as Array<OrgRow & { website_url: string | null }>) {
      if (!row.website_url || !row.website_url.trim()) {
        rows.push({
          id: row.id,
          name: row.name,
          city: row.city,
          state: row.state,
          legacy_id: row.legacy_id,
        });
      }
    }
    if (data.length < pageSize) break;
  }
  return rows;
}

function unwrapSearchUrl(raw: string): string {
  let href = raw.replace(/&amp;/g, "&");
  try {
    const url = new URL(href);
    if (url.hostname.endsWith("bing.com") && url.pathname.startsWith("/ck/")) {
      const payload = url.searchParams.get("u");
      if (payload) {
        const encoded = payload.replace(/^a1/i, "").replace(/-/g, "+").replace(/_/g, "/");
        const decoded = Buffer.from(encoded, "base64").toString("utf8");
        if (/^https?:\/\//i.test(decoded)) return decoded;
      }
    }
    const uddg = url.searchParams.get("uddg");
    if (uddg) return uddg;
  } catch {
    // keep original
  }
  return href;
}

function searchQuery(org: OrgRow): string {
  const city = (org.city ?? "").trim();
  const base = city ? `"${org.name}" ${city}` : `"${org.name}"`;
  // Short names collide with movies, churches, and unrelated brands.
  if (org.name.replace(/[^a-z0-9]/gi, "").length < 16) {
    return `${base} immigration legal`;
  }
  return base;
}

function preferHomepage(verdict: DiscoveryVerdict): string | null {
  const url = verdict.candidate?.url ?? null;
  if (!url || verdict.tier !== "high") return url;
  // Parent matches often live on a locations or regional path — keep it.
  if (verdict.websiteScope === "parent") return url;
  const domainMatch = (verdict.candidate?.reasons ?? []).some((reason) =>
    reason.includes("domain"),
  );
  if (!domainMatch) return url;
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function toRow(
  org: OrgRow,
  query: string,
  search: { provider: string | null; results: SearchHit[]; error: string | null },
  verdict: DiscoveryVerdict,
): DiscoveryRow {
  return {
    id: org.id,
    name: org.name,
    city: org.city,
    state: org.state,
    legacy_id: org.legacy_id,
    query,
    searchProvider: search.provider,
    searchError: search.error,
    hitCount: search.results.length,
    tier: verdict.tier,
    reason: verdict.reason,
    url: preferHomepage(verdict),
    host: verdict.candidate?.host ?? null,
    title: verdict.candidate?.title ?? null,
    score: verdict.candidate?.score ?? null,
    matchReasons: verdict.candidate?.reasons ?? [],
    websiteScope: verdict.websiteScope,
    alternatives: verdict.competitors.map((row) => ({
      url: row.url,
      host: row.host,
      title: row.title,
      score: row.score,
    })),
  };
}

function loadCheckpoint(): Checkpoint {
  if (!existsSync(CHECKPOINT_PATH)) {
    return { completedIds: [], rows: [] };
  }
  const parsed = JSON.parse(readFileSync(CHECKPOINT_PATH, "utf8")) as Checkpoint;
  return {
    completedIds: parsed.completedIds ?? [],
    rows: parsed.rows ?? [],
  };
}

function saveCheckpoint(checkpoint: Checkpoint) {
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2));
}

function writeReport(rows: DiscoveryRow[], extra: Record<string, unknown>) {
  mkdirSync(reportsDir, { recursive: true });
  const high = rows.filter((row) => row.tier === "high");
  const highLocal = high.filter((row) => row.websiteScope === "local");
  const highParent = high.filter((row) => row.websiteScope === "parent");
  const low = rows.filter((row) => row.tier === "low");
  writeFileSync(
    REPORT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        writes: false,
        ...extra,
        counts: {
          searched: rows.length,
          high: high.length,
          highLocal: highLocal.length,
          highParent: highParent.length,
          low: low.length,
        },
        highLocal,
        highParent,
        high,
        low,
      },
      null,
      2,
    ),
  );
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length || 1) }, () => run()),
  );
  return results;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const searchMode = process.env.SERPER_API_KEY
    ? "serper"
    : process.env.BRAVE_SEARCH_API_KEY
      ? "brave"
      : "bing-then-duckduckgo";

  console.log(
    `\nWebsite discovery (report only — no URL writes)` +
      `\n  search=${searchMode} concurrency=${options.concurrency}` +
      (options.limit != null ? ` limit=${options.limit}` : "") +
      (options.resume ? " resume=true" : "") +
      "\n",
  );

  const missing = await loadMissingOrgs();
  console.log(`Organizations missing website_url: ${missing.length}`);

  const checkpoint = options.resume ? loadCheckpoint() : { completedIds: [], rows: [] };
  const done = new Set(checkpoint.completedIds);
  let pending = missing.filter((org) => !done.has(org.id));
  if (options.limit != null) pending = pending.slice(0, options.limit);
  console.log(`To search this run: ${pending.length}\n`);

  let processed = 0;
  await mapPool(pending, options.concurrency, async (org) => {
    const query = searchQuery(org);
    const search = await webSearch(query, options.timeoutMs);
    const verdict = chooseWebsiteMatch(org, search.results);
    const row = toRow(org, query, search, verdict);
    checkpoint.rows.push(row);
    checkpoint.completedIds.push(org.id);
    processed += 1;
    if (processed % 10 === 0 || processed === pending.length) {
      saveCheckpoint(checkpoint);
      console.log(
        `  ${processed}/${pending.length}  local=${checkpoint.rows.filter((r) => r.websiteScope === "local").length}  parent=${checkpoint.rows.filter((r) => r.websiteScope === "parent").length}  low=${checkpoint.rows.filter((r) => r.tier === "low").length}`,
      );
    }
    if (options.sleepMs) await sleep(options.sleepMs);
  });

  saveCheckpoint(checkpoint);
  writeReport(checkpoint.rows, {
    searchMode,
    missingWebsiteCount: missing.length,
    reportPath: REPORT_PATH,
  });

  const high = checkpoint.rows.filter((row) => row.tier === "high");
  const highLocal = high.filter((row) => row.websiteScope === "local");
  const highParent = high.filter((row) => row.websiteScope === "parent");
  const low = checkpoint.rows.filter((row) => row.tier === "low");
  console.log(`\nTier breakdown`);
  console.log(`  searched     ${checkpoint.rows.length}`);
  console.log(`  high         ${high.length}`);
  console.log(`    local      ${highLocal.length}  (office-specific — bulk-write as-is)`);
  console.log(`    parent     ${highParent.length}  (national/HQ — write URL, flag website_scope)`);
  console.log(`  low          ${low.length}`);
  console.log(`  report       ${REPORT_PATH}`);
  console.log(`\nNo website URLs were written.\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
