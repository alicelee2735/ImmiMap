/**
 * Parser for the EOIR "List of Pro Bono Legal Service Providers" PDF.
 *
 * The document is a two-column layout: left- and right-column entries share
 * y-coordinates, so flattening a page top-to-bottom merges unrelated
 * organizations. Word-level x positions split the columns before a column
 * is read as a sequence of records.
 *
 * The same office is reprinted once per immigration court it serves. Those
 * appearances are collapsed to one record with the courts attached — not
 * one row per court listing.
 */
import { joinRuns, type PdfLine, type PdfPage } from "@/lib/ingestion/eoir/pdf-text";
import {
  isContinuationChrome,
  isOfficeLabelLine,
  stripContinuationMarker,
} from "@/lib/ingestion/eoir/office-label";
import type {
  AbandonedBlock,
  EoirOfficeRecord,
  EoirProviderKind,
  ParsedRoster,
} from "@/lib/ingestion/eoir/types";
import { normalizeStreet, slugify } from "@/lib/ingestion/eoir/normalize";
import { US_STATE_NAMES } from "@/lib/us-states";
import type { USState } from "@/types/immimap";

/**
 * Right column of provider listings starts here. Header chrome and the
 * left column all sit left of this; measured on the July 2026 edition.
 */
const COLUMN_SPLIT_X = 270;

/** Running header (legend, title, Updated date, URL) lives above this. */
const HEADER_Y = 745;

const PHONE_LINE =
  /^(?:Tel:\s*)?\(?(\d{3})\)?[\s.\-]*(\d{3})[\s.\-]*(\d{4})$/i;

const PHONE_ANYWHERE =
  /(?:\+?1[\s.\-]*)?\(?\d{3}\)?[\s.\-]*\d{3}[\s.\-]*\d{4}/;

const TEL_PREFIX = /^Tel:\s*/i;
const FAX_PREFIX = /^Fax:\s*/i;

const TYPE_MARKERS = /(\*{1,3})\s*$/;

const COURT_HEADING =
  /Immigration Courts?|Hearing Location|Detention Center|Residential Center/i;

const PAGE_OF_PAGE = /\s*\(page\s+\d+\s+(?:of|or)\s+\d+\)\s*$/i;

const PO_BOX = /^(?:P\.?\s*O\.?\s*Box|Post Office Box)\b/i;

const STREET_SUFFIX =
  /\b(?:Street|St|Avenue|Ave|Road|Rd|Blvd|Boulevard|Drive|Dr|Lane|Ln|Way|Place|Pl|Court|Ct|Parkway|Pkwy|Circle|Cir|Highway|Hwy|Pike|Terrace|Ter|Trail|Trl|Box)\b/i;

const SPELLED_STREET =
  /^(?:One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten)\s+/i;

const TIME_LIKE = /\d{1,2}(?::\d{2})?\s*(?:AM|PM)/i;

const BULLET = /^[•\u2022]/;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+/;

/**
 * A website as printed — with or without a scheme, sometimes a bare domain
 * ("lilaclegal.org/"). Path-only fragments are handled separately.
 */
const WEBSITE =
  /^(?:https?:\/\/)?(?:www\.)?[a-z0-9][-a-z0-9]*(?:\.[a-z0-9][-a-z0-9]*)+.*$/i;

const STATE_NAME_TO_CODE = new Map<string, USState>(
  (Object.keys(US_STATE_NAMES) as USState[]).map((code) => [
    US_STATE_NAMES[code].toUpperCase(),
    code,
  ]),
);

const UNSUPPORTED_REGIONS = new Set([
  "PUERTO RICO",
  "GUAM",
  "VIRGIN ISLANDS",
  "U.S. VIRGIN ISLANDS",
  "AMERICAN SAMOA",
  "NORTHERN MARIANA ISLANDS",
]);

type ColumnLine = {
  page: number;
  y: number;
  x: number;
  text: string;
};

function titleCaseCity(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\bMc([a-z])/g, (_, c: string) => `Mc${c.toUpperCase()}`);
}

