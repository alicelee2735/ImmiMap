import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLegacyKeyV1,
  buildNaturalKey,
  toOrganizationRow,
  toProBonoOrganizationRow,
} from "./normalize";
import { buildUpdatePayload, planChanges } from "./sync-organizations";
import type { ExistingRow } from "./sync-organizations";
import type { EoirOfficeRecord } from "./types";

function record(overrides: Partial<EoirOfficeRecord> = {}): EoirOfficeRecord {
  return {
    name: "Casa Cornelia Law Center",
    officeLabel: "Principal Office",
    street: "2760 Fifth Avenue, Suite 200",
    city: "San Diego",
    state: "CA",
    zip: "92103",
    phone: "(619) 231-7788",
    dateRecognized: "01/01/00",
    expirationDate: "01/01/30",
    status: "Active",
    pendingRenewal: false,
    sourcePage: 20,
    ...overrides,
  };
}

function existing(overrides: Partial<ExistingRow> = {}): ExistingRow {
  return {
    id: "row-1",
    legacy_id: null,
    name: "Casa Cornelia Law Center",
    city: "San Diego",
    state: "CA",
    address: "2760 Fifth Avenue, Suite 200, San Diego, CA 92103",
    lat: 32.7,
    lng: -117.1,
    description: null,
    pricing: null,
    intake_status: null,
    languages: null,
    ...overrides,
  };
}

test("a record with no stored counterpart is inserted", () => {
  const { changes, duplicates } = planChanges([record()], []);

  assert.equal(changes.length, 1);
  assert.equal(changes[0].action, "insert");
  assert.equal(duplicates.length, 0);
});

test("a record already stored under its natural key is updated in place", () => {
  const value = record();
  const { changes } = planChanges(
    [value],
    [existing({ legacy_id: buildNaturalKey(value) })],
  );

  assert.equal(changes[0].action, "update");
  assert.equal(changes[0].existingId, "row-1");
});

test("a row stored under the v1 key is re-keyed, not duplicated", () => {
  const value = record();
  const { changes } = planChanges(
    [value],
    [existing({ legacy_id: buildLegacyKeyV1(value) })],
  );

  assert.equal(changes[0].action, "rekey");
  assert.equal(changes[0].existingId, "row-1");
  assert.equal(changes[0].previousKey, buildLegacyKeyV1(value));
  assert.equal(changes[0].naturalKey, buildNaturalKey(value));
});

test("only one of several colliding offices may claim the v1-keyed row; the other is blocked as an unresolved lookalike", () => {
  const first = record({ street: "2760 Fifth Avenue, Suite 200" });
  const second = record({ street: "999 Broadway" });
  assert.equal(buildLegacyKeyV1(first), buildLegacyKeyV1(second));

  const { changes, duplicates } = planChanges(
    [first, second],
    [existing({ legacy_id: buildLegacyKeyV1(first) })],
  );

  // The first office re-keys the v1 row in place. The second describes the
  // same name/city/ZIP and, with every existing row now a fuzzy candidate
  // (fix: the candidate pool is no longer limited to key-less rows), it
  // fuzzy-matches that same row and is blocked rather than silently
  // inserted as a possible duplicate — a human must confirm it is really a
  // distinct office before it lands.
  assert.deepEqual(
    changes.map((change) => change.action),
    ["rekey", "skip"],
  );
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].name, second.name);
});

test("key-less lookalike rows are flagged and the insert is blocked", () => {
  const value = record();
  const { changes, duplicates } = planChanges([value], [existing()]);

  // Never inserted: a human must resolve the match first.
  assert.equal(changes[0].action, "skip");
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].conflictsWith, "Casa Cornelia Law Center");
  assert.equal(duplicates[0].existingId, "row-1");
});

test("a lookalike is flagged and blocked even when the names are not identical", () => {
  const value = record({
    name: "California Immigration Project (CIP)",
    city: "Sacramento",
    zip: "95816",
    street: "2210 K Street, Suite 101",
  });

  const { changes, duplicates } = planChanges(
    [value],
    [
      existing({
        name: "California Immigration Project",
        city: "Sacramento",
        address: "2210 K Street, Suite 101, Sacramento, CA 95816",
      }),
    ],
  );

  assert.equal(changes[0].action, "skip");
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].conflictsWith, "California Immigration Project");
  assert.ok(duplicates[0].matchedOn?.includes("project"));
});

