/**
 * Recognizes when a roster record describes a provider we already store under
 * no natural key (hand-seeded rows).
 *
 * Comparing name and city for equality is not enough in practice. EOIR appends
 * parenthetical acronyms ("California Immigration Project (CIP)"), omits the
 * city qualifiers curated rows tend to carry ("World Relief" vs "World Relief
 * Sacramento"), and disagrees about city labels where a row uses a census place
 * ("Arden-Arcade") for an address EOIR files under the city proper. Each of
 * those defeats equality while describing the same office.
 *
 * So names are compared token-wise, weighted by how rare each token is across
 * the roster: sharing "chirla" is close to proof, sharing "immigration" means
 * nothing. A ZIP or city agreement then has to corroborate the name, which
 * keeps distinct offices of the same multi-city organization apart.
 *
 * A second, independent signal covers acronym-first branding: a short name
 * whose only non-city token equals a parenthetical acronym on a longer
 * spelled-out name ("RAICES San Antonio" ↔ "… Legal Services (RAICES)").
 * That path does not change the overlap thresholds, which correctly reject
 * generic near-misses (CRLA / CAIR-style) that sit on the ZIP-corroborated
 * boundary.
 *
 * Matches are only ever reported for human review. Nothing here mutates rows.
 *
 * A match whose only name evidence is one rare token still needs a manual
 * EIN cross-check (GuideStar / ProPublica) before it is attached. Rarity
 * cannot tell a brand ("hias") from a population-category word that is
 * merely uncommon in this catalog ("korean"). See
 * `needsEinCrossVerification`. The matcher never looks up EINs.
 */
import { slugify } from "@/lib/ingestion/eoir/normalize";

export type MatchCandidate = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** Passed through for reports; not used when scoring a match. */
  legacyId?: string | null;
};

export type DuplicateMatch = {
  candidate: MatchCandidate;
  /** Weighted share of the shorter name the two have in common, in [0, 1]. */
  score: number;
  sameZip: boolean;
  /** The shared tokens that are not city names — the actual evidence. */
  matchedOn: string[];
  /**
   * `overlap` is the token-weight thresholds. `acronym` is independent of
   * those scores: a short branded name whose only non-city token equals a
   * parenthetical acronym on the longer name.
   */
  via: "overlap" | "acronym";
};

/** Legal suffixes and connectives, which never carry identity. */
const NOISE_TOKENS = new Set([
  "inc", "llc", "llp", "pc", "apc", "aplc", "pa", "pllc", "incorporated",
  "the", "of", "and", "for", "a", "an", "in", "at",
]);

/**
 * Cross-city parent evidence must be long enough to be a word, not a
 * coincidence fragment ("nfp", "mi", "us", "nc"). Same-city matching is
 * unchanged and still uses `identityTokens` (length > 1).
 */
const PARENT_MIN_TOKEN_LENGTH = 4;

/**
 * Legal-entity suffix fragments. Short ones are also caught by the
 * min-length gate; four-letter ones ("corp") would otherwise look like
 * rare brands when they appear in few unique names.
 */
const CORPORATE_SUFFIX_TOKENS = new Set([
  "inc", "incorporated", "llc", "llp", "lp", "pc", "pa", "pllc", "apc", "aplc",
  "corp", "corporation", "co", "company", "ltd", "limited", "plc",
  "nfp", "npo", "nonprofit", "org",
]);

/** Two-letter parentheticals that are USPS codes, not organization acronyms. */
const USPS_STATE_SLUGS = new Set([
  "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga", "hi", "id",
  "il", "in", "ia", "ks", "ky", "la", "me", "md", "ma", "mi", "mn", "ms",
  "mo", "mt", "ne", "nv", "nh", "nj", "nm", "ny", "nc", "nd", "oh", "ok",
  "or", "pa", "ri", "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv",
  "wi", "wy", "dc",
]);

/**
 * Program-of words that sit on acronym-first brands ("HIAS New York Legal
 * Services") the same way a city qualifier does. Used only by the acronym
 * signal — overlap scoring is unchanged.
 */
const GENERIC_BRAND_TOKENS = new Set([
  "legal", "services", "service", "center", "project", "foundation",
  "clinic", "program", "unit", "office", "law",
]);

