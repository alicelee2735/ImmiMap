/**
 * Pure helpers for the report-only website URL + language-evidence audit.
 * No network, no database writes.
 */

export const CANONICAL_LANGUAGES = [
  "English",
  "Spanish",
  "Mandarin",
  "Cantonese",
  "Arabic",
  "French",
  "Haitian Creole",
  "Korean",
  "Portuguese",
  "Vietnamese",
  "Tagalog",
  "Russian",
  "Farsi",
  "Bengali",
  "Burmese",
  "Somali",
] as const;

export type CanonicalLanguage = (typeof CANONICAL_LANGUAGES)[number];

export type FormatIssue = {
  ok: boolean;
  errors: string[];
};

export type LanguageEvidence = {
  language: CanonicalLanguage;
  snippet: string;
  sourceUrl: string;
  kind:
    | "offering-phrase"
    | "language-list"
    | "switcher"
    | "staff-bio"
    | "hreflang-switcher";
};

const MULTI_TLD = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "com.au",
  "net.au",
  "co.nz",
  "com.mx",
  "com.br",
  "co.jp",
  "com.co",
  "co.in",
]);

const GENERIC_HOST_TOKENS = new Set([
  "www",
  "com",
  "org",
  "net",
  "edu",
  "gov",
  "html",
  "http",
  "https",
  "site",
  "sites",
  "web",
  "home",
  "page",
  "pages",
  "index",
  "info",
  "online",
]);

const PLATFORM_REGISTRABLE = new Set([
  "squarespace.com",
  "wixsite.com",
  "wix.com",
  "weebly.com",
  "wordpress.com",
  "webflow.io",
  "godaddysites.com",
  "google.com",
  "carrd.co",
  "linktr.ee",
  "notion.site",
  "github.io",
  "netlify.app",
  "vercel.app",
  "myftpupload.com",
  "cloudfront.net",
  "smugmug.com",
]);

const UNRELATED_REGISTRABLE = new Set([
  "google.com",
  "bing.com",
  "yahoo.com",
  "duckduckgo.com",
  "sedo.com",
  "dan.com",
  "afternic.com",
  "hugedomains.com",
  "godaddy.com",
  "parkingcrew.net",
  "guidestar.org",
  "charitynavigator.org",
  "wikipedia.org",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "immigrationadvocates.org",
  "immigrationlawhelp.org",
  "yelp.com",
  "yellowpages.com",
]);

/** google.com is unrelated unless the stored URL was already a Google Sites host. */
const GOOGLE_SITES_OK = /(?:^|\.)sites\.google\.com$/i;

export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const last2 = labels.slice(-2).join(".");
  if (MULTI_TLD.has(last2) && labels.length >= 3) {
    return labels.slice(-3).join(".");
  }
  return last2;
}

export function hostTokens(host: string): string[] {
  return host
    .toLowerCase()
    .replace(/^www\./, "")
    .split(/[.-]/)
    .filter((token) => token.length >= 4 && !GENERIC_HOST_TOKENS.has(token));
}