test("a lookalike is flagged and blocked even when the existing row is an EOIR roster key", () => {
  const value = record();
  const { changes, duplicates } = planChanges(
    [value],
    [existing({ legacy_id: "doj-ra-casa-cornelia-law-center-san-diego-92103-aaaaaaaa" })],
    "doj-probono",
  );

  assert.equal(changes[0].action, "skip");
  assert.equal(duplicates.length, 1);
  assert.ok(changes[0].naturalKey.startsWith("doj-probono-"));
  assert.equal(
    duplicates[0].conflictsWithLegacyId,
    "doj-ra-casa-cornelia-law-center-san-diego-92103-aaaaaaaa",
  );
});

test("one matcher pass holds a pro bono record against both curated and roster rows", () => {
  const value = record();
  const { changes, duplicates } = planChanges(
    [value],
    [
      existing({ id: "curated", legacy_id: null }),
      existing({
        id: "roster",
        legacy_id: "doj-ra-casa-cornelia-law-center-san-diego-92103-aaaaaaaa",
      }),
    ],
    "doj-probono",
  );

  assert.equal(changes[0].action, "skip");
  assert.equal(changes.length, 1);
  assert.equal(duplicates.length, 2);
  assert.deepEqual(
    duplicates.map((row) => row.existingId).sort(),
    ["curated", "roster"],
  );
});

test("a lookalike is flagged and blocked even when the existing row already has a legacy_id under another scheme", () => {
  // The structural gap this guards against: a curated row keyed under one
  // scheme (e.g. `svc-*`) is not "resolved" against a different scheme
  // (`doj-ra-*`) just because it has *a* legacy_id. The fuzzy matcher must
  // still see it.
  const value = record();
  const { changes, duplicates } = planChanges(
    [value],
    [existing({ legacy_id: "svc-casa-cornelia-law-center" })],
  );

  assert.equal(changes[0].action, "skip");
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].existingId, "row-1");
});

test("exact same-scheme matches still short-circuit before the fuzzy matcher ever runs", () => {
  // A row already reconciled under its own scheme must never also be
  // reported as a fuzzy "duplicate" of the very record that resolves it.
  const value = record();
  const { changes, duplicates } = planChanges(
    [value],
    [existing({ legacy_id: buildNaturalKey(value) })],
  );

  assert.equal(changes[0].action, "update");
  assert.equal(duplicates.length, 0);
});

test("curated values the roster cannot know are left in place", () => {
  const row = toOrganizationRow(record(), undefined);
  const { payload, preserved } = buildUpdatePayload(
    row,
    existing({
      name: "Casa Cornelia Law Center — San Diego",
      description: "Hand-written summary of what this office actually does.",
      pricing: "Low-cost",
      intake_status: "WAITLISTED",
    }),
  );

  assert.deepEqual(preserved.sort(), [
    "description",
    "intake_status",
    "name",
    "pricing",
    "verified",
  ]);
  assert.ok(!("name" in payload));
  assert.ok(!("description" in payload));
  assert.ok(!("pricing" in payload));
  assert.ok(!("intake_status" in payload));
  assert.ok(!("verified" in payload));

  // Columns the roster is authoritative for still get written.
  assert.equal(payload.legacy_id, row.legacy_id);
  assert.equal(payload.address, row.address);
  assert.equal(payload.city, row.city);
  assert.equal(payload.lat, row.lat);
});

test("curated columns are filled when the row has nothing there", () => {
  const row = toOrganizationRow(record(), undefined);
  const { payload, preserved } = buildUpdatePayload(row, existing());

  // A stored row always has a name, so that one is held back here.
  // verified is never written on update regardless of the stored value.
  assert.deepEqual(preserved.sort(), ["name", "verified"]);
  assert.equal(payload.description, row.description);
  assert.equal(payload.pricing, row.pricing);
  assert.equal(payload.intake_status, row.intake_status);
  assert.ok(!("verified" in payload));
});

test("an empty string counts as nothing, not as a curated value", () => {
  const row = toOrganizationRow(record(), undefined);
  const { payload } = buildUpdatePayload(row, existing({ description: "" }));

  assert.equal(payload.description, row.description);
});

