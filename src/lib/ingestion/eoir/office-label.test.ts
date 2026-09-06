import assert from "node:assert/strict";
import test from "node:test";

import {
  isContinuationChrome,
  isOfficeLabelLine,
  addressRoleFromLabel,
  stripContinuationMarker,
} from "./office-label";

test("roster Principal / Extension / Satellite lines are office labels without a colon", () => {
  assert.equal(isOfficeLabelLine("Principal Office"), true);
  assert.equal(isOfficeLabelLine("Montgomery Extension Office"), true);
  assert.equal(
    isOfficeLabelLine("504 West Chapel Hill Street/Durham NC Extension Office"),
    true,
  );
  assert.equal(isOfficeLabelLine("Satellite Office"), true);
});

test("pro bono nested Office: labels and continuation variants classify the same", () => {
  assert.equal(isOfficeLabelLine("San Francisco Office:"), true);
  assert.equal(isOfficeLabelLine("Queens Office:"), true);
  assert.equal(isOfficeLabelLine("Wenatchee Office (cont.):"), true);
  assert.equal(
    isOfficeLabelLine("American Gateways – San Antonio Extension Office:"),
    true,
  );
});

test("mailing / physical address roles are office labels", () => {
  assert.equal(isOfficeLabelLine("Mailing Address:"), true);
  assert.equal(isOfficeLabelLine("Mailing address:"), true);
  assert.equal(isOfficeLabelLine("Physical Address:"), true);
});

test("address-role labels map to physical or mailing, site names do not", () => {
  assert.equal(addressRoleFromLabel("Mailing Address:"), "mailing");
  assert.equal(addressRoleFromLabel("Mailing address"), "mailing");
  assert.equal(addressRoleFromLabel("Physical Address:"), "physical");
  assert.equal(addressRoleFromLabel("Principal Office"), null);
  assert.equal(addressRoleFromLabel("Dallas:"), null);
  assert.equal(addressRoleFromLabel("Queens Office:"), null);
  assert.equal(addressRoleFromLabel(null), null);
});

test("colon-terminated site labels are office labels", () => {
  assert.equal(isOfficeLabelLine("Dallas:"), true);
  assert.equal(isOfficeLabelLine("Fort Worth:"), true);
  assert.equal(isOfficeLabelLine("American Gateways – Austin:"), true);
});

test("contact fields, note headers, and legal names are not office labels", () => {
  assert.equal(isOfficeLabelLine("Tel: (512) 478-0546"), false);
  assert.equal(isOfficeLabelLine("Hotline: (210) 864-2937"), false);
  assert.equal(isOfficeLabelLine("Complete this form:"), false);
  assert.equal(isOfficeLabelLine("Spanish:"), false);
  assert.equal(isOfficeLabelLine("Catholic Migration Services*"), false);
  assert.equal(isOfficeLabelLine("47-01 Queens Blvd., Suite 203"), false);
});

test("continuation chrome strips to an empty or equivalent office label", () => {
  assert.equal(isContinuationChrome("(cont.)"), true);
  assert.equal(
    stripContinuationMarker("The Northwest Immigrant Rights Project* (cont.)"),
    "The Northwest Immigrant Rights Project*",
  );
  assert.equal(
    stripContinuationMarker("Wenatchee Office (cont.):"),
    "Wenatchee Office:",
  );
});
