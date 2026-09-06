import assert from "node:assert/strict";
import test from "node:test";

import { DuplicateMatcher, brandIdentityTokens, namesIndicateSameOffice, parentheticalAcronyms, zipFromAddress, zipFromNaturalKey } from "./match";
import type { MatchCandidate } from "./match";

/**
 * Names standing in for the roster population, so the rarity weighting sees
 * "immigration", "legal", "services" and "center" as the common words they
 * are. Every case below is drawn from the real Sacramento overlap.
 */
const CORPUS = [
  "Asian Resources, Inc.",
  "CAIR-CA",
  "California Immigration Project (CIP)",
  "California Rural Legal Assistance Foundation (CRLAF)",
  "Catholic Charities of Sacramento, Inc.",
  "Coalition for Humane Immigrant Rights (CHIRLA)",
  "Community Justice Alliance Inc.",
  "International Rescue Committee, Inc.",
  "Opening Doors, Inc.",
  "VALORUS",
  "World Relief",
  "Central American Resource Center (CARECEN) of Northern California",
  "Central California Legal Services",
  "Centro La Familia Advocacy Services, Inc.",
  "Casa Familiar Inc.",
  "Asian Pacific Islander Legal Outreach",
  "Oasis Legal Services",
  "Community Legal Services in East Palo Alto",
  "University of California Immigrant Legal Services",
  "Immigration Center for Women and Children",
  "Immigrant Legal Defense",
  "Immigrant Legal Resource Center",
  "Legal Aid Immigration Services",
  "Catholic Charities Immigration Legal Services",
  "Jewish Family Service Immigration Legal Center",
  "Immigration Institute of the Bay Area",
  "Legal Services for Children",
  "Immigration Legal Center of the Central Coast",
  "Los Angeles LGBT Center - Immigration Law Project",
  "Libreria Del Pueblo, Inc. Immigration and Citizenship Project",
  "Loyola Immigrant Justice Clinic at Loyola Law School",
  "Public Law Center",
  "Legal Services of Eastern Missouri, Inc.",
  "Legal Services of the Hudson Valley",
  "The Fresno Center",
  "Pacific Gateway Center",
  "Refugee and Immigrant Center for Education and Legal Services",
  "Immigration Law Clinic",
  "Family Immigration Services Center",
  "Northwest Immigrant Rights Project",
];

function candidate(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    id: "row-1",
    name: "Opening Doors, Inc.",
    city: "Sacramento",
    state: "CA",
    zip: "95825",
    ...overrides,
  };
}

function matcherFor(...candidates: MatchCandidate[]) {
  return new DuplicateMatcher(CORPUS, candidates);
}

test("an identical name and city is matched", () => {
  const matches = matcherFor(
    candidate({ name: "Asian Resources, Inc.", zip: "95824" }),
  ).findMatches({
    name: "Asian Resources, Inc.",
    city: "Sacramento",
    state: "CA",
    zip: "95824",
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].candidate.id, "row-1");
});

test("an acronym EOIR appends does not hide the match", () => {
  const matches = matcherFor(
    candidate({ name: "California Immigration Project", zip: "95816" }),
  ).findMatches({
    name: "California Immigration Project (CIP)",
    city: "Sacramento",
    state: "CA",
    zip: "95816",
  });

  assert.equal(matches.length, 1);
});

test("a city qualifier in the stored name does not hide the match", () => {
  const matches = matcherFor(
    candidate({
      name: "Coalition for Humane Immigrant Rights (CHIRLA) Sacramento",
      zip: "95814",
    }),
  ).findMatches({
    name: "Coalition for Humane Immigrant Rights (CHIRLA)",
    city: "Sacramento",
    state: "CA",
    zip: "95814",
  });

  assert.equal(matches.length, 1);
  assert.ok(matches[0].matchedOn.includes("chirla"));
  assert.ok(
    !matches[0].matchedOn.includes("sacramento"),
    "the city name is not evidence",
  );
});

test("a differing city label is tolerated when the ZIP agrees", () => {
  const matches = matcherFor(
    candidate({
      name: "International Rescue Committee in Sacramento",
      city: "Arden-Arcade",
      zip: "95825",
    }),
  ).findMatches({
    name: "International Rescue Committee, Inc.",
    city: "Sacramento",
    state: "CA",
    zip: "95825",
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].sameZip, true);
});

