/**
 * Name-match scoring for website discovery.
 *
 * High-confidence means the domain or page title is a close match to the
 * organization's own name — close enough for a bulk approval pass. Directory
 * listings, news hits, weak token overlap, and competing hosts stay low.
 * This module does not fetch or write anything.
 */

export type SearchHit = {
  title: string;
  url: string;
  snippet?: string;
};

export type ScoredCandidate = {
  url: string;
  host: string;
  title: string;
  score: number;
  reasons: string[];
  flags: string[];
};

export type DiscoveryOrg = {
  name: string;
  city?: string | null;
  state?: string | null;
};

/** local = this office/org's own site. parent = national/HQ/umbrella site. */
export type WebsiteScope = "local" | "parent";

export type DiscoveryVerdict = {
  tier: "high" | "low";
  reason: string;
  candidate: ScoredCandidate | null;
  competitors: ScoredCandidate[];
  websiteScope: WebsiteScope | null;
};

const LEGAL_SUFFIXES = new Set([
  "inc",
  "llc",
  "ltd",
  "llp",
  "pllc",
  "pc",
  "pa",
  "corp",
  "co",
  "incorporated",
  "company",
]);

const SMALL_WORDS = new Set([
  "the",
  "and",
  "for",
  "of",
  "a",
  "an",
  "de",
  "la",
  "del",
  "los",
  "las",
  "el",
]);

const GENERIC_TOKENS = new Set([
  ...SMALL_WORDS,
  "law",
  "office",
  "offices",
  "group",
  "center",
  "centre",
  "services",
  "service",
  "legal",
  "immigration",
  "immigrant",
  "immigrants",
  "aid",
  "society",
  "association",
  "organization",
  "organisation",
  "org",
  "nonprofit",
  "community",
  "program",
  "programs",
  "project",
  "unit",
  "department",
  "clinic",
  "foundation",
  "fund",
  "network",
  "institute",
  "institutes",
  "international",
  "national",
  "american",
  "united",
  "states",
  "usa",
  "us",
  "san",
  "santa",
  "new",
  "north",
  "south",
  "east",
  "west",
  "area",
  "bay",
  "county",
  "city",
  "valley",
  "region",
  "regional",
  "principal",
  "extension",
  "mailing",
]);

const DIRECTORY_HOSTS = [
  "facebook.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "linkedin.com",
  "yelp.com",
  "yellowpages.com",
  "mapquest.com",
  "google.com",
  "bing.com",
  "youtube.com",
  "wikipedia.org",
  "guidestar.org",
  "charitynavigator.org",
  "causeiq.com",
  "propublica.org",
  "greatnonprofits.org",
  "idealist.org",
  "volunteermatch.org",
  "bbb.org",
  "manta.com",
  "zoominfo.com",
  "bloomberg.com",
  "findlaw.com",
  "justia.com",
  "avvo.com",
  "martindale.com",
  "superlawyers.com",
  "nolo.com",
  "reddit.com",
  "immigrationadvocates.org",
  "immigrationlawhelp.org",
  "lawhelp.org",
  "lsc.gov",
  "justice.gov",
  "uscis.gov",
  "americanbar.org",
  "dnb.com",
  "opencorporates.com",
  "rocketreach.co",
  "irs.gov",
  "apps.irs.gov",
  "charitywatch.org",
  "mapquest.com",
  "apple.com",
  "maps.apple.com",
  "findhelp.org",
  "chamberofcommerce.com",
  "insideimmigration.com",
  "greatnonprofits.org",
  "bizprofile.net",
  "orgcouncil.com",
];

const NEWS_HOSTS = [
  "nytimes.com",
  "washingtonpost.com",
  "latimes.com",
  "sfchronicle.com",
  "chron.com",
  "patch.com",
  "medium.com",
  "substack.com",
  "reuters.com",
  "apnews.com",
  "cnn.com",
  "nbcnews.com",
  "cbsnews.com",
  "abcnews.go.com",
  "npr.org",
  "theguardian.com",
  "forbes.com",
  "businessinsider.com",
];

