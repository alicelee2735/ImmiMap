import assert from "node:assert/strict";
import test from "node:test";

import {
  filterServicesByQuery,
  rankTextMatch,
} from "./search-services";
import type { ImmigrationService } from "../types/immimap";

function org(
  name: string,
  city: string,
  extras: Partial<ImmigrationService> = {},
): ImmigrationService {
  return {
    id: name,
    name,
    type: "NGO",
    state: extras.state ?? "NJ",
    city,
    address: extras.address ?? `1 Main St, ${city}, NJ 07011`,
    latitude: 0,
    longitude: 0,
    services_offered: ["Asylum"],
    thumbnail_image_url: "",
    ...extras,
  };
}

test("rankTextMatch is whole-query prefix, then token prefix, then substring", () => {
  assert.equal(rankTextMatch("Immigrant Hope-Clifton NJ", "immigrant hope"), 0);
  assert.equal(rankTextMatch("Immigrant Hope-Clifton NJ", "clifton"), 1);
  assert.equal(rankTextMatch("Immigrant Hope-Clifton NJ", "hope-clifton"), 2);
  assert.equal(rankTextMatch("Immigrant Hope-Clifton NJ", "immigrant hope clifton"), null);
});

test("hyphen vs space is not rewritten — the query must appear as typed", () => {
  const clifton = org("Immigrant Hope-Clifton NJ", "Clifton");
  assert.equal(filterServicesByQuery([clifton], "Immigrant Hope-Clifton NJ").length, 1);
  assert.equal(filterServicesByQuery([clifton], "Immigrant Hope").length, 1);
  assert.equal(filterServicesByQuery([clifton], "Clifton").length, 1);
  assert.equal(filterServicesByQuery([clifton], "Immigrant Hope Clifton").length, 0);
});

test("name plus city is not AND-matched across fields", () => {
  const richland = org("World Relief", "Richland", {
    state: "WA",
    address: "2600 N. Columbia Center Blvd, Suite 206, Richland, WA 99352",
  });
  assert.equal(filterServicesByQuery([richland], "World Relief").length, 1);
  assert.equal(filterServicesByQuery([richland], "Richland").length, 1);
  assert.equal(filterServicesByQuery([richland], "World Relief Richland").length, 0);
});
