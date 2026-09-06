import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLegacyKeyV1,
  buildNaturalKey,
  formatAddress,
  normalizeStreet,
  streetFromStoredAddress,
} from "./normalize";
import type { EoirOfficeRecord } from "./types";

function record(overrides: Partial<EoirOfficeRecord> = {}): EoirOfficeRecord {
  return {
    name: "Southern Center for Equity Advancement and Immigrant Refuge",
    officeLabel: "Principal Office",
    street: "1130 University Blvd, Suite B9, Box 622",
    city: "Tuscaloosa",
    state: "AL",
    zip: "35401",
    phone: null,
    dateRecognized: "02/04/25",
    expirationDate: "02/04/27",
    status: "Active",
    pendingRenewal: false,
    sourcePage: 2,
    ...overrides,
  };
}

test("natural key is stable across repeated runs", () => {
  assert.equal(buildNaturalKey(record()), buildNaturalKey(record()));
});

test("natural key separates co-located offices the v1 key collided on", () => {
  // Both rows are printed in the roster: same organization, same city, same
  // ZIP, same office label, different street.
  const first = record({ street: "1130 University Blvd, Suite B9, Box 622" });
  const second = record({ street: "1711 4th Avenue" });

  assert.equal(
    buildLegacyKeyV1(first),
    buildLegacyKeyV1(second),
    "v1 keys are expected to collide",
  );
  assert.notEqual(buildNaturalKey(first), buildNaturalKey(second));
});

test("v1 key keeps the format used by already-stored rows", () => {
  const key = buildLegacyKeyV1(
    record({ name: "Hispanic and Immigrant Center of Alabama", city: "Birmingham", zip: "35209" }),
  );
  assert.equal(key, "doj-ra-hispanic-and-immigrant-center-of-alabama-birmingham-35209");
});

test("natural key extends the v1 key rather than replacing it", () => {
  const value = record();
  assert.ok(buildNaturalKey(value).startsWith(`${buildLegacyKeyV1(value)}-`));
});

test("street normalization absorbs cosmetic address edits", () => {
  assert.equal(
    normalizeStreet("117 South Crest Drive, Suite 104"),
    normalizeStreet("117 S. Crest Dr., Ste 104"),
  );
});

test("address carries the locality, as curated rows do", () => {
  assert.equal(
    formatAddress(
      record({
        street: "6270 Elder Creek Road",
        city: "Sacramento",
        state: "CA",
        zip: "95824",
      }),
    ),
    "6270 Elder Creek Road, Sacramento, CA 95824",
  );
});

test("street normalization still distinguishes different addresses", () => {
  assert.notEqual(
    normalizeStreet("1130 University Blvd"),
    normalizeStreet("1711 4th Avenue"),
  );
});

test("street is recovered from a stored locality-bearing address", () => {
  assert.equal(
    streetFromStoredAddress(
      "131 Interpark Blvd, San Antonio, TX 78216",
      "San Antonio",
    ),
    "131 Interpark Blvd",
  );
  assert.equal(
    normalizeStreet(
      streetFromStoredAddress(
        "131 Interpark Blvd., San Antonio, TX 78216",
        "San Antonio",
      ),
    ),
    normalizeStreet(
      streetFromStoredAddress(
        "131 Interpark Boulevard, San Antonio, TX 78216",
        "San Antonio",
      ),
    ),
  );
});

test("pro bono keys share the roster shape under a distinct prefix", () => {
  const value = record();
  const roster = buildNaturalKey(value);
  const proBono = buildNaturalKey(value, "doj-probono");
  assert.ok(roster.startsWith("doj-ra-"));
  assert.ok(proBono.startsWith("doj-probono-"));
  assert.equal(proBono.slice("doj-probono-".length), roster.slice("doj-ra-".length));
});