/** One name is essentially contained in the other. */
const CONTAINMENT_SCORE = 0.85;
/** A partial name overlap, acceptable only with a ZIP agreement behind it. */
const CORROBORATED_SCORE = 0.45;

/**
 * Cap on how many *unique names* a token may appear in and still count as a
 * parent-identifying brand signal. Computed from the unique-name DF
 * distribution of `corpusNames`: the 90th percentile of per-token
 * frequencies, floored at 2 so a brand that exists under two spellings is
 * not treated as vocabulary.
 *
 * Cross-city matching cannot use the same containment ratio as same-city
 * matching. IDF down-weights "immigration" but the ratio is still 1.0 when
 * the shorter name is *only* common words. Those tokens have to drop out of
 * the evidence set entirely. The uniqueness corpus for this cap must be the
 * candidate pool (the catalog), not the incoming roster — otherwise ethnic
 * community vocabulary that is common among BMF filers looks like a brand
 * collision against a catalog that barely uses it, and vice versa.
 */
export function parentIdentifyingDfCap(documentFrequencies: number[]): number {
  if (documentFrequencies.length === 0) return 2;
  const sorted = [...documentFrequencies].sort((a, b) => a - b);
  const idx = Math.floor(0.9 * (sorted.length - 1));
  return Math.max(2, sorted[idx] ?? 1);
}

/**
 * Shape gate for cross-city parent evidence, applied before rarity.
 * A short or typed-as-suffix/state token being infrequent in the catalog
 * is coincidence, not a brand signal.
 */
export function isParentBrandTokenShape(token: string): boolean {
  if (token.length < PARENT_MIN_TOKEN_LENGTH) return false;
  if (USPS_STATE_SLUGS.has(token)) return false;
  if (CORPORATE_SUFFIX_TOKENS.has(token)) return false;
  return true;
}

export function identityTokens(name: string): Set<string> {
  return new Set(
    slugify(name)
      .split("-")
      .filter((token) => token.length > 1 && !NOISE_TOKENS.has(token)),
  );
}

/** Last 5-digit group in a free-text address. */
export function zipFromAddress(address: string | null): string | null {
  const matches = (address ?? "").match(/\b(\d{5})\b/g);
  return matches ? matches[matches.length - 1] : null;
}

/** Natural keys end with "…-{zip}-{addressHash}". */
export function zipFromNaturalKey(key: string): string | null {
  const match = key.match(/-(\d{5})-[0-9a-f]{8}$/);
  return match ? match[1] : null;
}

function cityTokens(...cities: Array<string | null>): Set<string> {
  const tokens = new Set<string>();
  for (const city of cities) {
    for (const token of slugify(city ?? "").split("-")) {
      if (token) tokens.add(token);
    }
  }
  return tokens;
}

/**
 * Identity tokens that still carry a brand after stripping this row's city
 * and generic program-of words. Shared by the acronym matcher and the
 * post-sync proximity scan — overlap scoring does not use this set.
 */
export function brandIdentityTokens(
  name: string,
  city: string | null,
): Set<string> {
  const ignorable = cityTokens(city);
  return new Set(
    [...identityTokens(name)].filter(
      (token) => !ignorable.has(token) && !GENERIC_BRAND_TOKENS.has(token),
    ),
  );
}

/**
 * Parenthetical acronyms as printed: "(RAICES)", "(CIP)", "(CAIR-CA)".
 * Place names and prose in parentheses ("Silver Spring", "formerly CAIR")
 * are ignored.
 */
export function parentheticalAcronyms(name: string): Set<string> {
  const found = new Set<string>();
  for (const match of name.matchAll(/\(([^)]+)\)/g)) {
    const inner = match[1].trim();
    if (/\s/.test(inner)) continue;
    if (
      /formerly|including|continued|^cont\b|^page\b|d\/?b\/?a/i.test(inner)
    ) {
      continue;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9.'’/-]{1,14}$/.test(inner)) continue;
    const slug = slugify(inner);
    if (!slug || NOISE_TOKENS.has(slug)) continue;
    if (slug.length === 2 && USPS_STATE_SLUGS.has(slug)) continue;
    found.add(slug);
    for (const part of slug.split("-")) {
      if (part.length >= 3 && !NOISE_TOKENS.has(part)) found.add(part);
    }
  }
  return found;
}

