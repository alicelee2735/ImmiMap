/**
 * Orchestrates the EOIR roster → `organizations` sync.
 *
 * Design notes:
 *  - Idempotent by construction: every row is addressed by a deterministic
 *    natural key stored in `organizations.legacy_id` (UNIQUE), so repeat runs
 *    update in place instead of inserting.
 *  - Dry run is the default. Nothing is written unless `apply` is set.
 *  - Rows written by the previous ingest used a key format without an address
 *    component. Those are re-keyed in place rather than duplicated.
 *  - Every existing row — regardless of which legacy_id scheme it already
 *    carries, or whether it has one at all — is eligible for fuzzy matching.
 *    A record that fuzzy-matches an existing row above the matcher's own
 *    acceptance threshold is never inserted: it is skipped and logged to
 *    `duplicateCandidates` for a human to resolve (typically by backfilling
 *    legacy_id onto the existing row), and will keep being skipped on every
 *    future run until that happens.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  EOIR_KEY_PREFIX,
  EOIR_PRO_BONO_KEY_PREFIX,
  MIN_EXPECTED_PRO_BONO_RECORDS,
  MIN_EXPECTED_RECORDS,
} from "@/lib/ingestion/eoir/constants";
import { createIngestClient } from "@/lib/ingestion/eoir/client";
import { downloadProBonoList } from "@/lib/ingestion/eoir/fetch-pro-bono";
import { downloadRoster, type RosterDownload } from "@/lib/ingestion/eoir/fetch-roster";
import {
  censusGeocoder,
  chainGeocoders,
  createPaidGeocoderStub,
} from "@/lib/ingestion/eoir/geocode";
import {
  DuplicateMatcher,
  namesIndicateSameOffice,
  zipFromAddress,
  type MatchCandidate,
} from "@/lib/ingestion/eoir/match";
import {
  addressIdentityKey,
  buildLegacyKeyV1,
  buildNaturalKey,
  toGeocodeRequest,
  toOrganizationRow,
  toProBonoOrganizationRow,
  type OrganizationUpsert,
} from "@/lib/ingestion/eoir/normalize";
import { parseProBono } from "@/lib/ingestion/eoir/parse-pro-bono";
import { parseRoster } from "@/lib/ingestion/eoir/parse-roster";
import {
  findProximityFlags,
  universeFromSync,
} from "@/lib/ingestion/eoir/proximity-triage";
import {
  extractPdfPages,
  flattenLines,
  type PdfPage,
} from "@/lib/ingestion/eoir/pdf-text";
import type {
  AddressLikeNameFlag,
  EoirOfficeRecord,
  GeocodeResult,
  ParsedRoster,
  PlannedAction,
  PlannedChange,
  SyncSummary,
} from "@/lib/ingestion/eoir/types";
import { addressLikeNameReasons } from "@/lib/ingestion/eoir/validate-name";

export type SyncOptions = {
  /** Write to the database. When false (default) the run only reports. */
  apply?: boolean;
  /** Cap records processed; useful for smoke tests. */
  limit?: number;
  /** Skip geocoding entirely (parse/plan only). */
  skipGeocode?: boolean;
  /**
   * Replace coordinates on existing rows whose stored address is empty
   * (the new street is being filled). Rows with a populated address are
   * never re-geocoded — the pin stays with the held label. `--no-regeocode`
   * additionally leaves coords untouched even when filling a blank address.
   */
  regeocodeExisting?: boolean;
  /** Emit progress lines. */
  verbose?: boolean;
  /** Include the full per-record plan in the summary (for report files). */
  includePlan?: boolean;
};

type EoirSyncAdapter = {
  label: string;
  download: () => Promise<RosterDownload>;
  parse: (pages: PdfPage[]) => ParsedRoster;
  keyPrefix: string;
  toRow: (
    record: EoirOfficeRecord,
    geocode: GeocodeResult | undefined,
  ) => OrganizationUpsert;
  minExpected: number;
  logSource: string;
  fallbackWarning: string;
  zeroRecordsError: string;
};

