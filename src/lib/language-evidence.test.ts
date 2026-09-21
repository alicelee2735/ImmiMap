import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeOrganizationLanguages,
  parseLanguageEvidence,
  pickBestLanguageEvidence,
  splitLanguagesForDisplay,
} from "./language-evidence";

test("parseLanguageEvidence drops English and malformed rows", () => {
  const parsed = parseLanguageEvidence([
    {
      language: "English",
      sourceUrl: "https://example.org/",
      snippet: "hreflang switcher (en, es)",
      kind: "hreflang-switcher",
    },
    {
      language: "Spanish",
      sourceUrl: "https://example.org/",
      snippet: "We offer services in Spanish",
      kind: "offering-phrase",
    },
    { language: "French", sourceUrl: "", snippet: "x", kind: "language-list" },
    { language: "Korean", sourceUrl: "https://example.org/", kind: "nope" },
  ]);
  assert.deepEqual(
    parsed.map((item) => item.language),
    ["Spanish"],
  );
});

test("pickBestLanguageEvidence keeps one stronger trail per language", () => {
  const picked = pickBestLanguageEvidence([
    {
      language: "Spanish",
      sourceUrl: "https://example.org/",
      snippet: "hreflang switcher (es)",
      kind: "hreflang-switcher",
    },
    {
      language: "Spanish",
      sourceUrl: "https://example.org/about",
      snippet: "Attorney Maria offers services in Spanish",
      kind: "staff-bio",
    },
    {
      language: "Arabic",
      sourceUrl: "https://example.org/",
      snippet: "Languages: Arabic",
      kind: "language-list",
    },
  ]);
  assert.equal(picked.length, 2);
  assert.equal(picked[0]?.language, "Arabic");
  assert.equal(picked[1]?.kind, "staff-bio");
});

test("splitLanguagesForDisplay keeps assumed English next to confirmed Spanish", () => {
  const split = splitLanguagesForDisplay(
    ["English", "Spanish"],
    true,
    [
      {
        language: "Spanish",
        sourceUrl: "https://example.org/",
        snippet: "Languages: Spanish",
        kind: "language-list",
      },
    ],
  );
  assert.deepEqual(split.confirmed, ["Spanish"]);
  assert.deepEqual(split.assumed, ["English"]);
});

test("splitLanguagesForDisplay leaves the 547 assumed-English rows unchanged", () => {
  const split = splitLanguagesForDisplay(["English"], false, undefined);
  assert.deepEqual(split.confirmed, []);
  assert.deepEqual(split.assumed, ["English"]);
});

test("splitLanguagesForDisplay treats legacy confirmed lists as fully confirmed", () => {
  const split = splitLanguagesForDisplay(["English", "Spanish"], true, undefined);
  assert.deepEqual(split.confirmed, ["English", "Spanish"]);
  assert.deepEqual(split.assumed, []);
});

test("mergeOrganizationLanguages keeps English first and does not invent it", () => {
  assert.deepEqual(mergeOrganizationLanguages(["English"], ["Spanish", "Arabic"]), [
    "English",
    "Arabic",
    "Spanish",
  ]);
  assert.deepEqual(mergeOrganizationLanguages([], ["Spanish"]), ["Spanish"]);
});
