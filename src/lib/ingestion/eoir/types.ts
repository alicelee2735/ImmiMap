import type { USState } from "@/types/immimap";

/** Marker printed next to a name on the EOIR pro bono list. */
export type EoirProviderKind = "nonprofit" | "referral" | "private_attorney";

/** One recognized-organization office as published in the roster. */
export type EoirOfficeRecord = {
  /** Organization name as printed. */
  name: string;
  /** "Principal Office", "<City> Extension Office", etc. Null when absent. */
  officeLabel: string | null;
  /** Street address, joined from the roster's wrapped address lines. */
  street: string;
  city: string;
  state: USState;
  zip: string;
  phone: string | null;
  /** MM/DD/YY as printed; null when the row omits it. */
  dateRecognized: string | null;
  expirationDate: string | null;
  status: string | null;
  /** True when the printed expiration carried the pending-renewal asterisk. */
  pendingRenewal: boolean;
  /** 1-based PDF page, kept for troubleshooting bad parses. */
  sourcePage: number;
  /**
   * Pro bono list only. Immigration courts / hearing locations this office
   * was printed under. Roster records leave this unset.
   */
  courts?: string[];
  /** Pro bono list only. First usable website printed on the listing. */
  website?: string | null;
  /** Pro bono list only. Derived from the *, **, *** marker on the name. */
  providerKind?: EoirProviderKind | null;
};

/**
 * A record block the primary parser discarded because a city/state heading
 * (or EOF) arrived before a City/ST/ZIP address anchor. Logged for review so
 * silent under-counts are visible the same way geocode failures are.
 */
export type AbandonedBlock = {
  /** Lines buffered before the block was abandoned. */
  lines: string[];
  /** Best-effort organization name taken from the first buffered line. */
  name: string | null;
  /** 1-based PDF page of the line that closed the block. */
  sourcePage: number;
  /** What closed the block without an address. */
  reason: "state_heading" | "city_heading" | "unsupported_region" | "end_of_section";
};

export type ParseDiagnostics = {
  linesScanned: number;
  /** Lines dropped because a record block ended without an address anchor. */
  abandonedBlocks: number;
  /** The abandoned blocks themselves — for review, not silently counted. */
  abandoned: AbandonedBlock[];
  /** Records missing a resolvable state, city, or ZIP. */
  incompleteRecords: number;
  /** Which parser produced the returned records. */
  parser: "primary" | "fallback";
  /** Report date printed on the roster cover page, if found. */
  reportUpdatedAt: string | null;
  /**
   * Pro bono list only. Court-listing appearances before same-office
   * rows were collapsed. Unset for the R&A roster.
   */
  appearances?: number;
};

export type ParsedRoster = {
  records: EoirOfficeRecord[];
  diagnostics: ParseDiagnostics;
};

export type GeocodeStatus = "matched" | "unmatched" | "error";

export type GeocodeResult = {
  lat: number | null;
  lng: number | null;
  status: GeocodeStatus;
  /** Which provider resolved (or failed) the address. */
  provider: string;
  matchedAddress?: string;
  error?: string;
};

export type GeocodeRequest = {
  /** Correlation id echoed back by the provider. */
  id: string;
  street: string;
  city: string;
  state: string;
  zip: string;
};

/** Reports batch-level progress on long geocoding runs. */
export type GeocodeProgress = (done: number, total: number) => void;

/**
 * Pluggable geocoder. The Census provider is primary; a paid provider can be
 * dropped in behind the same contract for addresses Census cannot resolve.
 */
export type Geocoder = {
  readonly name: string;
  geocode(
    requests: GeocodeRequest[],
    onProgress?: GeocodeProgress,
  ): Promise<Map<string, GeocodeResult>>;
};

/** What the planner intends to do with one parsed record. */
export type PlannedAction = "insert" | "update" | "rekey" | "duplicate" | "skip";

/** A stored or incoming name that looks like a street address. */
export type AddressLikeNameFlag = {
  name: string;
  city: string | null;
  state: string | null;
  /** Incoming roster record vs an already-stored row. */
  source: "incoming" | "existing";
  existingId?: string;
  legacyId?: string | null;
  reasons: string[];
};

/** One side of a post-sync same-street / very-close pair. */
export type ProximityFlagSide = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  address: string | null;
  legacyId: string | null;
  /** True when this side is a dry-run insert that is not in the table yet. */
  pending?: boolean;
};

