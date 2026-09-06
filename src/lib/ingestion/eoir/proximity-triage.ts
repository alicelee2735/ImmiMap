/**
 * Post-sync proximity scan. Does not change matcher thresholds or merge rows.
 *
 * The 32-pair cleanup's bucket 2 was: same `normalizeStreet()`, or very close
 * geocoded distance (YMCA 3110 vs 3120 Hayes at 32 ft). The automated pass
 * used ≤100 m, then humans excluded Brooklyn Defender pairs at ~80 m on
 * *different* streets (courthouse cluster). This scan keeps ≤100 m only when
 * the road stem matches (leading house number stripped), which is what
 * actually landed in bucket 2.
 *
 * Token overlap here is not a fuzzy name score. Sharing one brand token
 * after stripping city + generic program-of words is enough — that is the
 * RAICES-without-parenthetical case the matcher structurally cannot hold.
 */
import { brandIdentityTokens } from "@/lib/ingestion/eoir/match";
import {
  normalizeStreet,
  streetFromStoredAddress,
} from "@/lib/ingestion/eoir/normalize";
import type { ProximityFlag, ProximityFlagSide } from "@/lib/ingestion/eoir/types";

/** Same cutoff the 32-pair pass used before the hand sort into buckets. */
export const CLOSE_METERS = 100;

export type ProximityRow = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  legacyId: string | null;
  pending?: boolean;
};

export type ProximityRowInput = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  legacy_id?: string | null;
  legacyId?: string | null;
};

export type ProximityInsert = {
  legacy_id: string;
  name: string;
  city: string;
  state: string;
  address: string;
  lat: number | null;
  lng: number | null;
};

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const earthMeters = 6_371_000;
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const chord =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthMeters * Math.atan2(Math.sqrt(chord), Math.sqrt(1 - chord));
}

function roadStem(normalizedStreet: string): string {
  return normalizedStreet.replace(/^\d+/, "");
}

function isPoBox(street: string, normalized: string): boolean {
  return normalized.includes("pobox") || /\bp\.?\s*o\.?\s*box\b/i.test(street);
}

function sideOf(row: ProximityRow): ProximityFlagSide {
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    state: row.state,
    address: row.address,
    legacyId: row.legacyId,
    ...(row.pending ? { pending: true } : {}),
  };
}

function pairKey(leftId: string, rightId: string): string {
  return leftId < rightId ? `${leftId}|${rightId}` : `${rightId}|${leftId}`;
}

/**
 * Dry-run universe: live rows, with planned updates overlaid, plus inserts
 * that are about to land. Apply runs should pass the post-write table
 * instead (no pending inserts).
 */
export function universeFromSync(input: {
  existing: ProximityRowInput[];
  inserts: ProximityInsert[];
  updates: Array<{
    id: string;
    row: Partial<ProximityInsert> & { legacy_id?: string };
  }>;
}): ProximityRow[] {
  const byId = new Map<string, ProximityRow>();

  for (const row of input.existing) {
    byId.set(row.id, {
      id: row.id,
      name: row.name,
      city: row.city,
      state: row.state,
      address: row.address,
      lat: row.lat,
      lng: row.lng,
      legacyId: row.legacyId ?? row.legacy_id ?? null,
    });
  }

  for (const { id, row } of input.updates) {
    const previous = byId.get(id);
    if (!previous) continue;
    byId.set(id, {
      ...previous,
      name: row.name ?? previous.name,
      city: row.city ?? previous.city,
      state: row.state ?? previous.state,
      address: row.address ?? previous.address,
      lat: row.lat !== undefined ? row.lat : previous.lat,
      lng: row.lng !== undefined ? row.lng : previous.lng,
      legacyId: row.legacy_id ?? previous.legacyId,
    });
  }

  const out = [...byId.values()];
  for (const row of input.inserts) {
    out.push({
      id: `insert:${row.legacy_id}`,
      name: row.name,
      city: row.city,
      state: row.state,
      address: row.address,
      lat: row.lat,
      lng: row.lng,
      legacyId: row.legacy_id,
      pending: true,
    });
  }
  return out;
}

