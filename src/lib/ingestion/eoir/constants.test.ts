import assert from "node:assert/strict";
import test from "node:test";

import {
  organizationSourceFamily,
  organizationSourceLabel,
} from "./constants";

test("svc-seed and keyless rows are the same curated family", () => {
  assert.equal(organizationSourceFamily("svc-ca-sacramento-crla-sacramento"), "curated");
  assert.equal(organizationSourceFamily(null), "curated");
  assert.equal(organizationSourceFamily(undefined), "curated");
  assert.equal(
    organizationSourceFamily("svc-ca-sacramento-crla-sacramento"),
    organizationSourceFamily(null),
  );
});

test("EOIR roster and pro bono keys are not curated", () => {
  assert.equal(
    organizationSourceFamily("doj-ra-centro-legal-de-la-raza-oakland-94601-f1f5557b"),
    "eoir_roster",
  );
  assert.equal(
    organizationSourceFamily("doj-probono-example-org-94102-aaaaaaaa"),
    "eoir_probono",
  );
});

test("display labels still distinguish keyless from svc-seed", () => {
  assert.equal(organizationSourceLabel(null), "curated (keyless)");
  assert.equal(
    organizationSourceLabel("svc-ca-oakland-centro-legal-raza"),
    "curated (svc- seed)",
  );
  assert.equal(
    organizationSourceLabel("doj-ra-centro-legal-de-la-raza-oakland-94601-f1f5557b"),
    "eoir_organizations",
  );
  assert.notEqual(
    organizationSourceLabel("svc-ca-oakland-centro-legal-raza"),
    organizationSourceLabel(null),
  );
});
