import assert from "node:assert/strict";
import test from "node:test";

import {
  collectServiceTypes,
  filterServices,
  toggleOptInSelection,
} from "./map-filters";
import type { ImmigrationService } from "../types/immimap";

const ALL_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DC", "DE", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO",
  "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
] as ImmigrationService["state"][];

function org(id: string, offerings: string[]): ImmigrationService {
  return {
    id,
    name: id,
    type: "NGO",
    state: "NC",
    address: "1 Main St",
    latitude: 0,
    longitude: 0,
    pricing: "Pro bono",
    services_offered: offerings as ImmigrationService["services_offered"],
    thumbnail_image_url: "",
  };
}

test("collectServiceTypes returns the distinct tags from loaded rows", () => {
  const types = collectServiceTypes([
    org("a", ["Removal Defense", "Asylum"]),
    org("b", ["Family", "Asylum"]),
    org("c", ["Citizenship", "TPS"]),
  ]);
  assert.deepEqual(types, [
    "Asylum",
    "Citizenship",
    "Family",
    "Removal Defense",
    "TPS",
  ]);
});

test("collectServiceTypes picks up a new tag without a hardcoded list", () => {
  const types = collectServiceTypes([
    org("a", ["Asylum", "Naturalization"]),
  ]);
  assert.ok((types as readonly string[]).includes("Naturalization"));
  assert.ok(types.includes("Asylum"));
});

test("filterServices matches the live tag name, including Removal Defense", () => {
  const rows = [
    org("defense", ["Removal Defense", "Family"]),
    org("asylum-only", ["Asylum"]),
  ];
  const availableServiceTypes = collectServiceTypes(rows);
  const filtered = filterServices(rows, {
    states: ALL_STATES,
    categories: ["Removal Defense"],
    availableServiceTypes,
    pricingTiers: ["pro_bono", "low_cost", "paid"],
    languages: [],
  });
  assert.deepEqual(
    filtered.map((row) => row.id),
    ["defense"],
  );
});

test("toggleOptInSelection starts at All (empty) and first click replaces All", () => {
  assert.deepEqual(toggleOptInSelection([], "Asylum"), ["Asylum"]);
});

test("toggleOptInSelection adds further specific items", () => {
  assert.deepEqual(toggleOptInSelection(["Asylum"], "Family"), [
    "Asylum",
    "Family",
  ]);
});

test("toggleOptInSelection removing the last item returns to All", () => {
  assert.deepEqual(toggleOptInSelection(["Asylum"], "Asylum"), []);
});

test("filterServices keeps unknown pricing when every tier is selected", () => {
  const unknown = { ...org("unknown", ["Asylum"]), pricing: undefined };
  const rows = [org("pro-bono", ["Asylum"]), unknown];
  const filtered = filterServices(rows, {
    states: ALL_STATES,
    categories: [],
    availableServiceTypes: collectServiceTypes(rows),
    pricingTiers: ["pro_bono", "low_cost", "paid"],
    languages: [],
  });
  assert.deepEqual(
    filtered.map((row) => row.id),
    ["pro-bono", "unknown"],
  );
});

test("filterServices excludes unknown pricing when a specific tier is on", () => {
  const unknown = { ...org("unknown", ["Asylum"]), pricing: undefined };
  const lowCost = { ...org("low", ["Asylum"]), pricing: "Low-cost" as const };
  const rows = [org("pro-bono", ["Asylum"]), unknown, lowCost];
  const filtered = filterServices(rows, {
    states: ALL_STATES,
    categories: [],
    availableServiceTypes: collectServiceTypes(rows),
    pricingTiers: ["low_cost"],
    languages: [],
  });
  assert.deepEqual(
    filtered.map((row) => row.id),
    ["low"],
  );
});
