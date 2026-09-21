import assert from "node:assert/strict";
import test from "node:test";

import {
  MAP_RESULTS_PAGE_SIZE,
  pagesNeededForIndex,
  paginateResults,
} from "./map-results-page";

test("paginateResults keeps the full total while slicing the page", () => {
  const items = Array.from({ length: 87 }, (_, index) => index);
  const first = paginateResults(items, 1);
  assert.equal(first.total, 87);
  assert.equal(first.items.length, MAP_RESULTS_PAGE_SIZE);
  assert.equal(first.hasMore, true);
  assert.deepEqual(first.items[0], 0);
  assert.deepEqual(first.items.at(-1), 39);

  const second = paginateResults(items, 2);
  assert.equal(second.total, 87);
  assert.equal(second.items.length, 80);
  assert.equal(second.hasMore, true);

  const third = paginateResults(items, 3);
  assert.equal(third.total, 87);
  assert.equal(third.items.length, 87);
  assert.equal(third.hasMore, false);
});

test("pagesNeededForIndex expands to the page that contains a selected pin", () => {
  assert.equal(pagesNeededForIndex(0), 1);
  assert.equal(pagesNeededForIndex(39), 1);
  assert.equal(pagesNeededForIndex(40), 2);
  assert.equal(pagesNeededForIndex(-1), 1);
});