test("a partial name overlap is accepted once the ZIP corroborates it", () => {
  const matches = matcherFor(
    candidate({ name: "CAIR California Sacramento Valley", zip: "95814" }),
  ).findMatches({
    name: "CAIR-CA",
    city: "Sacramento",
    state: "CA",
    zip: "95814",
  });

  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0].matchedOn, ["cair"]);
});

test("another office of the same organization is left alone", () => {
  const matches = matcherFor(
    candidate({
      name: "California Rural Legal Assistance Foundation",
      city: "Sacramento",
      zip: "95816",
    }),
  ).findMatches({
    name: "California Rural Legal Assistance Foundation (CRLAF)",
    city: "Fresno",
    state: "CA",
    zip: "93727",
  });

  assert.equal(matches.length, 0);
});

test("sharing only a common word is not a match", () => {
  const matches = matcherFor(
    candidate({ name: "KILO Immigration", zip: "95816" }),
  ).findMatches({
    name: "California Immigration Project (CIP)",
    city: "Sacramento",
    state: "CA",
    zip: "95816",
  });

  assert.equal(matches.length, 0);
});

test("sharing only the city name is not a match", () => {
  const matches = matcherFor(
    candidate({ name: "Sacramento Food Bank & Family Services", zip: "95838" }),
  ).findMatches({
    name: "Catholic Charities of Sacramento, Inc.",
    city: "Sacramento",
    state: "CA",
    zip: "95838",
  });

  assert.equal(matches.length, 0);
});

test("a genuinely new provider in a covered city is not flagged", () => {
  const matches = matcherFor(
    candidate({ name: "WEAVE Legal Services", zip: "95811" }),
    candidate({ id: "row-2", name: "McGeorge School of Law Immigration Clinic", zip: "95817" }),
  ).findMatches({
    name: "Community Justice Alliance Inc.",
    city: "Sacramento",
    state: "CA",
    zip: "95811",
  });

  assert.equal(matches.length, 0);
});

test("a same-named provider in another state is not matched", () => {
  const matches = matcherFor(
    candidate({ name: "World Relief", city: "Sacramento", state: "CA", zip: "95825" }),
  ).findMatches({
    name: "World Relief",
    city: "Sacramento",
    state: "KY",
    zip: "95825",
  });

  assert.equal(matches.length, 0);
});

test("every key-less lookalike is reported, not just the first", () => {
  const matches = matcherFor(
    candidate({ id: "row-1", name: "World Relief Sacramento", zip: "95825" }),
    candidate({ id: "row-2", name: "World Relief", zip: "95825" }),
  ).findMatches({
    name: "World Relief",
    city: "Sacramento",
    state: "CA",
    zip: "95825",
  });

  assert.equal(matches.length, 2);
});

test("ZIP is read from the end of a free-text address", () => {
  assert.equal(
    zipFromAddress("2020 Hurley Way, Suite 420, Arden-Arcade, CA 95825"),
    "95825",
  );
  // A leading street number must not be mistaken for the ZIP.
  assert.equal(zipFromAddress("95825 Main Street, Davis, CA 95616"), "95616");
  assert.equal(zipFromAddress(null), null);
});

test("ZIP is read back out of a natural key", () => {
  assert.equal(
    zipFromNaturalKey("doj-ra-opening-doors-inc-sacramento-95825-3cb3ae79"),
    "95825",
  );
  assert.equal(zipFromNaturalKey("doj-ra-opening-doors-inc-sacramento"), null);
});

test("a wrapped-name fragment is recognized as the same office as the full name", () => {
  assert.equal(
    namesIndicateSameOffice(
      "Immigration Clinic",
      "University of Texas School of Law Immigration Clinic",
    ),
    true,
  );
  assert.equal(
    namesIndicateSameOffice(
      "Inc. (AMFIS)",
      "American Military Families Immigration Services, Inc. (AMFIS)",
    ),
    true,
  );
  assert.equal(
    namesIndicateSameOffice(
      "Immigration Services",
      "Immigration Center for Women and Children",
    ),
    false,
  );
});