test("a language gap is filled with the English baseline, explicitly unconfirmed", () => {
  const row = toOrganizationRow(record(), undefined);
  const { payload, preserved } = buildUpdatePayload(row, existing());

  assert.ok(!preserved.includes("languages"));
  assert.deepEqual(payload.languages, ["English"]);
  assert.equal(payload.languages_confirmed, false);
});

test("an empty array counts as nothing, same as null, for the language gap", () => {
  const row = toOrganizationRow(record(), undefined);
  const { payload, preserved } = buildUpdatePayload(
    row,
    existing({ languages: [] }),
  );

  assert.ok(!preserved.includes("languages"));
  assert.deepEqual(payload.languages, ["English"]);
  assert.equal(payload.languages_confirmed, false);
});

test("a confirmed language list is never overwritten by the roster baseline", () => {
  const row = toOrganizationRow(record(), undefined);
  const { payload, preserved } = buildUpdatePayload(
    row,
    existing({ languages: ["English", "Spanish"] }),
  );

  assert.ok(preserved.includes("languages"));
  assert.ok(!("languages" in payload));
  assert.ok(!("languages_confirmed" in payload));
});

test("repeat runs against stored rows produce no inserts", () => {
  const records = [
    record(),
    record({ name: "Jewish Family Service of San Diego", street: "8804 Balboa Ave" }),
  ];
  const rows = records.map((value, index) =>
    existing({ id: `row-${index}`, legacy_id: buildNaturalKey(value), name: value.name }),
  );

  const { changes } = planChanges(records, rows);

  assert.ok(changes.every((change) => change.action === "update"));
});

test("new EOIR rows are inserted unverified", () => {
  const row = toOrganizationRow(record(), undefined);
  assert.equal(row.verified, false);
  assert.equal(row.org_type, "NGO");
});

test("new EOIR rows infer an English baseline, explicitly unconfirmed", () => {
  const row = toOrganizationRow(record(), undefined);
  assert.deepEqual(row.languages, ["English"]);
  assert.equal(row.languages_confirmed, false);
});

test("EOIR rows do not carry default service tags", () => {
  const row = toOrganizationRow(record(), undefined);
  assert.ok(!("services" in row));
  assert.ok(!("services_offered" in row));
});

test("pro bono keys use the doj-probono prefix and the same English baseline", () => {
  const row = toProBonoOrganizationRow(
    {
      ...record(),
      courts: ["Eloy Immigration Court", "Florence Immigration Court"],
      website: "www.example.org",
      providerKind: "nonprofit",
    },
    undefined,
  );
  assert.ok(row.legacy_id.startsWith("doj-probono-"));
  assert.deepEqual(row.languages, ["English"]);
  assert.equal(row.languages_confirmed, false);
  assert.equal(row.org_type, "NGO");
  assert.ok(!("services" in row));
  assert.ok(row.catchment_note?.includes("Eloy Immigration Court"));
  assert.ok(row.website_url?.includes("example.org"));
  assert.equal(row.legacy_id, buildNaturalKey(record(), "doj-probono"));
  assert.equal(row.address_role, undefined);
});

test("a mailing-address listing stores the role and a site label does not", () => {
  const mailing = toProBonoOrganizationRow(
    { ...record(), officeLabel: "Mailing Address" },
    undefined,
  );
  const physical = toProBonoOrganizationRow(
    { ...record(), officeLabel: "Physical Address:" },
    undefined,
  );
  const site = toProBonoOrganizationRow(
    { ...record(), officeLabel: "Dallas" },
    undefined,
  );
  assert.equal(mailing.address_role, "mailing");
  assert.equal(physical.address_role, "physical");
  assert.equal(site.address_role, undefined);
});

test("a private-attorney listing maps to Law Firm and still has no service tags", () => {
  const row = toProBonoOrganizationRow(
    { ...record(), providerKind: "private_attorney" },
    undefined,
  );
  assert.equal(row.org_type, "Law Firm");
  assert.equal(row.lat, null);
  assert.equal(row.lng, null);
  assert.ok(!("services" in row));
  assert.match(row.description, /private attorney/);
});

