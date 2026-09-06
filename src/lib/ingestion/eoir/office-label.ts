/**
 * Lines that bound an office rather than naming a legal entity.
 *
 * The R&A roster prints this as "Principal Office" / "Montgomery Extension
 * Office" / "Satellite Office". The pro bono list prints the same idea as
 * nested site labels ("San Francisco Office:", "Dallas:", "Physical Address:",
 * "Wenatchee Office (cont.):"). One detector covers both so a new nested-office
 * phrasing does not need a per-artifact special case.
 */
const CONTINUATION = /\s*\((?:cont|continued)\.\)\s*/gi;

const ROSTER_OFFICE_TYPE = /(?:principal|extension|satellite)\s+office\b/i;

const ADDRESS_ROLE =
  /^(?:mailing|physical|street|postal|billing)\s+address$/i;

/** Stored on the organization row; not shown in the public UI today. */
export type AddressRole = "physical" | "mailing";

const NESTED_OFFICE = /\boffice$/i;

/** Contact-field labels — a colon does not make these a new office. */
const CONTACT_FIELD =
  /^(?:tel|fax|phone|telephone|email|e-mail|hours?|languages?|hotline|website|web|url|toll[\s-]?free|tty)\b/i;

const LANGUAGE_WORD =
  /^(?:spanish|english|french|arabic|portuguese|creole|haitian|mandarin|cantonese|russian|vietnamese)$/i;

/** Imperatives and note headers that happen to end with a colon. */
const NOT_A_SITE =
  /\b(?:form|help|complete|please|visit|call|click|see|email|website|more|info|information|get)\b/i;

/** Strip the PDF's parenthetical continuation marker, keeping a trailing colon. */
export function stripContinuationMarker(text: string): string {
  return text
    .replace(CONTINUATION, " ")
    .replace(/\s+:/g, ":")
    .replace(/\s+/g, " ")
    .trim();
}

export function isContinuationChrome(text: string): boolean {
  return stripContinuationMarker(text).length === 0;
}

/**
 * True when a line is an office / site / address-role label, not a legal name.
 *
 * Roster forms do not require a trailing colon. Pro bono nested labels usually
 * carry one. Continuation markers are ignored so "Wenatchee Office (cont.):"
 * classifies the same as "Wenatchee Office:".
 */
export function isOfficeLabelLine(text: string): boolean {
  const trimmed = stripContinuationMarker(text);
  if (!trimmed) return false;

  const endedWithColon = /:$/.test(trimmed);
  const withoutColon = trimmed.replace(/:\s*$/, "").trim();
  if (!withoutColon) return false;
  if (CONTACT_FIELD.test(withoutColon)) return false;

  if (ROSTER_OFFICE_TYPE.test(withoutColon)) return true;
  if (ADDRESS_ROLE.test(withoutColon)) return true;
  if (endedWithColon && NESTED_OFFICE.test(withoutColon)) return true;

  // Colon-terminated site label: "Dallas:", "Fort Worth:",
  // "American Gateways – Austin:". Reject note headers ("Complete this form:")
  // and language labels ("Spanish:").
  if (
    endedWithColon &&
    withoutColon.length <= 80 &&
    !/^\d/.test(withoutColon) &&
    !/[.!?]$/.test(withoutColon) &&
    !/www\.|https?:/i.test(withoutColon) &&
    !LANGUAGE_WORD.test(withoutColon) &&
    !NOT_A_SITE.test(withoutColon) &&
    isTitleCaseSite(withoutColon)
  ) {
    return true;
  }

  return false;
}

/**
 * Maps a parsed office label to the address role the PDF declared, or null
 * when the label is a site name ("Dallas", "Queens Office") rather than
 * physical vs mailing.
 */
export function addressRoleFromLabel(
  label: string | null | undefined,
): AddressRole | null {
  if (!label) return null;
  const withoutColon = stripContinuationMarker(label)
    .replace(/:\s*$/, "")
    .trim();
  if (/^(?:mailing|postal|billing)\s+address$/i.test(withoutColon)) {
    return "mailing";
  }
  if (/^(?:physical|street)\s+address$/i.test(withoutColon)) {
    return "physical";
  }
  return null;
}

/** "Dallas", "Fort Worth", or "American Gateways – Austin". */
function isTitleCaseSite(value: string): boolean {
  const parts = value.split(/\s+[–—-]\s+/);
  return parts.every((part) =>
    /^[A-Z][A-Za-z.'’]*(\s+[A-Z][A-Za-z.'’]*){0,5}$/.test(part),
  );
}
