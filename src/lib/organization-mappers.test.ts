import assert from "node:assert/strict";
import test from "node:test";

import {
  organizationToImmigrationService,
  parsePricingLabel,
  parseWebsiteScope,
  toMapImmigrationService,
  type MappableOrganization,
} from "./organization-mappers";

function org(
  overrides: Partial<MappableOrganization> &
    Pick<MappableOrganization, "website_url" | "website_scope">,
): MappableOrganization {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Test Org",
    city: "Oakland",
    state: "CA",
    lat: 37.8,
    lng: -122.27,
    address: "1 Main St, Oakland, CA",
    services: [{ id: "svc-1", name: "Asylum" }],
    ...overrides,
  };
}

test("parseWebsiteScope keeps local, parent, and unclassified", () => {
  assert.equal(parseWebsiteScope("local"), "local");
  assert.equal(parseWebsiteScope("parent"), "parent");
  assert.equal(parseWebsiteScope(null), null);
  assert.equal(parseWebsiteScope(undefined), null);
  assert.equal(parseWebsiteScope("hq"), null);
});

test("detail mapper returns website_url and website_scope for a local-tier org", () => {
  const mapped = organizationToImmigrationService(
    org({
      name: "Centro Legal de la Raza",
      website_url: "https://centrolegal.org",
      website_scope: "local",
    }),
  );
  assert.ok(mapped);
  assert.equal(mapped.website, "https://centrolegal.org/");
  assert.equal(mapped.websiteScope, "local");
});

test("detail mapper returns website_url and website_scope for a parent-tier org", () => {
  const mapped = organizationToImmigrationService(
    org({
      name: "Catholic Legal Immigration Network, Inc.",
      website_url: "https://cliniclegal.org",
      website_scope: "parent",
    }),
  );
  assert.ok(mapped);
  assert.equal(mapped.website, "https://cliniclegal.org/");
  assert.equal(mapped.websiteScope, "parent");
});

test("detail JSON payload keeps website_url and website_scope for both tiers", () => {
  const localRow = {
    id: "local-id",
    website_url: "https://centrolegal.org",
    website_scope: "local" as const,
  };
  const parentRow = {
    id: "parent-id",
    website_url: "https://cliniclegal.org",
    website_scope: "parent" as const,
  };
  const localJson = JSON.parse(JSON.stringify({ organization: localRow })) as {
    organization: { website_url: string; website_scope: string };
  };
  const parentJson = JSON.parse(JSON.stringify({ organization: parentRow })) as {
    organization: { website_url: string; website_scope: string };
  };
  assert.equal(localJson.organization.website_url, "https://centrolegal.org");
  assert.equal(localJson.organization.website_scope, "local");
  assert.equal(parentJson.organization.website_url, "https://cliniclegal.org");
  assert.equal(parentJson.organization.website_scope, "parent");
});

test("slim map mapper omits detail-sheet website and description fields", () => {
  const mapped = toMapImmigrationService(
    org({
      website_url: "https://cliniclegal.org",
      website_scope: "parent",
      description: "National network of legal programs.",
      catchment_note: "Nationwide",
      intake_status: "OPEN",
      languages_evidence: [
        {
          language: "Spanish",
          sourceUrl: "https://cliniclegal.org/",
          snippet: "Languages: Spanish",
          kind: "language-list",
        },
      ],
    }),
  );
  assert.ok(mapped);
  assert.equal(mapped.dbId, "11111111-1111-1111-1111-111111111111");
  assert.equal(mapped.website, undefined);
  assert.equal(mapped.websiteScope, undefined);
  assert.equal(mapped.description, undefined);
  assert.equal(mapped.catchmentNote, undefined);
  assert.equal(mapped.intakeStatus, undefined);
  assert.equal(mapped.languagesEvidence, undefined);
  assert.equal("website" in mapped, false);
  assert.equal("websiteScope" in mapped, false);
  assert.equal("description" in mapped, false);
  assert.equal("languagesEvidence" in mapped, false);
});

test("parsePricingLabel keeps only the three confirmed labels", () => {
  assert.equal(parsePricingLabel("Pro bono"), "Pro bono");
  assert.equal(parsePricingLabel("Low-cost"), "Low-cost");
  assert.equal(parsePricingLabel("Paid"), "Paid");
  assert.equal(parsePricingLabel(null), undefined);
  assert.equal(parsePricingLabel(undefined), undefined);
  assert.equal(parsePricingLabel(""), undefined);
  assert.equal(parsePricingLabel("  "), undefined);
  assert.equal(parsePricingLabel("cheap"), undefined);
});

test("null pricing stays unknown instead of defaulting to Low-cost", () => {
  const detail = organizationToImmigrationService(
    org({
      website_url: "https://example.org",
      website_scope: "local",
      pricing: undefined,
    }),
  );
  const slim = toMapImmigrationService(
    org({
      website_url: "https://example.org",
      website_scope: "local",
      pricing: undefined,
    }),
  );
  assert.ok(detail);
  assert.ok(slim);
  assert.equal(detail.pricing, undefined);
  assert.equal(slim.pricing, undefined);
  assert.equal("pricing" in detail, false);
  assert.equal("pricing" in slim, false);
});

test("stored Low-cost is preserved as a confirmed label", () => {
  const mapped = organizationToImmigrationService(
    org({
      website_url: "https://example.org",
      website_scope: "local",
      pricing: "Low-cost",
    }),
  );
  assert.ok(mapped);
  assert.equal(mapped.pricing, "Low-cost");
});

test("detail mapper returns website-confirmed language evidence and omits English", () => {
  const mapped = organizationToImmigrationService(
    org({
      website_url: "https://example.org",
      website_scope: "local",
      languages: ["English", "Spanish"],
      languages_confirmed: true,
      languages_evidence: [
        {
          language: "English",
          sourceUrl: "https://example.org/",
          snippet: "hreflang switcher (en, es)",
          kind: "hreflang-switcher",
        },
        {
          language: "Spanish",
          sourceUrl: "https://example.org/",
          snippet: "Languages: Spanish",
          kind: "language-list",
        },
      ],
    }),
  );
  assert.ok(mapped);
  assert.deepEqual(
    mapped.languagesEvidence?.map((item) => item.language),
    ["Spanish"],
  );
});
