import type { LanguageEvidence, LanguageEvidenceKind } from "@/types/database.types";

const EVIDENCE_KINDS = new Set<LanguageEvidenceKind>([
  "offering-phrase",
  "language-list",
  "switcher",
  "staff-bio",
  "hreflang-switcher",
]);

const KIND_RANK: Record<LanguageEvidenceKind, number> = {
  "staff-bio": 0,
  "offering-phrase": 1,
  "language-list": 2,
  switcher: 3,
  "hreflang-switcher": 4,
};

const SNIPPET_MAX = 240;

export function isLanguageEvidenceKind(
  value: unknown,
): value is LanguageEvidenceKind {
  return typeof value === "string" && EVIDENCE_KINDS.has(value as LanguageEvidenceKind);
}

/**
 * Parse a stored `languages_evidence` value. English is dropped: this trail
 * is only for website-confirmed non-English languages.
 */
export function parseLanguageEvidence(value: unknown): LanguageEvidence[] {
  if (!Array.isArray(value)) return [];
  const out: LanguageEvidence[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const language =
      typeof rec.language === "string" ? rec.language.trim() : "";
    const sourceUrl =
      typeof rec.sourceUrl === "string" ? rec.sourceUrl.trim() : "";
    const snippet = typeof rec.snippet === "string" ? rec.snippet.trim() : "";
    if (!language || language === "English") continue;
    if (!sourceUrl) continue;
    if (!isLanguageEvidenceKind(rec.kind)) continue;
    const key = `${language}|${sourceUrl}|${rec.kind}|${snippet.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      language,
      sourceUrl,
      snippet: snippet.slice(0, SNIPPET_MAX),
      kind: rec.kind,
    });
  }

  return out;
}

/** One trail row per language, preferring staff bios and offering phrases. */
export function pickBestLanguageEvidence(
  items: LanguageEvidence[],
): LanguageEvidence[] {
  const best = new Map<string, LanguageEvidence>();
  for (const item of parseLanguageEvidence(items)) {
    const prev = best.get(item.language);
    if (!prev || KIND_RANK[item.kind] < KIND_RANK[prev.kind]) {
      best.set(item.language, item);
    }
  }
  return [...best.values()].sort((a, b) => a.language.localeCompare(b.language));
}

export function mergeOrganizationLanguages(
  current: string[] | null | undefined,
  added: string[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const language of [...(current ?? []), ...added]) {
    const trimmed = language.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  out.sort((a, b) => {
    if (a === "English") return -1;
    if (b === "English") return 1;
    return a.localeCompare(b);
  });
  return out;
}

export type SplitLanguages = {
  confirmed: string[];
  assumed: string[];
};

/**
 * Confirmed vs assumed for the detail sheet.
 *
 * Evidence present → those languages are confirmed; remaining names in
 * `languages` (typically English) stay assumed.
 * No evidence + `languagesConfirmed === false` → the 547 assumed-English rows.
 * No evidence + confirmed/legacy → the whole list is confirmed.
 */
export function splitLanguagesForDisplay(
  languages: string[] | undefined,
  languagesConfirmed: boolean | undefined,
  evidence: LanguageEvidence[] | undefined,
): SplitLanguages {
  const list = (languages ?? []).map((language) => language.trim()).filter(Boolean);
  const confirmedSet = new Set(
    parseLanguageEvidence(evidence).map((item) => item.language),
  );

  if (confirmedSet.size > 0) {
    const confirmed: string[] = [];
    const assumed: string[] = [];
    const seen = new Set<string>();
    for (const language of list) {
      if (seen.has(language)) continue;
      seen.add(language);
      if (confirmedSet.has(language)) confirmed.push(language);
      else assumed.push(language);
    }
    for (const language of confirmedSet) {
      if (!seen.has(language)) confirmed.push(language);
    }
    return { confirmed, assumed };
  }

  if (languagesConfirmed === false) {
    return { confirmed: [], assumed: list };
  }

  return { confirmed: list, assumed: [] };
}