export function hostnameOf(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function checkStoredUrlFormat(raw: string | null | undefined): FormatIssue {
  const errors: string[] = [];
  if (raw == null || raw === "") {
    return { ok: false, errors: ["empty"] };
  }
  if (raw !== raw.trim()) errors.push("leading or trailing whitespace");
  const value = raw.trim();
  if (/\s/.test(value)) errors.push("internal whitespace");
  if (value.includes("...")) errors.push("ellipsis truncation");
  if (!/^https?:\/\//i.test(value)) errors.push("missing http(s) scheme");
  if (/^https?:\/\/https?:\/\//i.test(value)) errors.push("duplicated scheme");
  if (/^https?:\/\/\/+/i.test(value)) errors.push("empty host");
  if (/^https?:\/[^/]/i.test(value)) errors.push("single-slash scheme");

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      errors.push(`unsupported scheme ${parsed.protocol}`);
    }
    const host = parsed.hostname.replace(/\.$/, "");
    if (!host) errors.push("empty hostname");
    else {
      if (!host.includes(".")) errors.push("hostname missing TLD");
      if (host.startsWith("-") || host.endsWith("-")) {
        errors.push("malformed hostname hyphen");
      }
      if (host.includes("..")) errors.push("empty hostname label");
      const tld = host.split(".").pop() ?? "";
      if (tld.length < 2) errors.push("TLD too short");
    }
    if (parsed.username || parsed.password) {
      errors.push("unexpected credentials in URL");
    }
  } catch {
    errors.push("URL constructor failed");
  }

  return { ok: errors.length === 0, errors };
}

export function isUnrelatedRedirect(
  storedUrl: string,
  finalUrl: string,
): { unrelated: boolean; reason: string | null } {
  const storedHost = hostnameOf(storedUrl);
  const finalHost = hostnameOf(finalUrl);
  if (!storedHost || !finalHost) {
    return { unrelated: true, reason: "missing host on stored or final URL" };
  }

  const storedReg = registrableDomain(storedHost);
  const finalReg = registrableDomain(finalHost);
  if (storedReg === finalReg) {
    return { unrelated: false, reason: null };
  }

  const storedWasUnrelatedHost = UNRELATED_REGISTRABLE.has(storedReg);
  if (UNRELATED_REGISTRABLE.has(finalReg) && !storedWasUnrelatedHost) {
    if (finalReg === "google.com" && GOOGLE_SITES_OK.test(finalHost)) {
      // fall through to platform/token checks
    } else {
      return {
        unrelated: true,
        reason: `redirected off-site to ${finalHost}`,
      };
    }
  }

  const storedTokens = hostTokens(storedHost);
  const finalTokens = hostTokens(finalHost);
  if (storedTokens.some((token) => finalTokens.includes(token))) {
    return { unrelated: false, reason: null };
  }

  const storedLabel = storedTokens[0] ?? "";
  if (
    storedLabel &&
    (finalHost.replace(/[^a-z0-9]/g, "").includes(storedLabel) ||
      finalUrl.toLowerCase().includes(storedLabel))
  ) {
    return { unrelated: false, reason: null };
  }

  if (PLATFORM_REGISTRABLE.has(finalReg)) {
    if (
      PLATFORM_REGISTRABLE.has(storedReg) ||
      storedTokens.some((token) => finalUrl.toLowerCase().includes(token))
    ) {
      return { unrelated: false, reason: null };
    }
  }

  return {
    unrelated: true,
    reason: `redirect ${storedHost} → ${finalHost}`,
  };
}

export function looksLikeSoft404(html: string, finalUrl: string): boolean {
  const path = (() => {
    try {
      return new URL(finalUrl).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (/\/(404|not-?found|page-not-found|error-404)(\/|$)/.test(path)) return true;

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = (titleMatch?.[1] ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (
    /\b404\b/.test(title) ||
    /page not found/.test(title) ||
    /not found/.test(title) ||
    /doesn't exist/.test(title) ||
    /does not exist/.test(title)
  ) {
    return true;
  }

  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h1 = (h1Match?.[1] ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (h1 === "404" || /page not found/.test(h1) || /^not found$/.test(h1)) {
    return true;
  }
  return false;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|td|section|article|header|footer)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

type LanguagePattern = {
  language: CanonicalLanguage;
  regex: RegExp;
};

const LANGUAGE_PATTERNS: LanguagePattern[] = [
  { language: "Spanish", regex: /\b(?:espa(?:ñ|n)ol|spanish|castellano)\b/gi },
  { language: "English", regex: /\b(?:english|ingl(?:é|e)s)\b/gi },
  { language: "Mandarin", regex: /\b(?:mandarin|putonghua|putong hua)\b/gi },
  { language: "Cantonese", regex: /\bcantonese\b/gi },
  { language: "Arabic", regex: /\b(?:arabic|árabe|arabe)\b/gi },
  { language: "French", regex: /\b(?:french|fran(?:ç|c)ais)\b/gi },
  {
    language: "Haitian Creole",
    regex: /\b(?:haitian creole|krey[oò]l ayisyen|kreyol|kreyòl|kreol)\b/gi,
  },
  { language: "Korean", regex: /\b(?:korean|한국어)\b/gi },
  { language: "Portuguese", regex: /\b(?:portuguese|portugu(?:ê|e)s)\b/gi },
  { language: "Vietnamese", regex: /\b(?:vietnamese|ti(?:ế|e)ng vi(?:ệ|e)t)\b/gi },
  { language: "Tagalog", regex: /\b(?:tagalog|filipino)\b/gi },
  { language: "Russian", regex: /\b(?:russian|русский)\b/gi },
  { language: "Farsi", regex: /\b(?:farsi|persian|fārsi)\b/gi },
  { language: "Bengali", regex: /\b(?:bengali|bangla)\b/gi },
  { language: "Burmese", regex: /\bburmese\b/gi },
  { language: "Somali", regex: /\bsomali\b/gi },
];

const HREFLANG_TO_LANGUAGE: Record<string, CanonicalLanguage> = {
  es: "Spanish",
  en: "English",
  fr: "French",
  ar: "Arabic",
  ko: "Korean",
  vi: "Vietnamese",
  pt: "Portuguese",
  ru: "Russian",
  tl: "Tagalog",
  fil: "Tagalog",
  fa: "Farsi",
  bn: "Bengali",
  my: "Burmese",
  so: "Somali",
  "zh-cn": "Mandarin",
  "zh-hans": "Mandarin",
  "zh-hk": "Cantonese",
  yue: "Cantonese",
  ht: "Haitian Creole",
};

const OFFERING_RE =
  /\b(?:hablamos|se habla|we speak|spoken here|languages?\s+(?:spoken|offered|available|served|supported|accepted)|bilingual|multilingual|interpreters?|interpretation|translators?|translations?|fluent(?:ly)?\s+in|native\s+speaker|staff\s+(?:speak|are\s+fluent)|services?\s+in|available\s+in|offered\s+in|provided\s+in|assistance\s+in|can\s+assist\s+in|language(?:s)?\s+we|our\s+languages|select\s+language|choose\s+language|language\s+(?:selector|switcher|access|line)|speaking\s+staff|speakers?\s+on\s+staff|idioma|idiomas)\b/i;

const STAFF_BIO_RE =
  /\b(?:fluent(?:ly)?\s+in|native\s+(?:speaker\s+(?:of|in)|in)|speaks|staff\s+speak|bilingual\s+in)\b/i;

const ENGLISH_SKIP_RE =
  /\b(?:english as a second language|\besl\b|learn(?:ing)? english|english class(?:es)?|english course(?:s)?|teach(?:ing)? english)\b/i;

const HABLAMOS_RE = /\bhablamos\b/i;
const SE_HABLA_RE = /\bse habla\b/i;

const EXTRA_PAGE_PATH =
  /(?:about|contact|service|idioma|language|quienes|nosotros|our-team|ourteam|staff|locations|inmigracion|immigration|who-we|what-we|programs?)/i;

function snippetAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 70);
  const end = Math.min(text.length, index + length + 70);
  let snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) snippet = `…${snippet}`;
  if (end < text.length) snippet = `${snippet}…`;
  return snippet;
}

function findMatches(
  text: string,
  regex: RegExp,
): Array<{ index: number; match: string }> {
  const out: Array<{ index: number; match: string }> = [];
  const cloned = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
  let hit: RegExpExecArray | null;
  while ((hit = cloned.exec(text))) {
    out.push({ index: hit.index, match: hit[0] });
    if (hit[0].length === 0) cloned.lastIndex += 1;
  }
  return out;
}

function windowHasOffering(text: string, index: number, length: number): boolean {
  const start = Math.max(0, index - 110);
  const end = Math.min(text.length, index + length + 110);
  return OFFERING_RE.test(text.slice(start, end));
}

function windowIsStaffBio(text: string, index: number, length: number): boolean {
  const start = Math.max(0, index - 80);
  const end = Math.min(text.length, index + length + 80);
  return STAFF_BIO_RE.test(text.slice(start, end));
}

export function collectExtraPageUrls(homepage: string, html: string, limit = 3): string[] {
  let origin: string;
  try {
    origin = new URL(homepage).origin;
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const ranked: string[] = [];
  const hrefRe = /<a\b[^>]*href=["']([^"'#]+)["']/gi;
  let hit: RegExpExecArray | null;
  while ((hit = hrefRe.exec(html))) {
    const href = hit[1]?.trim();
    if (!href || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) {
      continue;
    }
    let abs: URL;
    try {
      abs = new URL(href, homepage);
    } catch {
      continue;
    }
    if (abs.origin !== origin) continue;
    abs.hash = "";
    const path = `${abs.pathname}${abs.search}`.toLowerCase();
    if (!EXTRA_PAGE_PATH.test(path)) continue;
    if (/(login|logout|signup|cart|wp-admin|cdn-cgi)/i.test(path)) continue;
    const key = abs.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    ranked.push(key);
    if (ranked.length >= limit * 4) break;
  }
  return ranked.slice(0, limit);
}

function hreflangEvidence(html: string, pageUrl: string): LanguageEvidence[] {
  const found = new Map<string, CanonicalLanguage>();
  const re = /hreflang\s*=\s*["']([a-z]{2,8}(?:-[a-z]{2,8})?)["']/gi;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(html))) {
    const tag = hit[1].toLowerCase();
    if (tag === "x-default") continue;
    const mapped =
      HREFLANG_TO_LANGUAGE[tag] ?? HREFLANG_TO_LANGUAGE[tag.split("-")[0] ?? ""];
    if (mapped) found.set(tag, mapped);
  }
  if (found.size < 2) return [];
  return [...new Set(found.values())].map((language) => ({
    language,
    snippet: `hreflang switcher (${[...found.keys()].sort().join(", ")})`,
    sourceUrl: pageUrl,
    kind: "hreflang-switcher" as const,
  }));
}

export function extractLanguageEvidence(
  html: string,
  pageUrl: string,
): LanguageEvidence[] {
  const evidence: LanguageEvidence[] = [];
  evidence.push(...hreflangEvidence(html, pageUrl));

  const text = htmlToText(html);
  if (!text) return dedupeEvidence(evidence);

  if (HABLAMOS_RE.test(text) || SE_HABLA_RE.test(text)) {
    const match = text.match(HABLAMOS_RE) ?? text.match(SE_HABLA_RE);
    if (match && match.index != null) {
      evidence.push({
        language: "Spanish",
        snippet: snippetAround(text, match.index, match[0].length),
        sourceUrl: pageUrl,
        kind: "offering-phrase",
      });
    }
  }

  type Hit = {
    language: CanonicalLanguage;
    index: number;
    match: string;
  };
  const hits: Hit[] = [];
  for (const pattern of LANGUAGE_PATTERNS) {
    for (const found of findMatches(text, pattern.regex)) {
      hits.push({
        language: pattern.language,
        index: found.index,
        match: found.match,
      });
    }
  }
  hits.sort((a, b) => a.index - b.index);

  for (const hit of hits) {
    if (hit.language === "English") {
      const local = text.slice(
        Math.max(0, hit.index - 40),
        Math.min(text.length, hit.index + hit.match.length + 40),
      );
      if (ENGLISH_SKIP_RE.test(local)) continue;
    }

    const nearbyOther = hits.some(
      (other) =>
        other.language !== hit.language &&
        Math.abs(other.index - hit.index) <= 48,
    );
    const offering = windowHasOffering(text, hit.index, hit.match.length);
    const staff = windowIsStaffBio(text, hit.index, hit.match.length);

    if (!nearbyOther && !offering && !staff) continue;

    evidence.push({
      language: hit.language,
      snippet: snippetAround(text, hit.index, hit.match.length),
      sourceUrl: pageUrl,
      kind: staff
        ? "staff-bio"
        : nearbyOther
          ? "language-list"
          : "offering-phrase",
    });
  }

  return dedupeEvidence(evidence);
}

function dedupeEvidence(items: LanguageEvidence[]): LanguageEvidence[] {
  const seen = new Set<string>();
  const out: LanguageEvidence[] = [];
  for (const item of items) {
    const key = `${item.language}|${item.sourceUrl}|${item.kind}|${item.snippet.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.filter((row) => row.language === item.language).length >= 2) {
      // keep at most two snippets per language; drop later dupes of same language+url
    }
  }
  const perLanguage = new Map<string, number>();
  return out.filter((item) => {
    const key = `${item.language}|${item.sourceUrl}`;
    const n = perLanguage.get(key) ?? 0;
    if (n >= 2) return false;
    perLanguage.set(key, n + 1);
    return true;
  });
}

export function runSelfChecks(): void {
  const formatOk = checkStoredUrlFormat("https://example.org/");
  if (!formatOk.ok) throw new Error("self-check: valid URL failed format");
  if (checkStoredUrlFormat("example.org").ok) {
    throw new Error("self-check: missing scheme should fail");
  }
  if (checkStoredUrlFormat("https://catholiccharitie").ok) {
    throw new Error("self-check: truncated host should fail");
  }

  const sameHost = isUnrelatedRedirect(
    "https://worldrelief.org/",
    "https://www.worldrelief.org/spokane",
  );
  if (sameHost.unrelated) throw new Error("self-check: www/apex should be related");

  const google = isUnrelatedRedirect(
    "https://abundantloveworshipcenter.org/",
    "https://www.google.com/search?q=abundant",
  );
  if (!google.unrelated) throw new Error("self-check: google search should be unrelated");

  const spanish = extractLanguageEvidence(
    "<html><body>We speak Spanish and Arabic. Hablamos español.</body></html>",
    "https://example.org/",
  );
  const spanishNames = new Set(spanish.map((row) => row.language));
  if (!spanishNames.has("Spanish") || !spanishNames.has("Arabic")) {
    throw new Error(`self-check: expected Spanish+Arabic, got ${[...spanishNames]}`);
  }

  const nameOnly = extractLanguageEvidence(
    "<html><body>Centro Latino of Omaha welcomes families.</body></html>",
    "https://example.org/",
  );
  if (nameOnly.some((row) => row.language === "Spanish")) {
    throw new Error("self-check: org-name inference leaked");
  }

  const switcher = extractLanguageEvidence(
    "<html><body>English | Español</body></html>",
    "https://example.org/",
  );
  const switcherNames = new Set(switcher.map((row) => row.language));
  if (!switcherNames.has("English") || !switcherNames.has("Spanish")) {
    throw new Error(`self-check: switcher missed, got ${[...switcherNames]}`);
  }

  const commonLaw = extractLanguageEvidence(
    "<html><body>The English common law tradition shaped this court.</body></html>",
    "https://example.org/",
  );
  if (commonLaw.some((row) => row.language === "English")) {
    throw new Error("self-check: isolated English should not count");
  }

  const esl = extractLanguageEvidence(
    "<html><body>We offer free English as a Second Language classes.</body></html>",
    "https://example.org/",
  );
  if (esl.some((row) => row.language === "English")) {
    throw new Error("self-check: ESL should not confirm English");
  }

  const hreflang = extractLanguageEvidence(
    `<html><head>
      <link rel="alternate" hreflang="en" href="https://example.org/" />
      <link rel="alternate" hreflang="es" href="https://example.org/es/" />
    </head><body>Home</body></html>`,
    "https://example.org/",
  );
  const hrefNames = new Set(hreflang.map((row) => row.language));
  if (!hrefNames.has("English") || !hrefNames.has("Spanish")) {
    throw new Error(`self-check: hreflang switcher missed, got ${[...hrefNames]}`);
  }

  const htmlLangOnly = extractLanguageEvidence(
    `<html lang="en"><head><link rel="alternate" hreflang="en" href="/" /></head><body>Welcome</body></html>`,
    "https://example.org/",
  );
  if (htmlLangOnly.some((row) => row.language === "English")) {
    throw new Error("self-check: single hreflang=en should not confirm English");
  }
}