/**
 * The short side is an acronym-first brand: after stripping the city and
 * generic program-of words, exactly one identity token remains, that token is
 * a parenthetical acronym on the longer name, and the longer name is a
 * spelled-out expansion (not just the acronym plus a word or two).
 */
function acronymBrandHit(
  shortTokens: Set<string>,
  longTokens: Set<string>,
  longAcronyms: Set<string>,
  ignorable: Set<string>,
): string | null {
  if (longAcronyms.size === 0) return null;
  const brand = [...shortTokens].filter(
    (token) => !ignorable.has(token) && !GENERIC_BRAND_TOKENS.has(token),
  );
  if (brand.length !== 1) return null;
  const [token] = brand;
  if (!longAcronyms.has(token)) return null;
  const expansion = [...longTokens].filter((part) => part !== token).length;
  if (expansion < 3) return null;
  return token;
}

type IndexedCandidate = {
  candidate: MatchCandidate;
  tokens: Set<string>;
  citySlug: string;
};

export class DuplicateMatcher {
  private readonly documentFrequency = new Map<string, number>();
  private readonly uniqueNameDf = new Map<string, number>();
  private readonly corpusSize: number;
  readonly parentIdentifyingDfMax: number;
  private readonly all: IndexedCandidate[] = [];
  private readonly byCity = new Map<string, IndexedCandidate[]>();
  private readonly byZip = new Map<string, IndexedCandidate[]>();

  /**
   * @param corpusNames Names the rarity weighting is derived from. Same-city
   *   IDF uses this as the ingest population. Cross-city parent DF uses the
   *   unique names in this list, so callers of `findMatchesAnywhere` must
   *   pass the candidate pool (catalog names), not the incoming roster.
   * @param candidates Existing rows eligible to be matched against.
   */
  constructor(corpusNames: string[], candidates: MatchCandidate[]) {
    this.corpusSize = Math.max(corpusNames.length, 1);

    for (const name of corpusNames) {
      for (const token of identityTokens(name)) {
        this.documentFrequency.set(
          token,
          (this.documentFrequency.get(token) ?? 0) + 1,
        );
      }
    }

    const uniqueSlugs = new Set<string>();
    for (const name of corpusNames) {
      const slug = slugify(name);
      if (uniqueSlugs.has(slug)) continue;
      uniqueSlugs.add(slug);
      const seen = new Set<string>();
      for (const token of identityTokens(name)) {
        if (seen.has(token)) continue;
        seen.add(token);
        this.uniqueNameDf.set(token, (this.uniqueNameDf.get(token) ?? 0) + 1);
      }
    }
    this.parentIdentifyingDfMax = parentIdentifyingDfCap([
      ...this.uniqueNameDf.values(),
    ]);

    for (const candidate of candidates) {
      const indexed: IndexedCandidate = {
        candidate,
        tokens: identityTokens(candidate.name),
        citySlug: slugify(candidate.city ?? ""),
      };
      this.all.push(indexed);

      const cityBucket = this.byCity.get(indexed.citySlug) ?? [];
      cityBucket.push(indexed);
      this.byCity.set(indexed.citySlug, cityBucket);

      if (candidate.zip) {
        const zipBucket = this.byZip.get(candidate.zip) ?? [];
        zipBucket.push(indexed);
        this.byZip.set(candidate.zip, zipBucket);
      }
    }
  }

  /**
   * True when the token can identify a parent: long enough, not a state
   * abbreviation or corporate suffix, and rare enough by unique-name DF.
   */
  isParentIdentifyingToken(token: string): boolean {
    if (!isParentBrandTokenShape(token)) return false;
    return (this.uniqueNameDf.get(token) ?? 0) <= this.parentIdentifyingDfMax;
  }

  /**
   * Inverse document frequency, shifted so it stays positive even when a token
   * appears in every name — otherwise a small corpus (a `--limit` run, or a
   * unit test) yields negative weights and inverts the comparison.
   */
  private weight(token: string): number {
    return Math.log(
      1 + this.corpusSize / (1 + (this.documentFrequency.get(token) ?? 0)),
    );
  }

  private weigh(tokens: Iterable<string>): number {
    let total = 0;
    for (const token of tokens) total += this.weight(token);
    return total;
  }