test("parenthetical acronyms ignore place names, prose, and state codes", () => {
  assert.deepEqual(
    [...parentheticalAcronyms(
      "Refugee and Immigrant Center for Education and Legal Services (RAICES)",
    )],
    ["raices"],
  );
  assert.deepEqual(
    [...parentheticalAcronyms("California Immigration Project (CIP)")],
    ["cip"],
  );
  const cairCa = parentheticalAcronyms("CAIR California (CAIR-CA)");
  assert.ok(cairCa.has("cair"));
  assert.ok(cairCa.has("cair-ca"));
  assert.equal(parentheticalAcronyms("HIAS (Silver Spring)").size, 0);
  assert.equal(parentheticalAcronyms("CAIR (formerly CAIR-CA)").size, 0);
  assert.equal(parentheticalAcronyms("Something (CA)").size, 0);
});

test("an acronym-plus-city curated name matches the spelled-out legal name", () => {
  // Overlap score is only raices / (raices + san + antonio) ≈ 0.30 — below
  // both thresholds. The parenthetical acronym is an independent signal.
  const curated = "RAICES San Antonio";
  const legal =
    "Refugee and Immigrant Center for Education and Legal Services (RAICES)";
  assert.equal(namesIndicateSameOffice(curated, legal), false);

  const matches = matcherFor(
    candidate({
      name: curated,
      city: "San Antonio",
      state: "TX",
      zip: "78216",
    }),
  ).findMatches({
    name: legal,
    city: "San Antonio",
    state: "TX",
    zip: "78216",
  });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].via, "acronym");
  assert.ok(matches[0].matchedOn.includes("raices"));
  assert.ok(matches[0].score < 0.45);
});

test("an acronym-plus-city name still matches when a program-of suffix remains", () => {
  const matches = matcherFor(
    candidate({
      name: "HIAS New York Legal Services",
      city: "New York",
      state: "NY",
      zip: "10001",
    }),
  ).findMatches({
    name: "Hebrew Immigrant Aid Society (HIAS)",
    city: "New York",
    state: "NY",
    zip: "10018",
  });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].via, "acronym");
  assert.ok(matches[0].matchedOn.includes("hias"));
  assert.ok(matches[0].score < 0.45);
});

test("the acronym signal does not require a ZIP agreement", () => {
  const matches = matcherFor(
    candidate({
      name: "RAICES San Antonio",
      city: "San Antonio",
      state: "TX",
      zip: "78216",
    }),
  ).findMatches({
    name: "Refugee and Immigrant Center for Education and Legal Services (RAICES)",
    city: "San Antonio",
    state: "TX",
    zip: "78278",
  });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].via, "acronym");
  assert.equal(matches[0].sameZip, false);
});

test("a multi-token brand is not collapsed to a parenthetical acronym", () => {
  const matches = matcherFor(
    candidate({
      name: "Casa de Esperanza",
      city: "Sacramento",
      zip: "95811",
    }),
  ).findMatches({
    name: "Community Action Services Agency (CASA)",
    city: "Sacramento",
    state: "CA",
    zip: "95825",
  });
  assert.equal(matches.length, 0);
});

test("brand residue keeps a short acronym after stripping city and program-of words", () => {
  assert.deepEqual(
    [...brandIdentityTokens("RAICES San Antonio", "San Antonio")].sort(),
    ["raices"],
  );
  assert.ok(
    brandIdentityTokens(
      "RAICES Texas Legal Services",
      "San Antonio",
    ).has("raices"),
  );
});

test("a ZIP-corroborated generic overlap is still not a match", () => {
  // The original 9-pair review's CRLA / Legal Services of Northern California
  // near-miss. Shared tokens are common words; the acronym path must not
  // rescue this, and the overlap thresholds must stay where they are.
  const matches = matcherFor(
    candidate({
      name: "Legal Services of Northern California",
      city: "Sacramento",
      zip: "95814",
    }),
  ).findMatches({
    name: "California Rural Legal Assistance Foundation (CRLAF)",
    city: "Sacramento",
    state: "CA",
    zip: "95814",
  });
  assert.equal(matches.length, 0);
});
