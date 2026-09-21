import assert from "node:assert/strict";
import test from "node:test";

import {
  jsonWithCache,
  MAP_ORGANIZATIONS_CACHE_CONTROL,
  OFFICIAL_DATA_CACHE_CONTROL,
} from "./api-cache";

test("map catalog Cache-Control is shorter than official data", () => {
  assert.match(MAP_ORGANIZATIONS_CACHE_CONTROL, /s-maxage=600/);
  assert.match(OFFICIAL_DATA_CACHE_CONTROL, /s-maxage=86400/);
});

test("jsonWithCache uses the map TTL when cacheControl is passed", async () => {
  const response = jsonWithCache(
    { services: [] },
    { cacheControl: MAP_ORGANIZATIONS_CACHE_CONTROL },
  );
  assert.equal(
    response.headers.get("Cache-Control"),
    MAP_ORGANIZATIONS_CACHE_CONTROL,
  );
  const body = (await response.json()) as { services: unknown[] };
  assert.deepEqual(body.services, []);
});
