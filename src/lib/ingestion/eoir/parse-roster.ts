/**
 * Parsers for the EOIR "Organizations and Representatives, Listed by State"
 * roster PDF.
 *
 * Two independent strategies are provided because the source is a PDF whose
 * layout EOIR can change without notice:
 *
 *  - `parseRosterPrimary` follows the document structure (state headings, city
 *    headings, table headers) and captures the richest data.
 *  - `parseRosterFallback` ignores all headings and anchors purely on
 *    "City, ST ZIP" lines, deriving the state from the anchor itself. It
 *    survives heading and column changes at the cost of some metadata.
 *
 * `parseRoster` runs the primary parser and falls back automatically when the
 * yield collapses, which is the signal that the layout moved.
 */
import { MIN_EXPECTED_RECORDS } from "@/lib/ingestion/eoir/constants";
import type { PdfLine } from "@/lib/ingestion/eoir/pdf-text";
import type {
  AbandonedBlock,
  EoirOfficeRecord,
  ParsedRoster,
} from "@/lib/ingestion/eoir/types";
import { isOfficeLabelLine } from "@/lib/ingestion/eoir/office-label";
import { US_STATE_NAMES } from "@/lib/us-states";
import type { USState } from "@/types/immimap";

export { isOfficeLabelLine };

/**
 * "Montgomery, AL 36116" — the anchor that terminates a record block.
 * Groups: 1 city, 2 state, 3 ZIP.
 */
