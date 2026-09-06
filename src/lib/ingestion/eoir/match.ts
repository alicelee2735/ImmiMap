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
  private readonly corpusSize: number;
  private readonly byCity = new Map<string, IndexedCandidate[]>();
  private readonly byZip = new Map<string, IndexedCandidate[]>();

  /**
   * @param corpusNames Names the rarity weighting is derived from — the roster
   *   being ingested, which is the population these comparisons live in.
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

    for (const candidate of candidates) {
      const indexed: IndexedCandidate = {
        candidate,
        tokens: identityTokens(candidate.name),
        citySlug: slugify(candidate.city ?? ""),
      };

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
      const shared = [...tokens].filter((token) => indexed.tokens.has(token));
      if (shared.length === 0) continue;

      const ignorable = cityTokens(record.city, indexed.candidate.city);
      const matchedOn = shared.filter((token) => !ignorable.has(token));
      // Agreeing only on a city name is not evidence of the same provider.
      if (matchedOn.length === 0) continue;

      const denominator = Math.min(smallest, this.weigh(indexed.tokens));
      if (denominator <= 0) continue;

      const score = this.weigh(shared) / denominator;
      const sameZip = record.zip !== null && indexed.candidate.zip === record.zip;

      const overlapAccepted =
        score >= CONTAINMENT_SCORE || (sameZip && score >= CORROBORATED_SCORE);

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

      if (!overlapAccepted && !acronym) continue;

      const evidence = new Set(matchedOn);
      if (acronym) evidence.add(acronym);

      matches.push({
        candidate: indexed.candidate,
        score,
        sameZip,
        via: overlapAccepted ? "overlap" : "acronym",
        matchedOn: [...evidence].sort(
          (a, b) => this.weight(b) - this.weight(a),
        ),
      });
    }

    return matches.sort(
      (a, b) => Number(b.sameZip) - Number(a.sameZip) || b.score - a.score,
    );
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
