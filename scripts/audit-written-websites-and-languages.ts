/**
 * Report-only audit of newly written website_url values and language evidence.
 *
 * Does not write to the database.
 *
 * Usage:
 *   npx tsx scripts/audit-written-websites-and-languages.ts
 *   npx tsx scripts/audit-written-websites-and-languages.ts --concurrency 8
 *   npx tsx scripts/audit-written-websites-and-languages.ts --resume
 *   npx tsx scripts/audit-written-websites-and-languages.ts --limit 20
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createIngestClient } from "../src/lib/ingestion/eoir/client";
import { looksLikeParkedPage } from "../src/lib/website-corrections";
import {
  checkStoredUrlFormat,
  collectExtraPageUrls,
  extractLanguageEvidence,
  isUnrelatedRedirect,
  looksLikeSoft404,
  runSelfChecks,
  type CanonicalLanguage,
  type LanguageEvidence,
} from "./lib/website-language-audit-lib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const REPORT_DIR = join(__dirname, "reports");
const CHECKPOINT_PATH = join(REPORT_DIR, "website-language-audit-checkpoint.json");
const URL_REPORT_PATH = join(REPORT_DIR, "website-url-audit.json");
const LANG_REPORT_PATH = join(REPORT_DIR, "language-verification.json");
const SUMMARY_PATH = join(REPORT_DIR, "website-language-audit-summary.json");

const USER_AGENT =
  "ImmimapLinkChecker/1.0 (+https://immimap.org; website availability audit)";
const MAX_BODY_BYTES = 350_000;
const MAX_EXTRA_PAGES = 3;
const SPOT_CHECKED_IDS = new Set([
  "d64a1291-7588-4f24-b773-7b50bdda9f16",
  "41c834a1-30c6-49a1-a0bd-a5adfed7963c",
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

type OrgRow = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  website_url: string | null;
  website_scope: "local" | "parent" | null;
  languages: string[] | null;
  languages_confirmed: boolean | null;
  is_website_active: boolean | null;
};

type UrlVerdict =
  | "ok"
  | "format_invalid"
  | "timeout"
  | "dns"
  | "network"
  | "http_404"
  | "http_410"
  | "http_5xx"
  | "http_other"
  | "parked"
  | "soft_404"
  | "redirect_unrelated"
  | "gated";

type UrlAuditRow = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  websiteScope: "local" | "parent";
  storedUrl: string;
  formatOk: boolean;
  formatErrors: string[];
  verdict: UrlVerdict;
  pullBack: boolean;
  statusCode: number | null;
  finalUrl: string | null;
  error: string | null;
};

type LangAuditRow = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  websiteScope: "local" | "parent" | null;
  storedUrl: string;
  scanned: boolean;
  skipReason: string | null;
  languages: CanonicalLanguage[];
  evidence: LanguageEvidence[];
  pagesScanned: string[];
};

type Checkpoint = {
  startedAt: string;
  completedIds: string[];
  urlRows: Record<string, UrlAuditRow>;
  langRows: Record<string, LangAuditRow>;
};

type FetchPageResult = {
  statusCode: number | null;
  finalUrl: string | null;
  body: string;
  error: string | null;
  kind: "ok" | "timeout" | "dns" | "network";
};

function parseArgs(argv: string[]) {
  const options = {
    concurrency: 6,
    timeoutMs: 12_000,
    limit: null as number | null,
    resume: false,
    skipLanguage: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--resume") options.resume = true;
    else if (arg === "--skip-language") options.skipLanguage = true;
    else if (arg === "--concurrency") {
      options.concurrency = Math.max(1, Number(argv[++i]) || 6);
    } else if (arg === "--timeout") {
      options.timeoutMs = Math.max(3000, Number(argv[++i]) || 12_000);
    } else if (arg === "--limit") {
      const n = Number(argv[++i]);
      options.limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    }
  }
  return options;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
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

async function fetchAllWebsiteOrgs(): Promise<OrgRow[]> {
  const client = await createIngestClient();
  const rows: OrgRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from("organizations")
      .select(
        "id, name, city, state, website_url, website_scope, languages, languages_confirmed, is_website_active",
      )
      .not("website_url", "is", null)
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...(data as OrgRow[]));
    if (data.length < pageSize) break;
  }
  return rows;
}

function classifyNetworkError(error: unknown): FetchPageResult {
  const message = error instanceof Error ? error.message : String(error);
  const cause =
    error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  const combined = `${message} ${cause}`.toLowerCase();
  if (
    combined.includes("enotfound") ||
    combined.includes("getaddrinfo") ||
    combined.includes("nxdomain") ||
    combined.includes("name not resolved")
  ) {
    return {
      statusCode: null,
      finalUrl: null,
      body: "",
      error: `DNS resolution failed: ${message}`,
      kind: "dns",
    };
  }
  if (
    combined.includes("timeout") ||
    combined.includes("aborted") ||
    combined.includes("etimedout") ||
    combined.includes("abort")
  ) {
    return {
      statusCode: null,
      finalUrl: null,
      body: "",
      error: `Timeout: ${message}`,
      kind: "timeout",
    };
  }
  return {
    statusCode: null,
    finalUrl: null,
    body: "",
    error: message,
    kind: "network",
  };
}

async function fetchPage(url: string, timeoutMs: number): Promise<FetchPageResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
    });
    const contentType = response.headers.get("content-type") ?? "";
    const looksText =
      !contentType ||
      contentType.includes("text") ||
      contentType.includes("html") ||
      contentType.includes("xml") ||
      contentType.includes("json");
    let body = "";
    if (looksText && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let received = 0;
      while (received < MAX_BODY_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        body += decoder.decode(value, { stream: true });
        received += value?.byteLength ?? 0;
      }
      await reader.cancel().catch(() => undefined);
    } else if (response.body) {
      await response.body.cancel().catch(() => undefined);
    }
    return {
      statusCode: response.status,
      finalUrl: response.url || url,
      body,
      error: null,
      kind: "ok",
    };
  } catch (error) {
    return classifyNetworkError(error);
  } finally {
    clearTimeout(timer);
  }
}

function isGated(status: number): boolean {
  return status === 401 || status === 403 || status === 405 || status === 429;
}

function classifyLive(
  storedUrl: string,
  fetched: FetchPageResult,
): Pick<UrlAuditRow, "verdict" | "pullBack" | "error"> {
  if (fetched.kind === "dns") {
    return { verdict: "dns", pullBack: true, error: fetched.error };
  }
  if (fetched.kind === "timeout") {
    return { verdict: "timeout", pullBack: true, error: fetched.error };
  }
  if (fetched.kind === "network") {
    return { verdict: "network", pullBack: true, error: fetched.error };
  }
  const status = fetched.statusCode ?? 0;
  const finalUrl = fetched.finalUrl ?? storedUrl;

  if (looksLikeParkedPage(fetched.body, finalUrl)) {
    return {
      verdict: "parked",
      pullBack: true,
      error: "Domain parking / for-sale page",
    };
  }
  if (fetched.body && looksLikeSoft404(fetched.body, finalUrl)) {
    return {
      verdict: "soft_404",
      pullBack: true,
      error: `Soft 404 at ${finalUrl}`,
    };
  }

  const redirect = isUnrelatedRedirect(storedUrl, finalUrl);
  if (redirect.unrelated) {
    return {
      verdict: "redirect_unrelated",
      pullBack: true,
      error: redirect.reason,
    };
  }

  if (status === 404) {
    return { verdict: "http_404", pullBack: true, error: "HTTP 404" };
  }
  if (status === 410) {
    return { verdict: "http_410", pullBack: true, error: "HTTP 410" };
  }
  if (status >= 500 && status <= 599) {
    return { verdict: "http_5xx", pullBack: true, error: `HTTP ${status}` };
  }
  if (isGated(status)) {
    return {
      verdict: "gated",
      pullBack: false,
      error: `HTTP ${status} (host alive; bot/auth gate)`,
    };
  }
  if (status >= 200 && status < 400) {
    return { verdict: "ok", pullBack: false, error: null };
  }
  return {
    verdict: "http_other",
    pullBack: true,
    error: `HTTP ${status}`,
  };
}

function loadCheckpoint(resume: boolean): Checkpoint {
  if (!resume || !existsSync(CHECKPOINT_PATH)) {
    return {
      startedAt: new Date().toISOString(),
      completedIds: [],
      urlRows: {},
      langRows: {},
    };
  }
  return JSON.parse(readFileSync(CHECKPOINT_PATH, "utf8")) as Checkpoint;
}

function saveCheckpoint(checkpoint: Checkpoint) {
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(CHECKPOINT_PATH, JSON.stringify(checkpoint));
}

function countBy<T extends string>(items: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    out[item] = (out[item] ?? 0) + 1;
  }
  return out;
}

async function main() {
  runSelfChecks();
  const options = parseArgs(process.argv.slice(2));
  mkdirSync(REPORT_DIR, { recursive: true });

  const all = await fetchAllWebsiteOrgs();
  const written = all.filter(
    (row): row is OrgRow & { website_url: string; website_scope: "local" | "parent" } =>
      Boolean(row.website_url) &&
      (row.website_scope === "local" || row.website_scope === "parent"),
  );
  const local = written.filter((row) => row.website_scope === "local");
  const parent = written.filter((row) => row.website_scope === "parent");
  const predating = all.filter((row) => row.website_url && !row.website_scope);

  console.log(
    `Loaded ${all.length} organizations with website_url` +
      `\n  written local=${local.length} parent=${parent.length} (expected 711 + 115)` +
      `\n  predating/unclassified=${predating.length}` +
      `\n  language scan universe=${all.length}`,
  );

  let work = all;
  if (options.limit) work = all.slice(0, options.limit);

  const checkpoint = loadCheckpoint(options.resume);
  const done = new Set(checkpoint.completedIds);
  const pending = work.filter((row) => !done.has(row.id));
  console.log(
    `Queue ${pending.length} (resume skipped ${work.length - pending.length}) ` +
      `concurrency=${options.concurrency} timeout=${options.timeoutMs}ms`,
  );

  let finished = 0;
  const started = Date.now();

  await mapPool(pending, options.concurrency, async (org) => {
    const storedUrl = org.website_url ?? "";
    const format = checkStoredUrlFormat(storedUrl);
    const fetchUrl = format.ok
      ? storedUrl
      : /^https?:\/\//i.test(storedUrl.trim())
        ? storedUrl.trim()
        : `https://${storedUrl.trim()}`;

    let fetched: FetchPageResult = {
      statusCode: null,
      finalUrl: null,
      body: "",
      error: "not fetched",
      kind: "network",
    };
    try {
      fetched = await fetchPage(fetchUrl, options.timeoutMs);
    } catch (error) {
      fetched = classifyNetworkError(error);
    }

    let urlRow: UrlAuditRow | null = null;
    if (org.website_scope === "local" || org.website_scope === "parent") {
      const websiteScope = org.website_scope;
      urlRow = !format.ok
        ? {
            id: org.id,
            name: org.name,
            city: org.city,
            state: org.state,
            websiteScope,
            storedUrl,
            formatOk: false,
            formatErrors: format.errors,
            verdict: "format_invalid",
            pullBack: true,
            statusCode: fetched.statusCode,
            finalUrl: fetched.finalUrl,
            error: format.errors.join("; "),
          }
        : {
            id: org.id,
            name: org.name,
            city: org.city,
            state: org.state,
            websiteScope,
            storedUrl,
            formatOk: true,
            formatErrors: [],
            ...classifyLive(storedUrl, fetched),
            statusCode: fetched.statusCode,
            finalUrl: fetched.finalUrl,
          };
      checkpoint.urlRows[org.id] = urlRow;
    }
    const isWritten = urlRow != null;

    const langRow: LangAuditRow = {
      id: org.id,
      name: org.name,
      city: org.city,
      state: org.state,
      websiteScope: org.website_scope,
      storedUrl,
      scanned: false,
      skipReason: null,
      languages: [],
      evidence: [],
      pagesScanned: [],
    };

    const liveOkForLanguage =
      fetched.kind === "ok" &&
      fetched.body.length > 0 &&
      !looksLikeParkedPage(fetched.body, fetched.finalUrl ?? storedUrl) &&
      !(fetched.finalUrl && looksLikeSoft404(fetched.body, fetched.finalUrl)) &&
      (!isWritten || (urlRow && !urlRow.pullBack));

    if (options.skipLanguage) {
      langRow.skipReason = "skipped by flag";
    } else if (!liveOkForLanguage) {
      langRow.skipReason = urlRow?.error ?? fetched.error ?? "homepage fetch failed";
    } else {
      const homepageUrl = fetched.finalUrl ?? storedUrl;
      const evidence = extractLanguageEvidence(fetched.body, homepageUrl);
      const pages = [homepageUrl];
      const extra = collectExtraPageUrls(homepageUrl, fetched.body, MAX_EXTRA_PAGES);
      for (const extraUrl of extra) {
        const extraFetch = await fetchPage(extraUrl, options.timeoutMs);
        if (extraFetch.kind !== "ok" || !extraFetch.body) continue;
        if (looksLikeParkedPage(extraFetch.body, extraFetch.finalUrl ?? extraUrl)) {
          continue;
        }
        pages.push(extraFetch.finalUrl ?? extraUrl);
        evidence.push(
          ...extractLanguageEvidence(
            extraFetch.body,
            extraFetch.finalUrl ?? extraUrl,
          ),
        );
      }
      const unique = new Map<string, LanguageEvidence>();
      for (const item of evidence) {
        const key = `${item.language}|${item.sourceUrl}|${item.snippet}`;
        if (!unique.has(key)) unique.set(key, item);
      }
      const merged = [...unique.values()];
      langRow.scanned = true;
      langRow.pagesScanned = pages;
      langRow.evidence = merged;
      langRow.languages = [
        ...new Set(merged.map((item) => item.language)),
      ] as CanonicalLanguage[];
    }

    checkpoint.langRows[org.id] = langRow;
    checkpoint.completedIds.push(org.id);
    finished += 1;

    if (finished % 10 === 0 || finished === pending.length) {
      saveCheckpoint(checkpoint);
      const elapsed = (Date.now() - started) / 1000;
      const rate = finished / Math.max(elapsed, 1);
      const remaining = (pending.length - finished) / Math.max(rate, 0.01);
      console.log(
        `  ${finished}/${pending.length}  ${elapsed.toFixed(0)}s  ` +
          `~${remaining.toFixed(0)}s left  last=${org.name.slice(0, 48)}`,
      );
    }
  });

  saveCheckpoint(checkpoint);

  const urlRows = Object.values(checkpoint.urlRows);
  const langRows = Object.values(checkpoint.langRows);
  const pullBack = urlRows.filter((row) => row.pullBack);
  const gated = urlRows.filter((row) => row.verdict === "gated");
  const localFail = pullBack.filter((row) => row.websiteScope === "local");
  const parentFail = pullBack.filter((row) => row.websiteScope === "parent");
  const langHits = langRows.filter((row) => row.languages.length > 0);
  const langByLanguage = countBy(langHits.flatMap((row) => row.languages));

  const uiSamples = {
    local: urlRows
      .filter(
        (row) =>
          row.websiteScope === "local" &&
          row.verdict === "ok" &&
          !SPOT_CHECKED_IDS.has(row.id),
      )
      .slice(0, 6)
      .map((row) => ({
        id: row.id,
        name: row.name,
        city: row.city,
        url: row.storedUrl,
      })),
    parent: urlRows
      .filter(
        (row) =>
          row.websiteScope === "parent" &&
          row.verdict === "ok" &&
          !SPOT_CHECKED_IDS.has(row.id),
      )
      .slice(0, 6)
      .map((row) => ({
        id: row.id,
        name: row.name,
        city: row.city,
        url: row.storedUrl,
      })),
  };

  const urlReport = {
    generatedAt: new Date().toISOString(),
    expected: { local: 711, parent: 115, total: 826 },
    observed: {
      local: local.length,
      parent: parent.length,
      total: written.length,
    },
    verdictCounts: countBy(urlRows.map((row) => row.verdict)),
    pullBackCount: pullBack.length,
    pullBackLocal: localFail.length,
    pullBackParent: parentFail.length,
    gatedCount: gated.length,
    gated,
    pullBack,
    okCount: urlRows.filter((row) => row.verdict === "ok").length,
    uiSamples,
  };

  const langReport = {
    generatedAt: new Date().toISOString(),
    universe: all.length,
    scanned: langRows.filter((row) => row.scanned).length,
    withAtLeastOneLanguage: langHits.length,
    unchangedAssumedEnglish: langRows.filter(
      (row) => row.scanned && row.languages.length === 0,
    ).length,
    skipped: langRows.filter((row) => !row.scanned).length,
    languageCounts: langByLanguage,
    matches: langHits.map((row) => ({
      id: row.id,
      name: row.name,
      city: row.city,
      state: row.state,
      websiteScope: row.websiteScope,
      languages: row.languages,
      evidence: row.evidence,
    })),
    sampleEvidence: langHits.slice(0, 25).map((row) => ({
      name: row.name,
      languages: row.languages,
      evidence: row.evidence.slice(0, 4),
    })),
  };

  const summary = {
    generatedAt: new Date().toISOString(),
    writtenUrls: urlReport.observed,
    liveCheck: {
      ok: urlReport.okCount,
      gated: gated.length,
      pullBack: pullBack.length,
      verdictCounts: urlReport.verdictCounts,
    },
    language: {
      universe: all.length,
      scanned: langReport.scanned,
      withAtLeastOneLanguage: langHits.length,
      unchangedAssumedEnglish: langReport.unchangedAssumedEnglish,
      languageCounts: langByLanguage,
    },
    uiSamples,
  };

  writeFileSync(URL_REPORT_PATH, JSON.stringify(urlReport, null, 2));
  writeFileSync(LANG_REPORT_PATH, JSON.stringify(langReport, null, 2));
  writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));

  console.log("\nAUDIT COMPLETE (report only — no database writes)");
  console.log(
    `Written URLs checked: ${urlRows.length}  ok=${urlReport.okCount}  gated=${gated.length}  pullBack=${pullBack.length}`,
  );
  console.log(`  local pull-back ${localFail.length} / ${local.length}`);
  console.log(`  parent pull-back ${parentFail.length} / ${parent.length}`);
  console.log("  verdicts", urlReport.verdictCounts);
  console.log(
    `Language: scanned=${langReport.scanned}  ≥1 confirmed=${langHits.length}  unchanged assumed English=${langReport.unchangedAssumedEnglish}`,
  );
  console.log("  language counts", langByLanguage);
  console.log(`URL report: ${URL_REPORT_PATH}`);
  console.log(`Language report: ${LANG_REPORT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