const HIGH_SCORE = 60;
const COMPETITOR_GAP = 15;

/** Domains that belong to a national/regional network, not a single office. */
const PARENT_DOMAIN_LABELS = new Set([
  "worldrelief",
  "rescue",
  "theirc",
  "irco",
  "hias",
  "kind",
  "supportkind",
  "cwsglobal",
  "churchworldservice",
  "catholiccharitiesusa",
  "lirs",
  "switchboard",
  "uscirefugees",
]);

const NETWORK_PATH =
  /\/(locations?|offices?|chapters?|affiliates?|find-?(an?-)?(office|us|location)|our-locations|where-we-work|local-offices?)\b/i;

const REGIONAL_PATH =
  /\/(western|eastern|northern|southern)-[a-z]{2}\b|\/(field-office|local-office|king-county)\b/i;

function preferredAcronym(name: string, all: string[]): string {
  const paren = name.match(/\(([A-Za-z][A-Za-z0-9]{2,7})\)/);
  if (paren?.[1]) return paren[1].toLowerCase();

  const dash = name.match(/[-–—]\s*([A-Z]{3,8})\s*$/);
  if (dash?.[1]) return dash[1].toLowerCase();

  const caps = name.split(/[\s/,]+/).find((token) => /^[A-Z]{3,8}$/.test(token));
  if (caps) return caps.toLowerCase();

  return all
    .filter((token, index) => token.length > 0 && (!SMALL_WORDS.has(token) || index === 0))
    .map((token) => token[0])
    .join("");
}

function acronymFitsLabel(label: string, acronym: string): boolean {
  if (acronym.length < 4) return false;
  return label === acronym || label === `my${acronym}` || label.startsWith(acronym);
}