function isHeaderLine(line: PdfLine): boolean {
  if (line.y >= HEADER_Y) return true;
  const text = line.text;
  return (
    /^\* Non-Profit Organization$/i.test(text) ||
    /^\*\* Referral Service$/i.test(text) ||
    /^\*\*\* Private Attorney/i.test(text) ||
    /^List of Pro Bono Legal Service Providers$/i.test(text) ||
    /^Updated /i.test(text) ||
    /justice\.gov\/eoir\/list-pro-bono/i.test(text)
  );
}

function isTocPage(lines: PdfLine[]): boolean {
  return lines.some((line) => /^Table of Contents$/i.test(line.text));
}

function isStateHeading(text: string): boolean {
  const upper = text.trim().toUpperCase();
  return STATE_NAME_TO_CODE.has(upper) || UNSUPPORTED_REGIONS.has(upper);
}

function locationState(text: string): string | null {
  const stripped = text.replace(PAGE_OF_PAGE, "").trim();
  const match = stripped.match(/^(.+),\s*([A-Za-z][A-Za-z .]*)$/);
  if (!match) return null;
  const region = match[2].trim().toUpperCase();
  if (STATE_NAME_TO_CODE.has(region) || UNSUPPORTED_REGIONS.has(region)) {
    return stripped;
  }
  return null;
}

function providerKindFromMarkers(stars: string): EoirProviderKind {
  if (stars === "***") return "private_attorney";
  if (stars === "**") return "referral";
  return "nonprofit";
}

function stripTypeMarkers(name: string): {
  name: string;
  kind: EoirProviderKind | null;
} {
  const match = name.match(TYPE_MARKERS);
  if (!match) return { name: name.trim(), kind: null };
  return {
    name: name.slice(0, match.index).trim(),
    kind: providerKindFromMarkers(match[1]),
  };
}

function normalizePhone(text: string): string | null {
  const stripped = text.replace(TEL_PREFIX, "").trim();
  const match = stripped.match(PHONE_LINE);
  if (!match) return null;
  return `(${match[1]}) ${match[2]}-${match[3]}`;
}

function looksLikeWebsite(text: string): boolean {
  if (/\s/.test(text)) return false;
  if (EMAIL.test(text)) return false;
  if (text.includes("@")) return false;
  if (/^at\s+www\./i.test(text)) return false;
  return WEBSITE.test(text);
}