  /**
   * Existing rows in the same place as this record. Sharing either the ZIP or
   * the city keeps genuinely separate offices of one organization apart, while
   * still tolerating the city-label disagreements EOIR data is full of.
   */
  private nearby(city: string, state: string, zip: string | null) {
    const seen = new Set<IndexedCandidate>();
    const citySlug = slugify(city);

    for (const indexed of this.byCity.get(citySlug) ?? []) seen.add(indexed);
    if (zip) for (const indexed of this.byZip.get(zip) ?? []) seen.add(indexed);

    return [...seen].filter(
      (indexed) =>
        indexed.candidate.state === null || indexed.candidate.state === state,
    );
  }

  private matchPair(
    record: {
      name: string;
      city: string;
      state: string;
      zip: string | null;
    },
    indexed: IndexedCandidate,
    tokens: Set<string>,
    smallest: number,
    acceptPartialWithZip: boolean,
  ): DuplicateMatch | null {
    const shared = [...tokens].filter((token) => indexed.tokens.has(token));
    if (shared.length === 0) return null;

    const ignorable = cityTokens(record.city, indexed.candidate.city);
    const matchedOn = shared.filter((token) => !ignorable.has(token));
    // Agreeing only on a city name is not evidence of the same provider.
    if (matchedOn.length === 0) return null;

    const denominator = Math.min(smallest, this.weigh(indexed.tokens));
    if (denominator <= 0) return null;

    const score = this.weigh(shared) / denominator;
    const sameZip = record.zip !== null && indexed.candidate.zip === record.zip;

    const overlapAccepted =
      score >= CONTAINMENT_SCORE ||
      (acceptPartialWithZip && sameZip && score >= CORROBORATED_SCORE);

    const acronym =
      acronymBrandHit(
        tokens,
        indexed.tokens,
        parentheticalAcronyms(indexed.candidate.name),
        ignorable,
      ) ??
      acronymBrandHit(
        indexed.tokens,
        tokens,
        parentheticalAcronyms(record.name),
        ignorable,
      );

    if (!overlapAccepted && !acronym) return null;

    const evidence = new Set(matchedOn);
    if (acronym) evidence.add(acronym);

    return {
      candidate: indexed.candidate,
      score,
      sameZip,
      via: overlapAccepted ? "overlap" : "acronym",
      matchedOn: [...evidence].sort((a, b) => this.weight(b) - this.weight(a)),
    };
  }

  /** Candidate duplicates for one roster record, strongest first. */
  findMatches(record: {
    name: string;
    city: string;
    state: string;
    zip: string | null;
  }): DuplicateMatch[] {
    const tokens = identityTokens(record.name);
    const smallest = this.weigh(tokens);
    const matches: DuplicateMatch[] = [];

    for (const indexed of this.nearby(record.city, record.state, record.zip)) {
      const hit = this.matchPair(record, indexed, tokens, smallest, true);
      if (hit) matches.push(hit);
    }

    return matches.sort(
      (a, b) => Number(b.sameZip) - Number(a.sameZip) || b.score - a.score,
    );
  }

  /**
   * Cross-city parent match. Same containment / acronym tests as
   * `findMatches`, but only tokens that pass `isParentBrandTokenShape` and
   * whose unique-name DF is at or below `parentIdentifyingDfMax` count as
   * evidence. Common organizational vocabulary therefore cannot produce a
   * 1.0 containment score just because it is the entirety of a short catalog
   * name, and a rare two-letter fragment is not treated as a brand.
   *
   * A 1.0 score on a single surviving rare token is not identity. Report
   * writers must flag those hits with `needsEinCrossVerification` and a
   * human must compare EINs before attaching an alias.
   */
  findMatchesAnywhere(record: {
    name: string;
    city: string;
    state: string;
    zip: string | null;
  }): DuplicateMatch[] {
    const tokens = identityTokens(record.name);
    const matches: DuplicateMatch[] = [];

    for (const indexed of this.all) {
      const hit = this.matchPairAnywhere(record, indexed, tokens);
      if (hit) matches.push(hit);
    }

    return matches.sort(
      (a, b) => Number(b.sameZip) - Number(a.sameZip) || b.score - a.score,
    );
  }