export function tokenize(raw: string): string[] {
  return String(raw)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function nameParts(org: DiscoveryOrg): {
  all: string[];
  distinctive: string[];
  place: string[];
  slug: string;
  acronym: string;
  normalized: string;
} {
  const all = tokenize(org.name).filter((t) => !LEGAL_SUFFIXES.has(t));
  const cityTokens = tokenize(org.city ?? "");
  const stateTokens = tokenize(org.state ?? "");
  const place = [...new Set([...cityTokens, ...stateTokens])].filter(
    (t) => t.length > 2 && !LEGAL_SUFFIXES.has(t),
  );
  const distinctive = all.filter(
    (t) => t.length > 2 && !GENERIC_TOKENS.has(t) && !place.includes(t),
  );
  const slug = (distinctive.length > 0 ? distinctive : all).join("");
  const acronym = preferredAcronym(org.name, all);
  return {
    all,
    distinctive,
    place,
    slug,
    acronym,
    normalized: all.join(" "),
  };
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

export function registrableDomain(host: string): string {
  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) return host;
  return labels.slice(-2).join(".");
}

export function domainLabel(host: string): string {
  const registrable = registrableDomain(host);
  return registrable.split(".")[0]?.replace(/-/g, "") ?? "";
}

export function isDirectoryHost(host: string): boolean {
  return DIRECTORY_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

export function isNewsHost(host: string): boolean {
  return NEWS_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

function decodeBasicEntities(raw: string): string {
  return raw
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

/**
 * Normalize a search-result URL before scoring or writing.
 *
 * Serper (and similar SERPs) glue a delimiter or truncate the TLD:
 * `http://www.lupenet.org;`, `https://hicaalabama.org/en/home;`,
 * `http://www.catholiccharitiesdc.o`, `http://www.firclaw.org&nbsp;..."`.
 * `new URL()` accepts most of that, so a high name-match would otherwise
 * write a broken Website button. Strip the leftover punctuation, reject a
 * 1-letter / non-alpha TLD, and fail closed on leftover HTML.
 */
export function sanitizeDiscoveredWebsiteUrl(raw: string): string | null {
  if (!raw) return null;
  let trimmed = decodeBasicEntities(String(raw)).trim();
  if (!trimmed) return null;
  trimmed = trimmed.split(/\s+/)[0] ?? "";
  trimmed = trimmed.replace(/^["'<\[]+/, "").replace(/["'>\]]+$/, "");
  trimmed = trimmed.replace(/[.,;:]+$/g, "");
  if (!trimmed) return null;

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;

    url.hostname = url.hostname.replace(/;+/g, "").replace(/\.+$/, "").toLowerCase();
    url.pathname = url.pathname.replace(/;+$/g, "");
    url.hash = "";
    url.protocol = "https:";
    url.username = "";
    url.password = "";

    const host = url.hostname;
    if (!host.includes(".")) return null;
    if (/[^a-z0-9.-]/i.test(host)) return null;
    const tld = host.split(".").pop() ?? "";
    if (!/^[a-z]{2,24}$/i.test(tld)) return null;

    const href = url.toString();
    return href.replace(/\/$/, "") || url.origin;
  } catch {
    return null;
  }
}

function titleNormalized(title: string): string {
  return tokenize(title)
    .filter((t) => !LEGAL_SUFFIXES.has(t) && t !== "home" && t !== "official" && t !== "website")
    .join(" ");
}

function coreNormalizedName(name: string): string {
  return tokenize(name.replace(/\([^)]*\)/g, " "))
    .filter((t) => !LEGAL_SUFFIXES.has(t))
    .join(" ");
}

function countHits(haystack: string, tokens: string[]): number {
  return tokens.filter((t) => haystack.includes(t)).length;
}

/** True when the domain label is a concatenation of the org's own name tokens. */
export function domainCoveredByName(
  label: string,
  tokens: string[],
  state?: string | null,
): boolean {
  if (!label || tokens.length === 0) return false;
  let rest = label;
  let used = 0;
  for (const token of tokens) {
    if (token.length < 2) continue;
    if (rest.startsWith(token)) {
      rest = rest.slice(token.length);
      used += 1;
    }
  }
  if (rest === "" && (used >= 2 || (used === 1 && tokens.filter((t) => t.length >= 2).length === 1))) {
    return true;
  }
  const stateAbbr = (state ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return (
    used >= 2 &&
    stateAbbr.length === 2 &&
    rest === stateAbbr
  );
}

export function scoreCandidate(org: DiscoveryOrg, hit: SearchHit): ScoredCandidate | null {
  const url = sanitizeDiscoveredWebsiteUrl(hit.url);
  if (!url) return null;
  const host = hostOf(url);
  if (!host) return null;

  const flags: string[] = [];
  const reasons: string[] = [];
  if (isDirectoryHost(host)) {
    return {
      url,
      host,
      title: hit.title ?? "",
      score: 0,
      reasons: ["directory or social listing"],
      flags: ["directory"],
    };
  }
  if (isNewsHost(host)) flags.push("news");

  const parts = nameParts(org);
  const label = domainLabel(host);
  const title = titleNormalized(hit.title ?? "");
  const hay = `${title} ${tokenize(hit.snippet ?? "").join(" ")} ${label} ${host}`;
  let score = 0;

  const covered = domainCoveredByName(label, parts.all, org.state);
  const acronymDomain = acronymFitsLabel(label, parts.acronym);
  const exactShortName =
    parts.all.length === 1 && label === parts.slug && parts.slug.length >= 4;
  const exactLongSlug =
    parts.slug.length >= 8 &&
    (label === parts.slug || label.startsWith(parts.slug));
  const strongDomain =
    covered ||
    acronymDomain ||
    exactShortName ||
    exactLongSlug ||
    (parts.slug.length >= 8 && label.includes(parts.slug)) ||
    (parts.slug.length >= 8 &&
      parts.slug.includes(label) &&
      label.length >= 8 &&
      label.length / parts.slug.length >= 0.7);

  const acronymTitleBoost =
    parts.acronym.length === 3 &&
    label === parts.acronym &&
    parts.normalized.length >= 10 &&
    title.includes(parts.normalized);

  if (covered && label.length >= 4) {
    score += 60;
    reasons.push("domain is made of the organization name");
    if (label === parts.normalized || label === parts.slug) {
      score += 15;
      reasons.push("domain equals the organization name");
    }
  } else if (acronymDomain) {
    score += 45;
    reasons.push("domain matches acronym");
    if (acronymFitsLabel(label, parts.acronym)) {
      score += 15;
      reasons.push("acronym is the domain");
    }
  } else if (acronymTitleBoost) {
    score += 40;
    reasons.push("short acronym domain with full name in title");
  } else if (exactShortName || exactLongSlug) {
    score += 50;
    reasons.push("domain matches name slug");
  } else if (parts.slug.length >= 8 && label.includes(parts.slug)) {
    score += 40;
    reasons.push("domain contains name slug");
  } else if (
    parts.slug.length >= 8 &&
    parts.slug.includes(label) &&
    label.length >= 8 &&
    label.length / parts.slug.length >= 0.7
  ) {
    score += 35;
    reasons.push("name slug contains domain");
  } else {
    const longest = [...parts.distinctive].sort((a, b) => b.length - a.length)[0];
    if (longest && longest.length >= 8 && (label === longest || label.startsWith(longest))) {
      score += 32;
      reasons.push(`domain starts with distinctive token "${longest}"`);
    }
  }

  const coreName = coreNormalizedName(org.name);
  const titleIsName =
    title === parts.normalized ||
    title === coreName ||
    (coreName.length >= 8 && (title.startsWith(`${coreName} `) || title.endsWith(coreName)));

  if (titleIsName) {
    score += 35;
    reasons.push("title starts with organization name");
  } else if (coreName.length >= 10 && title.includes(coreName)) {
    score += 28;
    reasons.push("title contains organization name");
  } else if (parts.distinctive.length > 0) {
    const hits = countHits(title, parts.distinctive);
    if (hits === parts.distinctive.length) {
      score += 20;
      reasons.push("title contains all distinctive name tokens");
    } else if (hits > 0) {
      score += Math.min(12, hits * 4);
      reasons.push(`title contains ${hits}/${parts.distinctive.length} distinctive tokens`);
    }
  }

  const placeHay = hay;
  const placeHits = parts.place.filter((t) => t.length > 2 && placeHay.includes(t));
  if (placeHits.length > 0) {
    score += 8;
    reasons.push("city/state mentioned");
  } else if (
    parts.place.length > 0 &&
    !strongDomain &&
    !acronymTitleBoost &&
    !titleIsName
  ) {
    score -= 25;
    flags.push("missing-place");
    reasons.push("city/state not found on candidate");
  }

  const registrable = registrableDomain(host);
  if (/\.(org|gov|edu)$/i.test(registrable)) {
    score += 5;
    reasons.push("org/gov/edu domain");
  }

  try {
    const path = new URL(url).pathname;
    const homepage = path === "/" || path === "";
    if (homepage) {
      score += 5;
      reasons.push("homepage");
    }
    if (titleIsName && homepage && /\.(org|gov|edu)$/i.test(registrable)) {
      score += 20;
      reasons.push("organization name is the homepage title");
    }
  } catch {
    // ignore
  }

  if (flags.includes("news")) {
    score = Math.min(score, 50);
    reasons.push("news host capped");
  }

  if (score < 0) score = 0;
  if (reasons.length === 0) reasons.push("weak or generic match");

  return {
    url,
    host,
    title: hit.title ?? "",
    score,
    reasons,
    flags,
  };
}

function distinctivePlacesNamedInOrg(name: string): string[] {
  const lower = name.toLowerCase();
  const idx = lower.lastIndexOf(" of ");
  if (idx === -1) return [];
  return tokenize(name.slice(idx + 4)).filter(
    (token) => token.length > 2 && !GENERIC_TOKENS.has(token) && !LEGAL_SUFFIXES.has(token),
  );
}

function domainMentionsRowPlace(org: DiscoveryOrg, host: string): boolean {
  const label = domainLabel(host);
  const cityTokens = tokenize(org.city ?? "").filter(
    (token) => token.length > 3 && !GENERIC_TOKENS.has(token),
  );
  if (cityTokens.some((token) => label.includes(token))) return true;
  const state = (org.state ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (state.length === 2) {
    return label.startsWith(state) || label.endsWith(state);
  }
  return false;
}

function namePlaceDoesNotMatchRowCity(org: DiscoveryOrg): boolean {
  const named = distinctivePlacesNamedInOrg(org.name);
  if (named.length === 0) return false;
  const city = new Set(tokenize(org.city ?? "").filter((token) => token.length > 2));
  return named.every((token) => !city.has(token));
}

function candidatePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

/**
 * Split a high-confidence name match into an office-specific site vs a
 * parent/national/HQ umbrella. Low-confidence rows should not call this.
 */
export function classifyWebsiteScope(
  org: DiscoveryOrg,
  candidate: ScoredCandidate,
): WebsiteScope {
  const label = domainLabel(candidate.host);
  if (PARENT_DOMAIN_LABELS.has(label)) return "parent";
  if (namePlaceDoesNotMatchRowCity(org) && !domainMentionsRowPlace(org, candidate.host)) {
    return "parent";
  }
  const path = candidatePath(candidate.url);
  const networkPage = NETWORK_PATH.test(path) || REGIONAL_PATH.test(path);
  if (networkPage && !domainMentionsRowPlace(org, candidate.host)) {
    return "parent";
  }
  return "local";
}

function bestPerDomain(scored: ScoredCandidate[]): ScoredCandidate[] {
  const byDomain = new Map<string, ScoredCandidate>();
  for (const candidate of scored) {
    const domain = registrableDomain(candidate.host);
    const current = byDomain.get(domain);
    if (!current || candidate.score > current.score) {
      byDomain.set(domain, candidate);
    }
  }
  return [...byDomain.values()].sort((a, b) => b.score - a.score);
}

export function chooseWebsiteMatch(
  org: DiscoveryOrg,
  hits: SearchHit[],
): DiscoveryVerdict {
  const scored = hits
    .map((hit) => scoreCandidate(org, hit))
    .filter((row): row is ScoredCandidate => row != null && row.score > 0);
  const ranked = bestPerDomain(scored);

  if (ranked.length === 0) {
    const onlyDirectories = hits.length > 0;
    return {
      tier: "low",
      reason: onlyDirectories
        ? "no first-party site; search hits were directories, social, or unrelated"
        : "no search hits",
      candidate: null,
      competitors: [],
      websiteScope: null,
    };
  }

  const [best, ...rest] = ranked;
  const competitor = rest.find(
    (row) => row.score >= best.score - COMPETITOR_GAP && row.score >= 40,
  );
  const strongEnough = best.score >= HIGH_SCORE;
  const distinctiveEnough = best.reasons.some(
    (reason) =>
      reason.includes("domain") ||
      reason.includes("acronym") ||
      reason.includes("title starts with organization name") ||
      reason.includes("title contains organization name"),
  );

  if (strongEnough && distinctiveEnough && !competitor && !best.flags.includes("news")) {
    return {
      tier: "high",
      reason: best.reasons[0] ?? "close name match",
      candidate: best,
      competitors: rest.slice(0, 3),
      websiteScope: classifyWebsiteScope(org, best),
    };
  }

  if (competitor) {
    return {
      tier: "low",
      reason: `ambiguous — ${registrableDomain(best.host)} vs ${registrableDomain(competitor.host)}`,
      candidate: best,
      competitors: rest.slice(0, 3),
      websiteScope: null,
    };
  }

  return {
    tier: "low",
    reason: distinctiveEnough
      ? `weak match (${best.score})`
      : best.reasons[0] ?? "weak or generic match",
    candidate: best,
    competitors: rest.slice(0, 3),
    websiteScope: null,
  };
}