const ROSTER_ADAPTER: EoirSyncAdapter = {
  label: "eoir",
  download: downloadRoster,
  parse: (pages) => parseRoster(flattenLines(pages)),
  keyPrefix: EOIR_KEY_PREFIX,
  toRow: toOrganizationRow,
  minExpected: MIN_EXPECTED_RECORDS,
  logSource: "eoir_organizations",
  fallbackWarning:
    "Could not resolve the roster link by label; used the last-known-good URL. The EOIR page layout may have changed.",
  zeroRecordsError: "Parsed zero records from the roster; aborting.",
};

const PRO_BONO_ADAPTER: EoirSyncAdapter = {
  label: "eoir-probono",
  download: downloadProBonoList,
  parse: parseProBono,
  keyPrefix: EOIR_PRO_BONO_KEY_PREFIX,
  toRow: toProBonoOrganizationRow,
  minExpected: MIN_EXPECTED_PRO_BONO_RECORDS,
  logSource: "eoir_pro_bono",
  fallbackWarning:
    "Could not resolve the pro bono list link from the landing page; used the last-known-good URL.",
  zeroRecordsError: "Parsed zero records from the pro bono list; aborting.",
};

export type ExistingRow = {
  id: string;
  legacy_id: string | null;
  /**
   * Extra ingest keys from `organization_source_keys` — a second EOIR list
   * (or later source) for the same office. Indexed for exact-key lookup so
   * that list updates this row instead of inserting another one.
   */
  sourceKeys?: string[];
  name: string;
  city: string | null;
  state: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  description: string | null;
  pricing: string | null;
  intake_status: string | null;
  languages: string[] | null;
};

const WRITE_CHUNK_SIZE = 200;

const EXISTING_ROW_COLUMNS =
  "id, legacy_id, name, city, state, address, lat, lng, description, pricing, intake_status, languages";

/**
 * Columns the roster has no authority over. EOIR publishes neither a price nor
 * an intake status — the pipeline defaults both — and its description is
 * generated boilerplate. Overwriting a human's value with any of those would
 * assert something the source does not say, so an update only fills them in
 * when the row has nothing there.
 *
 * `name` belongs here for a different reason. EOIR prints the legal entity
 * name, identically for every office of a multi-site organization, so a
 * curated name carrying its locality ("World Relief Sacramento") is strictly
 * more useful in a list than the roster's ("World Relief"). Nothing is lost by
 * keeping it: the natural key embeds the name slug, so a genuine EOIR rename
 * mints a new key and inserts a row rather than updating this one — an update
 * only ever runs when the roster name already matches.
 *
 * `languages` belongs here so the roster's English baseline only ever fills
 * an empty gap. It must never clobber a real, human-confirmed language list
 * (see the `languages_confirmed` handling below, which travels with it).
 *
 * `address` is the same fill-gap rule. A human-reviewed street (Centro's
 * E. 12th, HIAS Broadway, BDS Livingston, IIBA Second Street) must not be
 * overwritten by a later roster PDF. Inserts never reach `buildUpdatePayload`,
 * so a genuinely new organization still gets its roster address on the way in.
 * An existing row with a blank address is also filled — only a populated
 * stored address is held back. When that address is held, `lat`/`lng` are
 * held with it: the pin must not move to a roster-geocoded street the label
 * no longer describes.
 */
const CURATED_COLUMNS = [
  "name",
  "description",
  "pricing",
  "intake_status",
  "languages",
  "address",
] as const;