test("a same-batch name fragment at the same address is skipped, keeping the full name", () => {
  const full = record({
    name: "University of Texas School of Law Immigration Clinic",
    street: "727 East Dean Keeton Street",
    city: "Austin",
    state: "TX",
    zip: "78705",
    courts: ["Austin Immigration Court"],
  });
  const fragment = record({
    name: "Immigration Clinic",
    street: "727 East Dean Keeton Street",
    city: "Austin",
    state: "TX",
    zip: "78705",
    courts: ["Pearsall Immigration Court"],
  });

  const { changes, duplicates } = planChanges([fragment, full], [], "doj-probono");
  const inserts = changes.filter((change) => change.action === "insert");
  const skips = changes.filter((change) => change.action === "skip");

  assert.equal(inserts.length, 1);
  assert.equal(
    inserts[0].name,
    "University of Texas School of Law Immigration Clinic",
  );
  assert.equal(skips.length, 1);
  assert.equal(skips[0].name, "Immigration Clinic");
  assert.equal(duplicates.length, 1);
  assert.deepEqual(full.courts?.sort(), [
    "Austin Immigration Court",
    "Pearsall Immigration Court",
  ]);
});

test("a second-source alias on an existing row is an exact update, not a second insert", () => {
  const incoming = record({
    name: "RAICES Texas Legal Services",
    street: "131 Interpark Blvd",
    city: "San Antonio",
    state: "TX",
    zip: "78216",
  });
  const proBonoKey = buildNaturalKey(incoming, "doj-probono");
  const rosterKey =
    "doj-ra-refugee-and-immigrant-center-for-education-and-legal-services-raices-san-antonio-78216-f434850f";

  const { changes, duplicates } = planChanges(
    [incoming],
    [
      existing({
        name: "RAICES San Antonio",
        city: "San Antonio",
        state: "TX",
        address: "131 Interpark Blvd, San Antonio, TX 78216",
        legacy_id: rosterKey,
        sourceKeys: [proBonoKey],
      }),
    ],
    "doj-probono",
  );

  assert.equal(changes.length, 1);
  assert.equal(changes[0].action, "update");
  assert.equal(changes[0].existingId, "row-1");
  assert.equal(duplicates.length, 0);
});

test("an update matched via a second-source key keeps the primary legacy_id", () => {
  const incoming = record({
    name: "RAICES Texas Legal Services",
    street: "131 Interpark Blvd",
    city: "San Antonio",
    state: "TX",
    zip: "78216",
  });
  const row = toProBonoOrganizationRow(incoming, undefined);
  const rosterKey =
    "doj-ra-refugee-and-immigrant-center-for-education-and-legal-services-raices-san-antonio-78216-f434850f";

  const { payload, preserved } = buildUpdatePayload(
    row,
    existing({
      name: "RAICES San Antonio",
      description: "Statewide immigration legal services nonprofit with a major San Antonio office.",
      pricing: "Pro bono",
      intake_status: "LIMITED",
      legacy_id: rosterKey,
      sourceKeys: [row.legacy_id],
    }),
  );

  assert.equal(payload.legacy_id, rosterKey);
  assert.ok(preserved.includes("legacy_id"));
  assert.ok(preserved.includes("name"));
  assert.ok(preserved.includes("verified"));
});

test("two different organizations at the same address are both inserted", () => {
  const { changes } = planChanges(
    [
      record({ name: "Alpha Legal Aid", street: "100 Main Street" }),
      record({ name: "Beta Defenders", street: "100 Main Street" }),
    ],
    [],
  );

  assert.equal(changes.filter((change) => change.action === "insert").length, 2);
});

test("the same organization at two different addresses in one city both insert", () => {
  const { changes } = planChanges(
    [
      record({
        name: "UNLV Immigration Clinic",
        street: "1212 Casino Center Blvd.",
        city: "Las Vegas",
        state: "NV",
        zip: "89104",
      }),
      record({
        name: "UNLV Immigration Clinic",
        street: "P.O. Box 71075",
        city: "Las Vegas",
        state: "NV",
        zip: "89170",
      }),
    ],
    [],
    "doj-probono",
  );

  assert.equal(changes.filter((change) => change.action === "insert").length, 2);
});