type IndexedRow = {
  row: ProximityRow;
  tokens: Set<string>;
  streetKey: string | null;
  stem: string | null;
  poBox: boolean;
};

function indexRow(row: ProximityRow): IndexedRow | null {
  const tokens = brandIdentityTokens(row.name, row.city);
  if (tokens.size === 0) return null;

  const street = streetFromStoredAddress(row.address ?? "", row.city);
  const normalized = street ? normalizeStreet(street) : "";
  const poBox = Boolean(normalized) && isPoBox(street, normalized);
  const stemPart = roadStem(normalized);
  const streetKey =
    !poBox && normalized && row.state
      ? `${row.state.toUpperCase()}|${normalized}`
      : null;
  const stem =
    !poBox && stemPart && row.state
      ? `${row.state.toUpperCase()}|${stemPart}`
      : null;

  return { row, tokens, streetKey, stem, poBox };
}

export function findProximityFlags(rows: ProximityRow[]): ProximityFlag[] {
  const indexed: IndexedRow[] = [];
  for (const row of rows) {
    const item = indexRow(row);
    if (item) indexed.push(item);
  }

  const byToken = new Map<string, number[]>();
  indexed.forEach((item, index) => {
    for (const token of item.tokens) {
      const bucket = byToken.get(token) ?? [];
      bucket.push(index);
      byToken.set(token, bucket);
    }
  });

  const seen = new Set<string>();
  const flags: ProximityFlag[] = [];

  for (const indexes of byToken.values()) {
    if (indexes.length < 2) continue;

    for (let i = 0; i < indexes.length; i += 1) {
      for (let j = i + 1; j < indexes.length; j += 1) {
        const left = indexed[indexes[i]];
        const right = indexed[indexes[j]];
        if (left.row.id === right.row.id) continue;

        const key = pairKey(left.row.id, right.row.id);
        if (seen.has(key)) continue;
        seen.add(key);

        const leftState = (left.row.state ?? "").toUpperCase();
        const rightState = (right.row.state ?? "").toUpperCase();
        if (!leftState || leftState !== rightState) continue;

        const sharedTokens = [...left.tokens]
          .filter((token) => right.tokens.has(token))
          .sort();
        if (sharedTokens.length === 0) continue;

        const sameStreet = Boolean(
          left.streetKey && left.streetKey === right.streetKey,
        );

        let meters: number | null = null;
        if (
          !left.poBox &&
          !right.poBox &&
          left.row.lat != null &&
          left.row.lng != null &&
          right.row.lat != null &&
          right.row.lng != null
        ) {
          meters = haversineMeters(
            { lat: left.row.lat, lng: left.row.lng },
            { lat: right.row.lat, lng: right.row.lng },
          );
        }

        const close =
          !sameStreet &&
          meters != null &&
          meters <= CLOSE_METERS &&
          Boolean(left.stem && left.stem === right.stem);

        if (!sameStreet && !close) continue;

        const [a, b] =
          left.row.id < right.row.id
            ? [left.row, right.row]
            : [right.row, left.row];

        flags.push({
          a: sideOf(a),
          b: sideOf(b),
          reason: sameStreet ? "same_street" : "close",
          sharedTokens,
          meters: meters != null ? Math.round(meters) : null,
        });
      }
    }
  }

  flags.sort((left, right) => {
    if (left.reason !== right.reason) {
      return left.reason === "same_street" ? -1 : 1;
    }
    return (left.meters ?? 0) - (right.meters ?? 0);
  });
  return flags;
}

export function formatProximityFlag(flag: ProximityFlag): string {
  const pending = (side: ProximityFlagSide) =>
    side.pending ? " [planned insert]" : "";
  const where = [flag.a.city, flag.a.state].filter(Boolean).join(", ") || "?";
  const dist =
    flag.reason === "same_street"
      ? "same street"
      : flag.meters != null
        ? `${flag.meters} m`
        : "close";
  return (
    `"${flag.a.name}"${pending(flag.a)} ↔ "${flag.b.name}"${pending(flag.b)} ` +
    `(${where}) — ${dist}; shared ${flag.sharedTokens.join(", ")}`
  );
}