  private matchPairAnywhere(
    record: {
      name: string;
      city: string;
      state: string;
      zip: string | null;
    },
    indexed: IndexedCandidate,
    tokens: Set<string>,
  ): DuplicateMatch | null {
    const ignorable = cityTokens(record.city, indexed.candidate.city);
    const rareIncoming = [...tokens].filter(
      (token) => this.isParentIdentifyingToken(token) && !ignorable.has(token),
    );
    const rareCandidate = [...indexed.tokens].filter(
      (token) => this.isParentIdentifyingToken(token) && !ignorable.has(token),
    );
    const rareShared = rareIncoming.filter((token) => indexed.tokens.has(token));

    const acronym =
      acronymBrandHit(
        tokens,
        indexed.tokens,
        parentheticalAcronyms(indexed.candidate.name),
        ignorable,
      ) ??
      acronymBrandHit(
        indexed.tokens,
        tokens,
        parentheticalAcronyms(record.name),
        ignorable,
      );
    const rareAcronym =
      acronym && this.isParentIdentifyingToken(acronym) ? acronym : null;

    if (rareShared.length === 0 && !rareAcronym) return null;

    const denom = Math.min(this.weigh(rareIncoming), this.weigh(rareCandidate));
    const score = denom > 0 ? this.weigh(rareShared) / denom : 0;
    const overlapAccepted = denom > 0 && score >= CONTAINMENT_SCORE;
    if (!overlapAccepted && !rareAcronym) return null;

    const evidence = new Set(rareShared);
    if (rareAcronym) evidence.add(rareAcronym);

    return {
      candidate: indexed.candidate,
      score,
      sameZip: record.zip !== null && indexed.candidate.zip === record.zip,
      via: overlapAccepted ? "overlap" : "acronym",
      matchedOn: [...evidence].sort((a, b) => this.weight(b) - this.weight(a)),
    };
  }
}

/**
 * True when one name is a fragment or containment of the other. Used to
 * collapse same-batch office duplicates that only differ because a wrapped
 * name was parsed twice, once in full and once as the last line.
 */
export function namesIndicateSameOffice(a: string, b: string): boolean {
  const aSlug = slugify(a);
  const bSlug = slugify(b);
  if (!aSlug || !bSlug) return false;
  if (aSlug === bSlug) return true;
  if (aSlug.includes(bSlug) || bSlug.includes(aSlug)) return true;

  const aTok = identityTokens(a);
  const bTok = identityTokens(b);
  if (aTok.size === 0 || bTok.size === 0) return false;
  const [smaller, larger] =
    aTok.size <= bTok.size ? [aTok, bTok] : [bTok, aTok];
  return [...smaller].every((token) => larger.has(token));
}

/**
 * True when a reported match rests on exactly one rare token and the two
 * names are not the same legal-name token set.
 *
 * That is the KCSC/NAKASEC failure mode: `korean` is rare in this catalog,
 * so containment scores 1.0 against a different Korean org in the same
 * city. Ethnicity and population-category words will always be able to
 * fool a pure-rarity signal. Callers must require a human EIN
 * cross-check (GuideStar / ProPublica) before attaching; do not look EINs
 * up here, and do not treat this flag as an automatic exclude.
 *
 * An acronym-via hit is independent brand evidence and is not flagged.
 * `namesIndicateSameOffice` is *not* used as an exemption: it is too
 * loose (W&Z ⊂ STIC, WELCOME ⊂ "…Welcome Network").
 */
export function needsEinCrossVerification(args: {
  matchedOn: string[];
  via: DuplicateMatch["via"];
  incomingName: string;
  catalogName: string;
  isParentIdentifyingToken: (token: string) => boolean;
}): boolean {
  if (args.via === "acronym") return false;

  const incomingTokens = identityTokens(args.incomingName);
  const catalogTokens = identityTokens(args.catalogName);
  const sameLegalName =
    incomingTokens.size > 0 &&
    incomingTokens.size === catalogTokens.size &&
    [...incomingTokens].every((token) => catalogTokens.has(token));
  if (sameLegalName) return false;

  const rareEvidence = args.matchedOn.filter((token) =>
    args.isParentIdentifyingToken(token),
  );
  return rareEvidence.length === 1;
}