function looksLikeUrlFragment(text: string, currentWebsite: string | null): boolean {
  if (!currentWebsite) return false;
  if (!text || /\s/.test(text)) return false;
  if (BULLET.test(text) || TEL_PREFIX.test(text) || FAX_PREFIX.test(text)) {
    return false;
  }
  if (parseCityStateZip(text) || EMAIL.test(text) || isStreetLine(text)) {
    return false;
  }
  if (TYPE_MARKERS.test(text)) return false;
  // Mid-word wraps only happen when the printed URL was cut at a join
  // character. A whole English word after a complete domain is a note.
  if (!/[/=?_&.-]$/.test(currentWebsite)) return false;
  return /^[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/.test(text);
}

function isPhoneLike(text: string): boolean {
  return PHONE_ANYWHERE.test(text) || /^1\s*\(\d{3}\)/.test(text);
}

function isStreetLine(text: string): boolean {
  if (PO_BOX.test(text)) return true;
  if (isPhoneLike(text) || TIME_LIKE.test(text)) return false;
  if (/^(?:Suite|Ste\.?|Unit|Floor|#)\b/i.test(text)) return true;
  if (SPELLED_STREET.test(text) && STREET_SUFFIX.test(text)) return true;
  // House number may be hyphenated ("47-01 Queens Blvd") — standard in
  // Queens and other grid-addressed cities — and may carry a letter suffix.
  const house =
    /^(?:\d+[A-Za-z]?(?:-\d+[A-Za-z]?)?)(?:\s+[NSEW]\.?)?\s+\S/;
  if (!house.test(text)) return false;
  if (STREET_SUFFIX.test(text)) return true;
  return /^(?:\d+[A-Za-z]?(?:-\d+[A-Za-z]?)?\s+)(?:[NSEW]\.?\s+)?[A-Z]/.test(
    text,
  );
}

type CityStateZip =
  | { status: "ok"; city: string; state: USState; zip: string }
  | { status: "unsupported"; region: string };

function parseCityStateZip(text: string): CityStateZip | null {
  const match = text.match(
    /^(.+?),\s*([A-Za-z][A-Za-z.'\-\s]*?)\s+(\d{5})(?:-\d{4})?$/,
  );
  if (!match) return null;

  const city = match[1].trim();
  const region = match[2].trim();
  const zip = match[3];
  const upper = region.toUpperCase();

  if (region.length === 2) {
    if (US_STATE_NAMES[upper as USState]) {
      return { status: "ok", city, state: upper as USState, zip };
    }
    if (UNSUPPORTED_REGIONS.has(upper) || upper === "PR") {
      return { status: "unsupported", region: upper };
    }
    return null;
  }

  const fromName = STATE_NAME_TO_CODE.get(upper);
  if (fromName) return { status: "ok", city, state: fromName, zip };
  if (UNSUPPORTED_REGIONS.has(upper)) {
    return { status: "unsupported", region: upper };
  }
  return null;
}

function isNoteNoise(text: string): boolean {
  if (TIME_LIKE.test(text)) return true;
  if (/^at\s+www\./i.test(text)) return true;
  if (/hotline:\s*/i.test(text) && isPhoneLike(text)) return true;
  if (isPhoneLike(text) && !TEL_PREFIX.test(text) && !isStreetLine(text)) {
    return true;
  }
  return false;
}

function canonicalOrgName(name: string, block: OpenBlock): string {
  const trimmed = name.trim();
  const abaOffice =
    /1050 Connecticut/i.test(block.addressLines.join(" ")) ||
    (block.website ?? "").includes("americanbar");
  if (
    abaOffice &&
    /information hotline/i.test(trimmed) &&
    !/ABA Commission/i.test(trimmed)
  ) {
    return "ABA Commission on Immigration Detention Information Hotline";
  }
  return trimmed;
}

function looksLikeEmailLine(text: string): boolean {
  return text.includes("@") && /@[^\s@]+\.[^\s@]+/.test(text);
}

/**
 * First line of a wrapped legal name, as opposed to leftover note prose from
 * the previous record. Notes tend to start with an imperative or a coverage
 * sentence; name prefixes are title-case and often end in a comma.
 */
const NOTE_STARTERS =
  /^(?:will|won't|cannot|can\b|no\b|not\b|please|hours|languages?|represents?|accepts?|limited|contact|must\b|walk-?ins?|serving|all\b|detained|respondents?|enforcement|facilities|should\b|to contact|only\b|representation|unaccompanied|people\b|members\b|by appointment|staff\b|advice\b|interpreters?|habeas|criminal\b|initial\b|challenging|multilingual|handles\b|assist\b|specializes?|leave a message|provides?|kind represents|pro se|free legal services for|find legal)\b/i;

const WRAP_TAIL =
  /^(?:Inc\.?|LLC|LLP|Ltd\.?|P\.?C\.?|PLLC|Incorporated|Project|Clinic|Center|Services|Office|Foundation|Institute|Network|Coalition|Association|Society|Ministry|Hotline|Program|Unit|Law)\b/i;

const WRAP_UNIT =
  /^(?:Inc\.?|LLC|LLP|Ltd\.?|P\.?C\.?|PLLC|Incorporated|Project|Clinic|Center|Services|Office|Foundation|Institute|Network|Coalition|Association|Society|Ministry|Hotline|Program|Unit)$/i;

function wordCount(text: string): number {
  return text.replace(/[(),.*]/g, " ").split(/\s+/).filter(Boolean).length;
}

/** Comma-separated counties/cities, not an organization name. */
function looksLikePlaceList(text: string): boolean {
  const commas = (text.match(/,/g) ?? []).length;
  if (commas < 2) return false;
  return !/\b(?:Inc|LLC|Clinic|Project|University|Charities|Legal|Services|Center|Institute|Coalition|Association|Ministry|Foundation|Law)\b/i.test(
    text,
  );
}

function isIncompleteNamePrefix(text: string): boolean {
  const trimmed = text.trim();
  return /[,/–—-]$/.test(trimmed) || /\b(?:and|of|for|the|an|a)$/i.test(trimmed);
}

function isPlausibleNamePrefix(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || TYPE_MARKERS.test(trimmed)) return false;
  if (/^[a-z]/.test(trimmed)) return false;
  if (NOTE_STARTERS.test(trimmed)) return false;
  if (looksLikePlaceList(trimmed)) return false;
  if (/\bcode\s*:/i.test(trimmed) || /\d-digit/i.test(trimmed)) return false;
  if (/[.!?]$/.test(trimmed)) return false;
  const words = trimmed.replace(/,$/, "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const titleish = words.filter(
    (word) =>
      /^[\d(A-Z*]/.test(word) || /^(?:and|of|for|the|de|del|la|at|&|\/)$/i.test(word),
  );
  return titleish.length >= Math.ceil(words.length * 0.7);
}

function isWrapContinuation(prefix: string, marked: string): boolean {
  const name = stripTypeMarkers(marked).name;
  if (!name) return false;
  if (isIncompleteNamePrefix(prefix)) return true;
  if (/^[a-z]/.test(name)) return true;
  const nameWords = wordCount(name);
  // "Law Office of the Cook County Public Defender" starts with a wrap-tail
  // word but is a complete name. Only short remainders are continuations.
  if (nameWords <= 3 && WRAP_TAIL.test(name)) return true;
  const prefixWords = wordCount(prefix);
  const lastWord = name.split(/\s+/).pop()?.replace(/[(),.]/g, "") ?? "";
  return (
    prefixWords >= 3 &&
    nameWords <= 3 &&
    nameWords < prefixWords &&
    WRAP_UNIT.test(lastWord)
  );
}

function hasUpcomingNameWrap(
  lines: ColumnLine[],
  fromIndex: number,
  prefix: string,
): boolean {
  let combined = prefix;
  for (let index = fromIndex + 1; index < lines.length; index += 1) {
    const text = stripContinuationMarker(lines[index].text);
    if (!text || isContinuationChrome(lines[index].text) || locationState(text)) {
      continue;
    }
    if (TYPE_MARKERS.test(text)) return isWrapContinuation(combined, text);
    if (BULLET.test(text)) return false;
    if (isNoteNoise(text)) return false;
    if (isStreetLine(text) || PO_BOX.test(text)) return false;
    if (parseCityStateZip(text) || isOfficeLabelLine(text)) return false;
    if (looksLikeWebsite(text) || looksLikeEmailLine(text)) return false;
    if (TEL_PREFIX.test(text) || FAX_PREFIX.test(text)) return false;
    // A wrapped name is almost always two lines. Only absorb another unmarked
    // line when the prefix is syntactically unfinished ("…, " / "… of").
    if (isIncompleteNamePrefix(combined) && isPlausibleNamePrefix(text)) {
      combined = `${combined} ${text}`;
      continue;
    }
    return false;
  }
  return false;
}

type OpenBlock = {
  nameLines: string[];
  officeLabel: string | null;
  addressLines: string[];
  city: string | null;
  state: USState | null;
  zip: string | null;
  phone: string | null;
  website: string | null;
  kind: EoirProviderKind | null;
  page: number;
  parentName: string | null;
};

function emptyBlock(page: number, parentName: string | null): OpenBlock {
  return {
    nameLines: [],
    officeLabel: null,
    addressLines: [],
    city: null,
    state: null,
    zip: null,
    phone: null,
    website: null,
    kind: null,
    page,
    parentName,
  };
}

function joinedName(block: OpenBlock): string {
  return block.nameLines.join(" ").replace(/\s+/g, " ").trim();
}

function hasAddress(block: OpenBlock): boolean {
  return Boolean(block.city && block.state && block.zip && block.addressLines.length > 0);
}

function finalizeRecord(
  block: OpenBlock,
  court: string | null,
): EoirOfficeRecord | null {
  const stripped = stripTypeMarkers(joinedName(block));
  const name = canonicalOrgName(stripped.name || block.parentName || "", block);
  if (!name) return null;
  if (!block.city || !block.state || !block.zip) return null;

  const street = block.addressLines.join(", ").replace(/\s+/g, " ").trim();
  if (!street) return null;

  return {
    name,
    officeLabel: block.officeLabel,
    street,
    city: titleCaseCity(block.city),
    state: block.state,
    zip: block.zip,
    phone: block.phone,
    dateRecognized: null,
    expirationDate: null,
    status: null,
    pendingRenewal: false,
    sourcePage: block.page,
    courts: court ? [court] : [],
    website: block.website,
    providerKind: stripped.kind ?? block.kind,
  };
}

function applyTypeMarker(block: OpenBlock, text: string): void {
  const stripped = stripTypeMarkers(text);
  if (stripped.kind) block.kind = stripped.kind;
  if (stripped.name) block.nameLines.push(stripped.name);
}

/**
 * Reads one column top-to-bottom. A record is closed by the next name-with-
 * marker, a nested "… Office:" label after an address, or the end of the
 * column. Blocks that close without a City/ST/ZIP are abandoned, not dropped
 * silently.
 */
function parseColumn(
  lines: ColumnLine[],
  court: string | null,
  abandoned: AbandonedBlock[],
): EoirOfficeRecord[] {
  const records: EoirOfficeRecord[] = [];
  let block = emptyBlock(lines[0]?.page ?? 1, null);
  let inNotes = false;
  let heldPrefix: string[] = [];

  const abandon = (reason: AbandonedBlock["reason"], page: number) => {
    if (block.nameLines.length === 0 && block.addressLines.length === 0) {
      block = emptyBlock(page, block.parentName);
      inNotes = false;
      return;
    }
    const stripped = stripTypeMarkers(joinedName(block));
    abandoned.push({
      lines: [
        ...block.nameLines,
        ...(block.officeLabel ? [block.officeLabel] : []),
        ...block.addressLines,
      ],
      name: stripped.name || block.parentName,
      sourcePage: page,
      reason,
    });
    block = emptyBlock(page, block.parentName);
    inNotes = false;
    heldPrefix = [];
  };

  const flush = () => {
    const record = finalizeRecord(block, court);
    if (record) {
      records.push(record);
      const next = emptyBlock(block.page, record.name);
      next.kind = record.providerKind ?? block.kind;
      block = next;
    } else {
      abandon("end_of_section", block.page);
      return;
    }
    inNotes = false;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const text = stripContinuationMarker(line.text);
    if (!text || isContinuationChrome(line.text)) continue;
    if (locationState(text)) continue;

    if (BULLET.test(text)) {
      if (hasAddress(block) || block.nameLines.length > 0) inNotes = true;
      continue;
    }

    if (isNoteNoise(text)) {
      if (hasAddress(block) || inNotes || block.nameLines.length > 0) {
        inNotes = hasAddress(block) || inNotes;
        continue;
      }
    }

    if (looksLikeUrlFragment(text, block.website)) {
      block.website = `${block.website}${text}`;
      continue;
    }

    if (FAX_PREFIX.test(text)) continue;

    if (TEL_PREFIX.test(text) || PHONE_LINE.test(text.replace(TEL_PREFIX, "").trim())) {
      const phone = normalizePhone(text);
      if (phone && !block.phone) block.phone = phone;
      continue;
    }

    if (looksLikeEmailLine(text)) continue;

    if (looksLikeWebsite(text)) {
      if (!block.website || text.length > block.website.length) {
        block.website = text.replace(/[.,;]+$/, "");
      }
      continue;
    }

    const anchor = parseCityStateZip(text);
    if (anchor) {
      if (anchor.status === "unsupported") {
        abandon("unsupported_region", line.page);
        continue;
      }

      if (inNotes && hasAddress(block)) {
        // A city/ST/ZIP after notes belongs to a nested office of the same org.
        flush();
      }

      block.city = anchor.city;
      block.state = anchor.state;
      block.zip = anchor.zip;
      inNotes = false;
      continue;
    }

    if (isOfficeLabelLine(text)) {
      const label = text.replace(/:\s*$/, "").trim();
      if (hasAddress(block)) {
        flush();
        block.officeLabel = label;
        if (block.parentName) block.nameLines = [block.parentName];
      } else if (block.addressLines.length > 0) {
        // Street without a city/ZIP — close as an abandonment, same as the
        // roster closing a block when the next office label arrives.
        abandon("end_of_section", line.page);
        block.officeLabel = label;
        if (block.parentName) block.nameLines = [block.parentName];
      } else if (block.nameLines.length > 0) {
        block.officeLabel = label;
      } else {
        block.officeLabel = label;
        if (block.parentName) block.nameLines = [block.parentName];
      }
      inNotes = false;
      continue;
    }

    const hasMarker = TYPE_MARKERS.test(text);

    if (
      !hasMarker &&
      (inNotes || hasAddress(block)) &&
      isPlausibleNamePrefix(text) &&
      hasUpcomingNameWrap(lines, index, text)
    ) {
      heldPrefix.push(text);
      continue;
    }

    if (hasMarker) {
      const prefix = heldPrefix;
      heldPrefix = [];
      if (hasAddress(block)) {
        flush();
      } else if (block.addressLines.length > 0 || inNotes) {
        abandon("end_of_section", line.page);
      }
      for (const part of prefix) {
        if (!block.nameLines.includes(part)) block.nameLines.push(part);
      }
      applyTypeMarker(block, text);
      block.page = line.page;
      inNotes = false;
      continue;
    }

    if (isStreetLine(text) || PO_BOX.test(text)) {
      if (block.nameLines.length === 0 && !block.parentName) continue;
      const suiteContinuation =
        /^(?:Suite|Ste\.?|Unit|Floor|#)\b/i.test(text) &&
        block.addressLines.length > 0;
      if (hasAddress(block) && block.addressLines.length > 0 && !suiteContinuation) {
        flush();
        if (block.parentName) block.nameLines = [block.parentName];
      }
      block.addressLines.push(text);
      inNotes = false;
      continue;
    }

    if (inNotes) continue;

    // Name wrap, or a department line sitting between the marked name and
    // the street (e.g. "Catholic Charities of Los Angeles").
    if (block.nameLines.length > 0 && !hasAddress(block) && block.addressLines.length === 0) {
      if (block.kind && !isStreetLine(text)) {
        if (!block.officeLabel) block.officeLabel = text;
        else block.nameLines.push(text);
        continue;
      }
      block.nameLines.push(text);
      continue;
    }

    if (block.nameLines.length === 0) {
      // Wrapped note fragments often start with a lowercase word.
      if (/^[a-z]/.test(text)) continue;
      block.nameLines.push(text);
      block.page = line.page;
      continue;
    }

    // After an address, unmarked prose is notes (wrapped bullets lost their
    // glyph, or hours/eligibility lines). Do not start a new org from it.
    if (hasAddress(block)) {
      inNotes = true;
      continue;
    }

    block.nameLines.push(text);
  }

  if (block.nameLines.length > 0 || block.addressLines.length > 0) {
    if (hasAddress(block)) flush();
    else abandon("end_of_section", block.page);
  }

  return records;
}

function splitPageColumns(page: PdfPage): {
  court: string | null;
  left: ColumnLine[];
  right: ColumnLine[];
} {
  const content = page.lines.filter((line) => !isHeaderLine(line));
  let court: string | null = null;
  const rest: PdfLine[] = [];

  for (const line of content) {
    if (!court && COURT_HEADING.test(line.text) && !BULLET.test(line.text)) {
      court = line.text.replace(PAGE_OF_PAGE, "").trim();
      continue;
    }
    if (locationState(line.text)) continue;
    rest.push(line);
  }

  const left: ColumnLine[] = [];
  const right: ColumnLine[] = [];

  for (const line of rest) {
    const leftRuns = line.runs.filter((run) => run.x < COLUMN_SPLIT_X);
    const rightRuns = line.runs.filter((run) => run.x >= COLUMN_SPLIT_X);

    if (leftRuns.length > 0) {
      const text = joinRuns(leftRuns);
      if (text) {
        left.push({
          page: page.page,
          y: line.y,
          x: leftRuns[0].x,
          text,
        });
      }
    }
    if (rightRuns.length > 0) {
      const text = joinRuns(rightRuns);
      if (text) {
        right.push({
          page: page.page,
          y: line.y,
          x: rightRuns[0].x,
          text,
        });
      }
    }
  }

  return { court, left, right };
}

function officeKey(record: EoirOfficeRecord): string {
  return [
    slugify(record.name),
    record.state,
    record.zip,
    normalizeStreet(record.street),
  ].join("|");
}

/**
 * Collapses court-listing repetitions of the same office (same name +
 * address) into one record, keeping every court the office was printed
 * under. Distinct addresses of the same legal name stay distinct — they
 * are different map pins.
 */
export function consolidateProBonoRecords(
  appearances: EoirOfficeRecord[],
): EoirOfficeRecord[] {
  const byOffice = new Map<string, EoirOfficeRecord>();
  const order: string[] = [];

  for (const appearance of appearances) {
    const key = officeKey(appearance);
    const existing = byOffice.get(key);
    if (!existing) {
      byOffice.set(key, {
        ...appearance,
        courts: [...(appearance.courts ?? [])],
      });
      order.push(key);
      continue;
    }

    const courts = new Set([
      ...(existing.courts ?? []),
      ...(appearance.courts ?? []),
    ]);
    existing.courts = [...courts];
    if (
      (appearance.website?.length ?? 0) > (existing.website?.length ?? 0)
    ) {
      existing.website = appearance.website;
    }
    if (!existing.phone && appearance.phone) existing.phone = appearance.phone;
    if (!existing.providerKind && appearance.providerKind) {
      existing.providerKind = appearance.providerKind;
    }
    if (!existing.officeLabel && appearance.officeLabel) {
      existing.officeLabel = appearance.officeLabel;
    }
  }

  return order.map((key) => byOffice.get(key)!);
}

function findReportUpdatedAt(pages: PdfPage[]): string | null {
  for (const page of pages.slice(0, 3)) {
    for (const line of page.lines) {
      const match = line.text.match(/^Updated\s+(.+)$/i);
      if (match?.[1]) return match[1].trim();
    }
  }
  return null;
}

/**
 * Parses the pro bono list. Pages are column-split, each column is read as
 * a sequence of provider blocks, and court repetitions of the same office
 * are then collapsed.
 */
export function parseProBono(pages: PdfPage[]): ParsedRoster {
  const appearances: EoirOfficeRecord[] = [];
  const abandoned: AbandonedBlock[] = [];
  let linesScanned = 0;
  let incompleteRecords = 0;

  for (const page of pages) {
    if (isTocPage(page.lines)) continue;

    const content = page.lines.filter((line) => !isHeaderLine(line));
    if (content.length === 0) continue;
    if (content.length === 1 && isStateHeading(content[0].text)) continue;

    const { court, left, right } = splitPageColumns(page);
    linesScanned += left.length + right.length;

    for (const column of [left, right]) {
      const parsed = parseColumn(column, court, abandoned);
      appearances.push(...parsed);
    }
  }

  incompleteRecords = abandoned.length;
  const records = consolidateProBonoRecords(appearances);

  return {
    records,
    diagnostics: {
      linesScanned,
      abandonedBlocks: abandoned.length,
      abandoned,
      incompleteRecords,
      parser: "primary",
      reportUpdatedAt: findReportUpdatedAt(pages),
      appearances: appearances.length,
    },
  };
}
