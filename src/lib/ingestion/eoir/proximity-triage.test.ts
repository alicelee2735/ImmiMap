import assert from "node:assert/strict";
import test from "node:test";

import {
  findProximityFlags,
  formatProximityFlag,
  haversineMeters,
  universeFromSync,
  type ProximityRow,
} from "./proximity-triage";

function row(overrides: Partial<ProximityRow> & { id: string; name: string }): ProximityRow {
  return {
    city: "San Antonio",
    state: "TX",
    address: null,
    lat: null,
    lng: null,
    legacyId: null,
    ...overrides,
  };
}

/** ~`meters` due east of an origin. Fine for tests under a few hundred meters. */
function eastOf(
  origin: { lat: number; lng: number },
  meters: number,
): { lat: number; lng: number } {
  const lng =
    origin.lng +
    meters / (111_320 * Math.cos((origin.lat * Math.PI) / 180));
  return { lat: origin.lat, lng };
}

test("haversine agrees with a known short offset", () => {
  const origin = { lat: 37.775, lng: -122.42 };
  const nearby = eastOf(origin, 10);
  const meters = haversineMeters(origin, nearby);
  assert.ok(meters > 9 && meters < 11, `expected ~10 m, got ${meters}`);
});

test("same street and a shared brand token flags without needing coordinates", () => {
  const flags = findProximityFlags([
    row({
      id: "curated",
      name: "RAICES San Antonio",
      address: "131 Interpark Blvd, San Antonio, TX 78216",
    }),
    row({
      id: "probono",
      name: "RAICES Texas Legal Services",
      address: "131 Interpark Boulevard, San Antonio, TX 78216",
    }),
  ]);

  assert.equal(flags.length, 1);
  assert.equal(flags[0].reason, "same_street");
  assert.deepEqual(flags[0].sharedTokens, ["raices"]);
  assert.equal(flags[0].meters, null);
});

test("St vs Street on the same rooftop flags", () => {
  const flags = findProximityFlags([
    row({
      id: "a",
      name: "UFW Foundation Bakersfield",
      city: "Bakersfield",
      state: "CA",
      address: "917 H Street, Suite 200, Bakersfield, CA 93304",
    }),
    row({
      id: "b",
      name: "UFW Foundation",
      city: "Bakersfield",
      state: "CA",
      address: "917 H St, Suite 200, Bakersfield, CA 93304",
    }),
  ]);

  assert.equal(flags.length, 1);
  assert.equal(flags[0].reason, "same_street");
});

test("East Bay ZIP disagreement on the same street still flags", () => {
  const flags = findProximityFlags([
    row({
      id: "a",
      name: "East Bay Community Law Center",
      city: "Berkeley",
      state: "CA",
      address: "2921 Adeline Street, Berkeley, CA 94703",
    }),
    row({
      id: "b",
      name: "East Bay Community Law Center",
      city: "Berkeley",
      state: "CA",
      address: "2921 Adeline Street, Berkeley, CA 94720",
    }),
  ]);

  assert.equal(flags.length, 1);
  assert.equal(flags[0].reason, "same_street");
});

test("adjacent house numbers on the same road within 100 m flag as close", () => {
  const origin = { lat: 37.7215, lng: -122.386 };
  const nearby = eastOf(origin, 10);
  const flags = findProximityFlags([
    row({
      id: "a",
      name: "YMCA Urban Services",
      city: "San Francisco",
      state: "CA",
      address: "3110 Hayes Street, San Francisco, CA 94102",
      ...origin,
    }),
    row({
      id: "b",
      name: "YMCA of San Francisco",
      city: "San Francisco",
      state: "CA",
      address: "3120 Hayes Street, San Francisco, CA 94102",
      ...nearby,
    }),
  ]);

  assert.equal(flags.length, 1);
  assert.equal(flags[0].reason, "close");
  assert.ok((flags[0].meters ?? 99) <= 15);
  assert.deepEqual(flags[0].sharedTokens, ["ymca"]);
});

test("courthouse cluster at ~80 m on different streets is not flagged", () => {
  const origin = { lat: 40.69, lng: -73.99 };
  const nearby = eastOf(origin, 80);
  const flags = findProximityFlags([
    row({
      id: "a",
      name: "Brooklyn Defender Services",
      city: "Brooklyn",
      state: "NY",
      address: "177 Livingston Street, Brooklyn, NY 11201",
      ...origin,
    }),
    row({
      id: "b",
      name: "Brooklyn Defender Services",
      city: "Brooklyn",
      state: "NY",
      address: "195 Schermerhorn Street, Brooklyn, NY 11201",
      ...nearby,
    }),
  ]);

  assert.equal(flags.length, 0);
});

test("separate offices of the same brand more than 100 m apart are not flagged", () => {
  const origin = { lat: 29.737, lng: -95.313 };
  const far = eastOf(origin, 980);
  const flags = findProximityFlags([
    row({
      id: "a",
      name: "BakerRipley",
      city: "Houston",
      state: "TX",
      address: "6500 Rookin Street, Houston, TX 77074",
      ...origin,
    }),
    row({
      id: "b",
      name: "BakerRipley",
      city: "Houston",
      state: "TX",
      address: "4450 Savoy Drive, Houston, TX 77006",
      ...far,
    }),
  ]);

  assert.equal(flags.length, 0);
});

test("generic program-of words on the same street are not a shared brand token", () => {
  const flags = findProximityFlags([
    row({
      id: "a",
      name: "Legal Aid Society",
      city: "Brooklyn",
      state: "NY",
      address: "111 Livingston Street, Brooklyn, NY 11201",
    }),
    row({
      id: "b",
      name: "Immigration Legal Services",
      city: "Brooklyn",
      state: "NY",
      address: "111 Livingston Street, Brooklyn, NY 11201",
    }),
  ]);

  assert.equal(flags.length, 0);
});

test("a PO Box is not compared to a street address even when coordinates sit on the ZIP", () => {
  const origin = { lat: 40.71, lng: -74.0 };
  const flags = findProximityFlags([
    row({
      id: "a",
      name: "RAICES",
      city: "San Antonio",
      state: "TX",
      address: "PO Box 7865, San Antonio, TX 78207",
      ...origin,
    }),
    row({
      id: "b",
      name: "RAICES San Antonio",
      address: "131 Interpark Blvd, San Antonio, TX 78216",
      ...origin,
    }),
  ]);

  assert.equal(flags.length, 0);
});

test("a planned insert next to an existing same-street row is flagged on dry run", () => {
  const flags = findProximityFlags(
    universeFromSync({
      existing: [
        {
          id: "curated",
          name: "RAICES San Antonio",
          city: "San Antonio",
          state: "TX",
          address: "131 Interpark Blvd, San Antonio, TX 78216",
          lat: null,
          lng: null,
          legacy_id: "svc-tx-raices",
        },
      ],
      inserts: [
        {
          legacy_id:
            "doj-probono-raices-texas-legal-services-san-antonio-78216-f434850f",
          name: "RAICES Texas Legal Services",
          city: "San Antonio",
          state: "TX",
          address: "131 Interpark Blvd, San Antonio, TX 78216",
          lat: null,
          lng: null,
        },
      ],
      updates: [],
    }),
  );

  assert.equal(flags.length, 1);
  assert.equal(flags[0].b.pending, true);
  assert.match(formatProximityFlag(flags[0]), /planned insert/);
});