/**
 * Two catalog (or planned-insert) rows that share a brand token and sit on
 * the same normalized street or within 100 m on the same road. Report only —
 * the sync does not merge them.
 */
export type ProximityFlag = {
  a: ProximityFlagSide;
  b: ProximityFlagSide;
  reason: "same_street" | "close";
  sharedTokens: string[];
  /** Haversine meters when both sides have coordinates; otherwise null. */
  meters: number | null;
};

export type PlannedChange = {
  action: PlannedAction;
  naturalKey: string;
  name: string;
  city: string;
  state: string;
  /** Existing row id when the record matched something already stored. */
  existingId?: string;
  /** Prior legacy_id when this is a rekey of a v1-keyed row. */
  previousKey?: string;
  /** Name of the existing row a duplicate candidate collided with. */
  conflictsWith?: string;
  /** legacy_id of that existing row, when it has one (roster vs curated). */
  conflictsWithLegacyId?: string | null;
  /** Name-similarity score behind a duplicate flag, in [0, 1]. */
  matchScore?: number;
  /** Tokens the duplicate flag rests on, so a reviewer can judge it. */
  matchedOn?: string[];
  /** How the duplicate flag was accepted. Same-batch address collapses omit this. */
  matchVia?: "overlap" | "acronym";
  geocode?: GeocodeResult;
};

export type SyncSummary = {
  ok: boolean;
  dryRun: boolean;
  sourceUrl: string;
  reportUpdatedAt: string | null;
  parser: ParseDiagnostics["parser"];
  rowsParsed: number;
  rowsProcessed: number;
  inserted: number;
  updated: number;
  rekeyed: number;
  /**
   * Roster records withheld from insertion because they matched an existing
   * row (any legacy_id scheme) above the duplicate-detection threshold. Never
   * inserted and never auto-resolved — a human must resolve the match (e.g.
   * backfill legacy_id onto the existing row) before a future run will
   * insert this record. See duplicateCandidates for what each one matched.
   */
  skipped: number;
  duplicatesFlagged: number;
  geocodeMatched: number;
  geocodeFailed: number;
  regeocodedExisting: number;
  /**
   * Curated field values left in place because the roster has no authority
   * over them (name, description, pricing, intake status, address, and
   * lat/lng when the stored address is held).
   */
  curatedPreserved: number;
  /**
   * Roster records that look like an existing row, regardless of whether
   * that row already carries a legacy_id under some other key scheme. Every
   * entry here corresponds to a `skip`-actioned record in `plan` — the sync
   * never mutates the existing row and never inserts the new one.
   */
  duplicateCandidates: PlannedChange[];
  /** Records whose address no geocoder could resolve. */
  geocodeFailures: Array<{ name: string; city: string; state: string; reason: string }>;
  /**
   * Record blocks the parser discarded before an address anchor. Surfaced the
   * same way as geocodeFailures so under-counts are reviewable.
   */
  parseAbandonments: AbandonedBlock[];
  /**
   * Names that look like addresses (digit, Extension/Suite, street suffix).
   * Flagged for review; the sync still writes the row.
   */
  addressLikeNames: AddressLikeNameFlag[];
  /**
   * Same-street or ≤100 m pairs that share a brand token, regardless of
   * the fuzzy matcher's score. Catches short-acronym names the matcher
   * cannot hold. Report only — never merged automatically.
   */
  proximityFlags: ProximityFlag[];
  /** Full per-record plan. Only populated when explicitly requested. */
  plan?: PlannedChange[];
  /**
   * Pro bono list only. Court-listing appearances before same-office
   * consolidation. Unset on the R&A roster sync.
   */
  listingsParsed?: number;
  /** First few insert payloads, for report-only review. */
  insertPreview?: Array<{
    legacy_id: string;
    name: string;
    description: string;
    address: string;
    city: string;
    state: string;
    lat: number | null;
    lng: number | null;
    org_type: string;
    pricing: string;
    intake_status: string;
    languages: string[];
    languages_confirmed: boolean;
    verified: false;
    website_url?: string;
    catchment_note?: string;
    address_role?: "physical" | "mailing";
  }>;
  /** Non-fatal problems; a populated list still returns ok when rows landed. */
  warnings: string[];
  errors: string[];
  durationMs: number;
};