/** Treats an empty array the same as null/undefined/"" — nothing curated stored yet. */
function isPopulated(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export type OrganizationUpdate = Partial<OrganizationUpsert> & {
  legacy_id: string;
};

/** Drops roster values that would clobber a curated one. */
export function buildUpdatePayload(
  row: OrganizationUpsert,
  previous: ExistingRow | undefined,
): { payload: OrganizationUpdate; preserved: string[] } {
  const payload: OrganizationUpdate = { ...row };
  const preserved: string[] = [];

  // Roster data is never a manual review. Inserts send verified: false;
  // updates must not touch a human's later decision.
  delete payload.verified;
  preserved.push("verified");

  for (const column of CURATED_COLUMNS) {
    const current = previous?.[column];
    if (!isPopulated(current)) continue;

    delete payload[column];
    preserved.push(column);
  }

  // Pin stays with the held street. A roster geocode of a different EOIR
  // listing must not move the marker while the label stays put. lat/lng are
  // not independently curated: a blank stored address still receives the
  // new street's coordinates.
  if (isPopulated(previous?.address)) {
    delete payload.lat;
    delete payload.lng;
    preserved.push("lat", "lng");
  }

  // languages_confirmed travels with languages: it only ever transitions
  // empty → "English, unconfirmed" alongside a freshly-filled languages gap.
  // It never overwrites a value a human (or an earlier sync run) already
  // set, and a sync never marks anything confirmed on its own.
  if (isPopulated(previous?.languages)) {
    delete payload.languages_confirmed;
  } else {
    payload.languages_confirmed = false;
  }

  // A row that already has a primary key under another scheme (roster
  // doj-ra-* plus a pro bono alias, for example) must keep that primary.
  // The incoming natural key is how we found the row; it lives on
  // organization_source_keys, not on organizations.legacy_id.
  if (
    previous?.legacy_id &&
    previous.legacy_id !== row.legacy_id &&
    (previous.sourceKeys ?? []).includes(row.legacy_id)
  ) {
    payload.legacy_id = previous.legacy_id;
    preserved.push("legacy_id");
  }

  return { payload, preserved };
}

/**
 * Whether this record should be sent to the geocoder.
 *
 * Inserts always geocode. Existing rows whose stored address is populated
 * never do — the address text is not changing (it is held), so refreshing
 * the pin from a possibly different roster street would desync the marker
 * from the label. Blank stored addresses still geocode the incoming street
 * unless `--no-regeocode` and coordinates already exist.
 */
export function shouldGeocodeRecord(
  action: PlannedAction,
  previous: ExistingRow | undefined,
  regeocodeExisting: boolean,
): boolean {
  if (action === "skip" || action === "duplicate") return false;
  if (action === "insert") return true;
  if (isPopulated(previous?.address)) return false;
  if (regeocodeExisting) return true;
  return previous == null || previous.lat == null || previous.lng == null;
}

function flagAddressLikeNames(
  records: EoirOfficeRecord[],
  existing: ExistingRow[],
): AddressLikeNameFlag[] {
  const flags: AddressLikeNameFlag[] = [];

  for (const row of existing) {
    const reasons = addressLikeNameReasons(row.name);
    if (reasons.length === 0) continue;
    flags.push({
      name: row.name,
      city: row.city,
      state: row.state,
      source: "existing",
      existingId: row.id,
      legacyId: row.legacy_id,
      reasons,
    });
  }

  for (const record of records) {
    const reasons = addressLikeNameReasons(record.name);
    if (reasons.length === 0) continue;
    flags.push({
      name: record.name,
      city: record.city,
      state: record.state,
      source: "incoming",
      reasons,
    });
  }

  return flags;
}

/**
 * Same-street / very-close pairs the matcher does not hold. Report only.
 * A failure here must not fail the sync.
 */
async function runProximityTriage(args: {
  summary: SyncSummary;
  warnings: string[];
  existing: ExistingRow[];
  inserts: OrganizationUpsert[];
  updates: Array<{ id: string; row: OrganizationUpdate }>;
  refetch?: () => Promise<ExistingRow[]>;
}): Promise<void> {
  try {
    const rows = args.refetch
      ? universeFromSync({
          existing: await args.refetch(),
          inserts: [],
          updates: [],
        })
      : universeFromSync({
          existing: args.existing,
          inserts: args.inserts,
          updates: args.updates,
        });
    args.summary.proximityFlags = findProximityFlags(rows);
    if (args.summary.proximityFlags.length > 0) {
      args.warnings.push(
        `${args.summary.proximityFlags.length} same-street or ≤100 m pair(s) share a name token the matcher did not hold — review; not merged.`,
      );
    }
  } catch (error) {
    args.warnings.push(
      `proximity triage failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function fetchExistingRows(
  supabase: SupabaseClient,
): Promise<ExistingRow[]> {
  const rows: ExistingRow[] = [];
  const pageSize = 1000;

  // Supabase caps rows per response; page until exhausted.
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("organizations")
      .select(EXISTING_ROW_COLUMNS)
      .order("id")
      .range(from, from + pageSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    rows.push(...(data as ExistingRow[]));
    if (data.length < pageSize) break;
  }

  const keysByOrg = new Map<string, string[]>();
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("organization_source_keys")
      .select("organization_id, legacy_id")
      .order("legacy_id")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const key of data as Array<{ organization_id: string; legacy_id: string }>) {
      const list = keysByOrg.get(key.organization_id) ?? [];
      list.push(key.legacy_id);
      keysByOrg.set(key.organization_id, list);
    }
    if (data.length < pageSize) break;
  }

  for (const row of rows) {
    const extra = keysByOrg.get(row.id);
    if (extra && extra.length > 0) row.sourceKeys = extra;
  }

  return rows;
}

/**
 * Decides insert / update / rekey per record and flags — then blocks — likely
 * duplicates of existing rows. Pure so it can be reasoned about without a
 * database.
 */
export function planChanges(
  records: EoirOfficeRecord[],
  existing: ExistingRow[],
  keyPrefix: string = EOIR_KEY_PREFIX,
): { changes: PlannedChange[]; duplicates: PlannedChange[] } {
  const byKey = new Map<string, ExistingRow>();

  for (const row of existing) {
    if (row.legacy_id) byKey.set(row.legacy_id, row);
    for (const extra of row.sourceKeys ?? []) {
      byKey.set(extra, row);
    }
  }

  // Every existing row is a fuzzy-match candidate, regardless of whether it
  // already carries a legacy_id under some other key scheme. A `svc-*` row
  // being resolved against the hand-seed scheme says nothing about whether
  // it has ever been reconciled against the EOIR (`doj-ra-*`) scheme — that
  // gap is exactly what let curated and EOIR-synced rows for the same real
  // organization coexist undetected (see
  // scripts/audit-duplicate-organizations.ts). Exact-key lookups below still
  // short-circuit same-scheme matches before any fuzzy comparison runs, so a
  // row already reconciled under its own scheme is never double-flagged
  // against itself. Extra keys on `organization_source_keys` are indexed
  // here too, so a second EOIR list (pro bono) can find a row whose primary
  // key belongs to the first list (roster).
  const candidates: MatchCandidate[] = existing.map((row) => ({
    id: row.id,
    name: row.name,
    city: row.city,
    state: row.state,
    zip: zipFromAddress(row.address),
    legacyId: row.legacy_id,
  }));

  // Rarity weights come from the roster itself, so "immigration" is discounted
  // and an acronym like "CRLAF" carries weight.
  const matcher = new DuplicateMatcher(
    records.map((record) => record.name),
    candidates,
  );

  const changes: PlannedChange[] = [];
  const duplicates: PlannedChange[] = [];
  // A v1 key can describe several offices; only the first may claim the row.
  const claimedV1 = new Set<string>();
  const pendingInserts: EoirOfficeRecord[] = [];

  const baseOf = (record: EoirOfficeRecord) => ({
    naturalKey: buildNaturalKey(record, keyPrefix),
    name: record.name,
    city: record.city,
    state: record.state,
  });

  for (const record of records) {
    const naturalKey = buildNaturalKey(record, keyPrefix);
    const v1Key = buildLegacyKeyV1(record, keyPrefix);
    const base = baseOf(record);

    const exact = byKey.get(naturalKey);
    if (exact) {
      changes.push({ ...base, action: "update", existingId: exact.id });
      continue;
    }

    const v1Row = byKey.get(v1Key);
    if (v1Row && !claimedV1.has(v1Key)) {
      claimedV1.add(v1Key);
      changes.push({
        ...base,
        action: "rekey",
        existingId: v1Row.id,
        previousKey: v1Key,
      });
      continue;
    }

    // Hard gate: a record that resembles an existing row above the matcher's
    // own acceptance threshold (near-total name containment, or a partial
    // overlap corroborated by a shared ZIP) is never inserted. Missing a real
    // duplicate silently doubles a listing forever; holding an insert back
    // is fully recoverable — a human resolves the match (typically by
    // backfilling legacy_id onto the existing row) and the very next run
    // picks the record up normally. So this leans toward skipping.
    const matches = matcher.findMatches({
      name: record.name,
      city: record.city,
      state: record.state,
      zip: record.zip,
    });

    if (matches.length > 0) {
      changes.push({ ...base, action: "skip" });
      for (const match of matches) {
        duplicates.push({
          ...base,
          action: "duplicate",
          existingId: match.candidate.id,
          conflictsWith: match.candidate.name,
          conflictsWithLegacyId: match.candidate.legacyId ?? null,
          matchScore: Number(match.score.toFixed(3)),
          matchedOn: match.matchedOn,
          matchVia: match.via,
        });
      }
      continue;
    }

    pendingInserts.push(record);
  }

  // Same-batch gate. The matcher above only sees already-stored rows, so two
  // parsed fragments of one office (different name slugs, same street) would
  // both insert. Collapse those here, keeping the more complete name.
  const collapsed: EoirOfficeRecord[] = [];
  for (const record of pendingInserts) {
    const sibling = collapsed.find(
      (kept) =>
        addressIdentityKey(kept) === addressIdentityKey(record) &&
        namesIndicateSameOffice(kept.name, record.name),
    );
    if (!sibling) {
      collapsed.push(record);
      continue;
    }

    const winner =
      record.name.length > sibling.name.length ? record : sibling;
    const loser = winner === record ? sibling : record;
    mergeOfficeMetadata(winner, loser);
    if (winner === record) {
      collapsed[collapsed.indexOf(sibling)] = record;
    }
    pushBatchDuplicate(changes, duplicates, loser, winner, keyPrefix);
  }

  for (const record of collapsed) {
    changes.push({ ...baseOf(record), action: "insert" });
  }

  return { changes, duplicates };
}

function mergeOfficeMetadata(
  into: EoirOfficeRecord,
  from: EoirOfficeRecord,
): void {
  const courts = new Set([...(into.courts ?? []), ...(from.courts ?? [])]);
  into.courts = [...courts];
  if ((from.website?.length ?? 0) > (into.website?.length ?? 0)) {
    into.website = from.website;
  }
  if (!into.phone && from.phone) into.phone = from.phone;
}

function pushBatchDuplicate(
  changes: PlannedChange[],
  duplicates: PlannedChange[],
  loser: EoirOfficeRecord,
  winner: EoirOfficeRecord,
  keyPrefix: string,
): void {
  const base = {
    naturalKey: buildNaturalKey(loser, keyPrefix),
    name: loser.name,
    city: loser.city,
    state: loser.state,
  };
  const winnerKey = buildNaturalKey(winner, keyPrefix);
  changes.push({ ...base, action: "skip" });
  duplicates.push({
    ...base,
    action: "duplicate",
    existingId: winnerKey,
    conflictsWith: winner.name,
    conflictsWithLegacyId: winnerKey,
    matchScore: 1,
    matchedOn: ["same-address"],
  });
}

/**
 * Records the run outcome. Tolerates a `data_ingestion_log` that predates the
 * `source`/`details` columns so logging never breaks the sync itself.
 */
async function logRun(
  supabase: SupabaseClient,
  summary: SyncSummary,
  source: string = "eoir_organizations",
): Promise<void> {
  const status = summary.ok ? "success" : "failed";
  const errorMessage =
    [...summary.errors, ...summary.warnings].join(" | ") || undefined;

  // Keep the audit row small: counts and provenance, not the per-record plan.
  // Abandoned blocks are few and the whole point of capturing them, so keep
  // the full list rather than a sample.
  const details = {
    ...summary,
    plan: undefined,
    insertPreview: undefined,
    duplicateCandidates: undefined,
    geocodeFailures: undefined,
    addressLikeNames: undefined,
    duplicateCandidateCount: summary.duplicateCandidates.length,
    duplicateCandidateSample: summary.duplicateCandidates.slice(0, 25),
    geocodeFailureSample: summary.geocodeFailures.slice(0, 25),
    addressLikeNameCount: summary.addressLikeNames.length,
    addressLikeNameSample: summary.addressLikeNames.slice(0, 50),
    parseAbandonmentCount: summary.parseAbandonments.length,
    proximityFlags: undefined,
    proximityFlagCount: summary.proximityFlags.length,
    proximityFlagSample: summary.proximityFlags.slice(0, 25),
  };

  const { error } = await supabase.from("data_ingestion_log").insert({
    status,
    error_message: errorMessage,
    source,
    details,
  });

  if (!error) return;

  const { error: fallbackError } = await supabase
    .from("data_ingestion_log")
    .insert({ status, error_message: errorMessage });

  if (fallbackError) {
    console.warn(
      `[eoir] could not write ingestion log: ${fallbackError.message}`,
    );
  }
}

export async function syncEoirOrganizations(
  options: SyncOptions = {},
): Promise<SyncSummary> {
  return runEoirSync(ROSTER_ADAPTER, options);
}

export async function syncEoirProBonoOrganizations(
  options: SyncOptions = {},
): Promise<SyncSummary> {
  return runEoirSync(PRO_BONO_ADAPTER, options);
}

async function runEoirSync(
  adapter: EoirSyncAdapter,
  options: SyncOptions = {},
): Promise<SyncSummary> {
  const {
    apply = false,
    limit,
    skipGeocode = false,
    regeocodeExisting = true,
    verbose = false,
    includePlan = false,
  } = options;

  const startedAt = Date.now();
  const warnings: string[] = [];
  const errors: string[] = [];

  const log = (message: string) => {
    if (verbose) console.log(`[${adapter.label}] ${message}`);
  };

  const summary: SyncSummary = {
    ok: false,
    dryRun: !apply,
    sourceUrl: "",
    reportUpdatedAt: null,
    parser: "primary",
    rowsParsed: 0,
    rowsProcessed: 0,
    inserted: 0,
    updated: 0,
    rekeyed: 0,
    skipped: 0,
    duplicatesFlagged: 0,
    geocodeMatched: 0,
    geocodeFailed: 0,
    regeocodedExisting: 0,
    curatedPreserved: 0,
    duplicateCandidates: [],
    geocodeFailures: [],
    parseAbandonments: [],
    addressLikeNames: [],
    proximityFlags: [],
    warnings,
    errors,
    durationMs: 0,
  };

  const supabase = await createIngestClient();

  try {
    log("resolving and downloading source PDF…");
    const download = await adapter.download();
    summary.sourceUrl = download.sourceUrl;
    if (download.usedFallbackUrl) {
      warnings.push(adapter.fallbackWarning);
    }

    log(`extracting text (${(download.data.length / 1024).toFixed(0)} KB)…`);
    const pages = await extractPdfPages(download.data);
    const parsed = adapter.parse(pages);

    summary.parser = parsed.diagnostics.parser;
    summary.reportUpdatedAt = parsed.diagnostics.reportUpdatedAt;
    summary.rowsParsed = parsed.records.length;
    summary.parseAbandonments = parsed.diagnostics.abandoned;
    if (typeof parsed.diagnostics.appearances === "number") {
      summary.listingsParsed = parsed.diagnostics.appearances;
    }

    if (parsed.diagnostics.parser === "fallback") {
      warnings.push(
        "Primary parser under-produced; used the heading-agnostic fallback parser. Roster layout likely changed.",
      );
    }
    if (parsed.diagnostics.abandonedBlocks > 0) {
      warnings.push(
        `${parsed.diagnostics.abandonedBlocks} record block(s) ended without an address and were skipped — see parseAbandonments.`,
      );
    }
    if (
      typeof parsed.diagnostics.appearances === "number" &&
      parsed.diagnostics.appearances > parsed.records.length
    ) {
      warnings.push(
        `${parsed.diagnostics.appearances} court-listings collapsed into ${parsed.records.length} unique offices.`,
      );
    }

    if (parsed.records.length === 0) {
      errors.push(adapter.zeroRecordsError);
      summary.durationMs = Date.now() - startedAt;
      await logRun(supabase, summary, adapter.logSource);
      return summary;
    }

    if (parsed.records.length < adapter.minExpected) {
      warnings.push(
        `Parsed only ${parsed.records.length} records (expected at least ${adapter.minExpected}); treating this run as suspect.`,
      );
    }

    const records = typeof limit === "number"
      ? parsed.records.slice(0, limit)
      : parsed.records;
    summary.rowsProcessed = records.length;
    log(`parsed ${parsed.records.length} records via ${summary.parser} parser`);

    const existing = await fetchExistingRows(supabase);
    const { changes, duplicates } = planChanges(
      records,
      existing,
      adapter.keyPrefix,
    );
    summary.duplicatesFlagged = duplicates.length;
    summary.duplicateCandidates = duplicates;
    summary.skipped = changes.filter((c) => c.action === "skip").length;
    summary.addressLikeNames = flagAddressLikeNames(records, existing);
    if (includePlan) summary.plan = changes;

    if (summary.addressLikeNames.length > 0) {
      warnings.push(
        `${summary.addressLikeNames.length} name(s) look address-like (digit, Extension/Suite, or street suffix); flagged for review, not rewritten.`,
      );
    }

    if (summary.skipped > 0) {
      warnings.push(
        `${summary.skipped} record(s) withheld from insertion — they matched ${duplicates.length} existing row(s) above the duplicate-detection threshold. They will keep being skipped on every future run until a human resolves the match (e.g. backfilling legacy_id onto the existing row); see duplicateCandidates.`,
      );
    }

    const keyOf = (record: EoirOfficeRecord) =>
      buildNaturalKey(record, adapter.keyPrefix);

    const byKeyAction = new Map(changes.map((c) => [c.naturalKey, c]));
    const existingById = new Map(existing.map((row) => [row.id, row]));

    // Inserts always geocode. Existing rows with a populated address do not
    // — the street is held, so the pin must stay with it. Blank stored
    // addresses still geocode the incoming street (unless --no-regeocode).
    const geocodeTargets = records.filter((record) => {
      const change = byKeyAction.get(keyOf(record));
      if (!change) return false;
      const row = change.existingId
        ? existingById.get(change.existingId)
        : undefined;
      return shouldGeocodeRecord(change.action, row, regeocodeExisting);
    });

    let geocodes = new Map<string, GeocodeResult>();
    if (!skipGeocode && geocodeTargets.length > 0) {
      log(`geocoding ${geocodeTargets.length} addresses via Census batch…`);
      const geocoder = chainGeocoders(
        [
          censusGeocoder,
          createPaidGeocoderStub(process.env.PAID_GEOCODER_API_KEY),
        ].filter((provider): provider is NonNullable<typeof provider> =>
          Boolean(provider),
        ),
      );

      geocodes = await geocoder.geocode(
        geocodeTargets.map((record) =>
          toGeocodeRequest(record, adapter.keyPrefix),
        ),
        (done, total) => log(`  …geocoded ${done}/${total}`),
      );

      const targetsByKey = new Map(
        geocodeTargets.map((record) => [keyOf(record), record]),
      );

      for (const [key, result] of geocodes) {
        if (result.status === "matched") {
          summary.geocodeMatched += 1;
          continue;
        }

        summary.geocodeFailed += 1;
        const record = targetsByKey.get(key);
        if (record) {
          summary.geocodeFailures.push({
            name: record.name,
            city: record.city,
            state: record.state,
            reason: result.error ?? `${result.provider}: ${result.status}`,
          });
        }
      }
      log(
        `geocoded ${summary.geocodeMatched} matched / ${summary.geocodeFailed} failed`,
      );
    } else if (skipGeocode) {
      warnings.push("Geocoding skipped by option; coordinates left unchanged.");
    }

    const inserts: OrganizationUpsert[] = [];
    const updates: Array<{ id: string; row: OrganizationUpdate }> = [];

    for (const record of records) {
      const key = keyOf(record);
      const change = byKeyAction.get(key);
      if (!change) continue;
      // Blocked pending human resolution — never write, never geocode.
      if (change.action === "skip") continue;

      const geocode = geocodes.get(key);
      // Attach the outcome so reports can show which addresses failed and why.
      if (geocode) change.geocode = geocode;
      const row = adapter.toRow(record, geocode);

      if (change.action === "insert") {
        inserts.push(row);
        continue;
      }

      const previous = change.existingId
        ? existingById.get(change.existingId)
        : undefined;

      // Never blank out a known coordinate because a geocode failed.
      if (row.lat == null || row.lng == null) {
        row.lat = previous?.lat ?? null;
        row.lng = previous?.lng ?? null;
      }

      if (change.existingId) {
        const { payload, preserved } = buildUpdatePayload(row, previous);
        summary.curatedPreserved += preserved.length;
        if (
          previous &&
          typeof payload.lat === "number" &&
          typeof payload.lng === "number" &&
          (previous.lat !== payload.lat || previous.lng !== payload.lng)
        ) {
          summary.regeocodedExisting += 1;
        }
        updates.push({ id: change.existingId, row: payload });
      }
    }

    const isRekey = (row: OrganizationUpdate) =>
      byKeyAction.get(row.legacy_id)?.action === "rekey";

    summary.insertPreview = inserts.slice(0, 5).map((row) => ({
      legacy_id: row.legacy_id,
      name: row.name,
      description: row.description,
      address: row.address,
      city: row.city,
      state: row.state,
      lat: row.lat,
      lng: row.lng,
      org_type: row.org_type,
      pricing: row.pricing,
      intake_status: row.intake_status,
      languages: row.languages,
      languages_confirmed: row.languages_confirmed,
      verified: false,
      ...(row.website_url ? { website_url: row.website_url } : {}),
      ...(row.catchment_note ? { catchment_note: row.catchment_note } : {}),
      ...(row.address_role ? { address_role: row.address_role } : {}),
    }));

    if (!apply) {
      // Dry run reports the plan, so these are intended counts.
      summary.inserted = inserts.length;
      summary.rekeyed = updates.filter((u) => isRekey(u.row)).length;
      summary.updated = updates.length - summary.rekeyed;

      log("dry run — no writes performed");
      await runProximityTriage({
        summary,
        warnings,
        existing,
        inserts,
        updates,
      });
      summary.ok = true;
      summary.durationMs = Date.now() - startedAt;
      return summary;
    }

    // Updates and re-keys are addressed by primary key, so a changed
    // legacy_id cannot collide with the row it is replacing.
    for (const batch of chunk(updates, WRITE_CHUNK_SIZE)) {
      for (const { id, row } of batch) {
        const { error } = await supabase
          .from("organizations")
          .update(row)
          .eq("id", id);

        if (error) {
          errors.push(`update ${row.legacy_id}: ${error.message}`);
          continue;
        }

        if (isRekey(row)) summary.rekeyed += 1;
        else summary.updated += 1;
      }
    }
    log(`updated ${summary.updated} rows, re-keyed ${summary.rekeyed}`);

    for (const batch of chunk(inserts, WRITE_CHUNK_SIZE)) {
      const { data, error } = await supabase
        .from("organizations")
        .upsert(batch, { onConflict: "legacy_id" })
        .select("id");

      if (error) {
        errors.push(`insert batch: ${error.message}`);
        continue;
      }

      summary.inserted += data?.length ?? 0;
    }
    log(`inserted ${summary.inserted} rows`);

    await runProximityTriage({
      summary,
      warnings,
      existing,
      inserts,
      updates,
      refetch: () => fetchExistingRows(supabase),
    });

    // Neither EOIR source publishes practice areas. Do not invent service tags.

    summary.ok = errors.length === 0;
    summary.durationMs = Date.now() - startedAt;
    await logRun(supabase, summary, adapter.logSource);
    return summary;
  } catch (error) {
    errors.push(
      error instanceof Error ? error.message : "Unknown ingestion failure.",
    );
    summary.ok = false;
    summary.durationMs = Date.now() - startedAt;

    try {
      await logRun(supabase, summary, adapter.logSource);
    } catch {
      // Logging must not mask the original failure.
    }

    return summary;
  }
}