const CITY_STATE_ZIP =
  /^([A-Za-z][A-Za-z.'\-\s]*?),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?$/;

/** "(334) 288-8890" and close variants. */
const PHONE_LINE = /^\(?(\d{3})\)?[\s.\-]*(\d{3})[\s.\-]*(\d{4})$/;

/**
 * Trailing "MM/DD/YY MM/DD/YY[*] [Status]" on an organization name line.
 * Groups: 1 name, 2 date recognized, 3 expiration, 4 pending asterisk,
 * 5 status.
 */
const NAME_WITH_DATES =
  /^(.+?)\s+(\d{2}\/\d{2}\/\d{2})\s+(\d{2}\/\d{2}\/\d{2})(\*)?\s*(?:\(Pending\s+Renewal\)\s*)?(Active|Inactive|Terminated|Withdrawn|Suspended)?\s*$/;

/**
 * Start of the accredited-representatives section. Everything after this lists
 * individual people, not organizations, and must not be ingested.
 */
const REPRESENTATIVES_TABLE_HEADER =
  /^Recognized\s+Accredited\s+Representative\s+Accreditation/i;

/** Organization table column headers, repeated once per state section. */
const ORG_TABLE_HEADER =
  /^(?:Recognized\s+Date\s+Recognition\s+Organization|Organization\s+Recognized\s+Expiration\s+Date\s+Status)$/i;

/** Cover-page and boilerplate lines that must never enter a record block. */
const BOILERPLATE = [
  /^Recognized Organizations and Accredited Representatives Roster/i,
  /^by State and City$/i,
  /^Report Last Updated on:/i,
  /^Disclaimer:/i,
  /^rosters available to the public/i,
  /^Organizations\. Each Recognized Organization/i,
  /^to its contact information/i,
  /^it receives, each Recognized Organization/i,
  /^order for the information posted/i,
  /^[•\u2022]/,
  /^Page \d+/i,
];

/**
 * Wrapped remnants of a pending-renewal status. These print between the
 * organization name and its office label, so they must be skipped over
 * without being mistaken for a record boundary.
 */
const STATUS_CONTINUATION = [
  /^\(Pending\s+Renewal\)$/i,
  /^\(Pending$/i,
  /^Renewal\)$/i,
];

/** A recognition-status word printed on its own line, often between offices. */
const STATUS_ONLY =
  /^(Active|Inactive|Terminated|Withdrawn|Suspended)$/i;

/**
 * Dates + status with no organization name. These print above a nested
 * Extension Office that omitted the legal name.
 */
const DATES_STATUS_ONLY =
  /^(\d{2}\/\d{2}\/\d{2})\s+(\d{2}\/\d{2}\/\d{2})(\*)?\s*(?:\(Pending\s+Renewal\)\s*)?(Active|Inactive|Terminated|Withdrawn|Suspended)?\s*$/;

const REPORT_DATE = /^Report Last Updated on:\s*([\d/]+)/i;

/** Uppercase state/territory heading text → USPS code. */
const STATE_NAME_TO_CODE = new Map<string, USState>(
  (Object.keys(US_STATE_NAMES) as USState[]).map((code) => [
    US_STATE_NAMES[code].toUpperCase(),
    code,
  ]),
);

/**
 * Headings that appear in the roster but have no USState code. Listed
 * explicitly so they are skipped deliberately rather than logged as parse
 * failures.
 */
const UNSUPPORTED_REGIONS = new Set([
  "PUERTO RICO",
  "GUAM",
  "VIRGIN ISLANDS",
  "U.S. VIRGIN ISLANDS",
  "AMERICAN SAMOA",
  "NORTHERN MARIANA ISLANDS",
]);

/**
 * Left-aligned record content sits near x=38; state and city headings are
 * centered past x=250. Used only as a tiebreaker after content-based checks.
 */
const CENTERED_X_THRESHOLD = 220;

function isBoilerplate(text: string): boolean {
  return BOILERPLATE.some((pattern) => pattern.test(text));
}

function isStatusContinuation(text: string): boolean {
  return STATUS_CONTINUATION.some((pattern) => pattern.test(text));
}

/** Lines that must not become a record name or a street fragment. */
function isSkippableNoise(text: string): boolean {
  return (
    isStatusContinuation(text) ||
    STATUS_ONLY.test(text) ||
    DATES_STATUS_ONLY.test(text)
  );
}

function normalizePhone(text: string): string | null {
  const match = text.match(PHONE_LINE);
  if (!match) return null;
  return `(${match[1]}) ${match[2]}-${match[3]}`;
}

function titleCaseCity(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\bMc([a-z])/g, (_, c: string) => `Mc${c.toUpperCase()}`);
}

type NameParts = {
  name: string;
  dateRecognized: string | null;
  expirationDate: string | null;
  status: string | null;
  pendingRenewal: boolean;
};

function splitNameLine(text: string): NameParts {
  const match = text.match(NAME_WITH_DATES);
  if (!match) {
    return {
      name: text.trim(),
      dateRecognized: null,
      expirationDate: null,
      status: null,
      pendingRenewal: false,
    };
  }

  const [, name, recognized, expires, pending, status] = match;
  return {
    name: name.trim(),
    dateRecognized: recognized ?? null,
    expirationDate: expires ?? null,
    status: status ?? null,
    pendingRenewal: Boolean(pending),
  };
}

/**
 * Assembles a record from the buffered lines that preceded a City/ST/ZIP
 * anchor. Returns null when the block has no usable organization name.
 *
 * Nested Extension / Satellite offices often omit the legal name and start
 * with the office label (sometimes address-prefixed, e.g. "504 West Chapel
 * Hill Street/Durham NC Extension Office"). Those inherit `parentName` from
 * the preceding Principal Office instead of treating the label as a name.
 */
function buildRecord(
  block: string[],
  anchor: { city: string; state: USState; zip: string },
  sourcePage: number,
  parentName: string | null,
): EoirOfficeRecord | null {
  const lines = [...block];
  while (lines.length > 0 && isSkippableNoise(lines[0])) {
    lines.shift();
  }
  if (lines.length === 0) return null;

  const [first, ...rest] = lines;

  if (isOfficeLabelLine(first)) {
    if (!parentName) return null;

    const street = rest.join(", ").replace(/\s+/g, " ").trim();
    if (!street) return null;

    return {
      name: parentName,
      officeLabel: first,
      street,
      city: titleCaseCity(anchor.city),
      state: anchor.state,
      zip: anchor.zip,
      phone: null,
      dateRecognized: null,
      expirationDate: null,
      status: null,
      pendingRenewal: false,
      sourcePage,
    };
  }

  const parts = splitNameLine(first);
  if (!parts.name) return null;

  const officeIndex = rest.findIndex((line) => isOfficeLabelLine(line));
  const officeLabel = officeIndex >= 0 ? rest[officeIndex] : null;
  const addressLines = officeIndex >= 0 ? rest.slice(officeIndex + 1) : rest;

  const street = addressLines.join(", ").replace(/\s+/g, " ").trim();
  if (!street) return null;

  return {
    name: parts.name,
    officeLabel,
    street,
    city: titleCaseCity(anchor.city),
    state: anchor.state,
    zip: anchor.zip,
    phone: null,
    dateRecognized: parts.dateRecognized,
    expirationDate: parts.expirationDate,
    status: parts.status,
    pendingRenewal: parts.pendingRenewal,
    sourcePage,
  };
}

/** Truncates the line list at the accredited-representatives section. */
function organizationSection(lines: PdfLine[]): PdfLine[] {
  const cutoff = lines.findIndex((line) =>
    REPRESENTATIVES_TABLE_HEADER.test(line.text),
  );
  return cutoff === -1 ? lines : lines.slice(0, cutoff);
}

function findReportDate(lines: PdfLine[]): string | null {
  for (const line of lines.slice(0, 40)) {
    const match = line.text.match(REPORT_DATE);
    if (match?.[1]) return match[1];
  }
  return null;
}

/** Structure-aware parser. Tracks state headings and city headings. */
export function parseRosterPrimary(lines: PdfLine[]): ParsedRoster {
  const scoped = organizationSection(lines);
  const records: EoirOfficeRecord[] = [];

  let currentState: USState | null = null;
  let block: string[] = [];
  let blockPage = 1;
  const abandoned: AbandonedBlock[] = [];
  let incompleteRecords = 0;

  const abandon = (
    reason: AbandonedBlock["reason"],
    sourcePage: number,
  ) => {
    if (block.length === 0) return;
    const nameLine = block[0] ?? "";
    const name = splitNameLine(nameLine).name || null;
    abandoned.push({
      lines: [...block],
      name,
      sourcePage,
      reason,
    });
    block = [];
  };

  for (const line of scoped) {
    const text = line.text;
    const x = line.runs[0]?.x ?? 0;

    if (
      ORG_TABLE_HEADER.test(text) ||
      isBoilerplate(text) ||
      isSkippableNoise(text)
    ) {
      continue;
    }

    const upper = text.toUpperCase();
    const stateCode = STATE_NAME_TO_CODE.get(upper);
    if (stateCode && x > CENTERED_X_THRESHOLD) {
      abandon("state_heading", line.page);
      currentState = stateCode;
      continue;
    }

    if (UNSUPPORTED_REGIONS.has(upper) && x > CENTERED_X_THRESHOLD) {
      abandon("unsupported_region", line.page);
      currentState = null;
      continue;
    }

    const anchor = text.match(CITY_STATE_ZIP);
    if (anchor) {
      const [, anchorCity, anchorState, anchorZip] = anchor;
      const state = US_STATE_NAMES[anchorState as USState]
        ? (anchorState as USState)
        : currentState;

      if (!state) {
        incompleteRecords += 1;
        block = [];
        continue;
      }

      const record = buildRecord(
        block,
        { city: anchorCity, state, zip: anchorZip },
        line.page,
        records[records.length - 1]?.name ?? null,
      );

      if (record) {
        records.push(record);
      } else {
        incompleteRecords += 1;
      }
      block = [];
      continue;
    }

    const phone = normalizePhone(text);
    if (phone) {
      // Phones print after the address anchor, so they belong to the last
      // completed record rather than the block being accumulated.
      const last = records[records.length - 1];
      if (last && block.length === 0 && !last.phone) last.phone = phone;
      continue;
    }

    // Centered text that is not a state heading is a city heading. City is
    // taken from the address anchor instead, so it only delimits blocks.
    if (x > CENTERED_X_THRESHOLD && !isOfficeLabelLine(text)) {
      abandon("city_heading", line.page);
      continue;
    }

    if (block.length === 0) blockPage = line.page;
    block.push(text);
  }

  abandon("end_of_section", blockPage);

  return {
    records,
    diagnostics: {
      linesScanned: scoped.length,
      abandonedBlocks: abandoned.length,
      abandoned,
      incompleteRecords,
      parser: "primary",
      reportUpdatedAt: findReportDate(lines),
    },
  };
}

/** Maximum lines above an anchor that can belong to its record block. */
const FALLBACK_LOOKBACK = 6;

/**
 * Heading-agnostic parser. Anchors on "City, ST ZIP" lines and walks upward
 * to collect the block, deriving the state from the anchor. Survives changes
 * to state headings, city headings, and column layout.
 */
export function parseRosterFallback(lines: PdfLine[]): ParsedRoster {
  const scoped = organizationSection(lines);
  const records: EoirOfficeRecord[] = [];
  let incompleteRecords = 0;

  for (let i = 0; i < scoped.length; i += 1) {
    const anchor = scoped[i].text.match(CITY_STATE_ZIP);
    if (!anchor) continue;

    const [, anchorCity, anchorState, anchorZip] = anchor;
    const state = anchorState as USState;
    if (!US_STATE_NAMES[state]) continue;

    const block: string[] = [];
    for (let j = i - 1; j >= 0 && block.length < FALLBACK_LOOKBACK; j -= 1) {
      const previous = scoped[j].text;

      // A wrapped status or a lone "Active" sits inside / between blocks;
      // step over it without treating it as the block's upper boundary.
      if (isSkippableNoise(previous)) continue;

      if (
        ORG_TABLE_HEADER.test(previous) ||
        isBoilerplate(previous) ||
        CITY_STATE_ZIP.test(previous) ||
        PHONE_LINE.test(previous) ||
        STATE_NAME_TO_CODE.has(previous.toUpperCase())
      ) {
        break;
      }

      // Centered text is a state or city heading, never record content.
      const previousX = scoped[j].runs[0]?.x ?? 0;
      if (previousX > CENTERED_X_THRESHOLD && !isOfficeLabelLine(previous)) {
        break;
      }

      block.unshift(previous);

      // A line carrying recognition dates is the organization name line,
      // which is always the top of a block.
      if (NAME_WITH_DATES.test(previous)) break;
    }

    const record = buildRecord(
      block,
      { city: anchorCity, state, zip: anchorZip },
      scoped[i].page,
      records[records.length - 1]?.name ?? null,
    );

    if (!record) {
      incompleteRecords += 1;
      continue;
    }

    const next = scoped[i + 1];
    if (next) {
      const phone = normalizePhone(next.text);
      if (phone) record.phone = phone;
    }

    records.push(record);
  }

  return {
    records,
    diagnostics: {
      linesScanned: scoped.length,
      abandonedBlocks: 0,
      abandoned: [],
      incompleteRecords,
      parser: "fallback",
      reportUpdatedAt: findReportDate(lines),
    },
  };
}

/**
 * Parses the roster, escalating to the heading-agnostic parser when the
 * primary yield collapses below what the document should contain.
 */
export function parseRoster(lines: PdfLine[]): ParsedRoster {
  const primary = parseRosterPrimary(lines);
  if (primary.records.length >= MIN_EXPECTED_RECORDS) {
    return primary;
  }

  const fallback = parseRosterFallback(lines);
  return fallback.records.length > primary.records.length ? fallback : primary;
}
