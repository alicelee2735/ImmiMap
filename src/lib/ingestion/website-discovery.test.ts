import assert from "node:assert/strict";
import test from "node:test";

import { chooseWebsiteMatch, domainCoveredByName, nameParts, sanitizeDiscoveredWebsiteUrl } from "./website-discovery";

test("Centro Legal domain is covered by its own name tokens", () => {
  const parts = nameParts({ name: "Centro Legal de la Raza", city: "Oakland" });
  assert.equal(domainCoveredByName("centrolegal", parts.all), true);
});

test("SERP leftover semicolon is stripped from host and path", () => {
  assert.equal(
    sanitizeDiscoveredWebsiteUrl("http://www.lupenet.org;"),
    "https://www.lupenet.org",
  );
  assert.equal(
    sanitizeDiscoveredWebsiteUrl("https://hicaalabama.org/en/home;"),
    "https://hicaalabama.org/en/home",
  );
  assert.equal(
    sanitizeDiscoveredWebsiteUrl("http://instituteforchildrensaid.org;"),
    "https://instituteforchildrensaid.org",
  );
  assert.equal(
    sanitizeDiscoveredWebsiteUrl("https://www.lupenet.org;/"),
    "https://www.lupenet.org",
  );
});

test("truncated one-letter TLD and HTML-glued SERP URLs are rejected", () => {
  assert.equal(sanitizeDiscoveredWebsiteUrl("http://www.catholiccharitiesdc.o"), null);
  assert.equal(sanitizeDiscoveredWebsiteUrl("http://www.somoshispanasunidas.o"), null);
  assert.equal(sanitizeDiscoveredWebsiteUrl('https://www&nbsp;..."'), null);
});

test("HTML-entity glue after a real host is cut, not written", () => {
  assert.equal(
    sanitizeDiscoveredWebsiteUrl('http://www.firclaw.org&nbsp;..."'),
    "https://www.firclaw.org",
  );
});

test("a .co TLD is a real TLD and is not rejected as truncated", () => {
  assert.equal(
    sanitizeDiscoveredWebsiteUrl("https://vanessasocialservices.co/"),
    "https://vanessasocialservices.co",
  );
});

test("a semicolon-glued host still scores as the clean domain", () => {
  const verdict = chooseWebsiteMatch(
    { name: "La Union del Pueblo Entero", city: "San Benito", state: "TX" },
    [
      {
        title: "LUPE | La Union del Pueblo Entero",
        url: "http://www.lupenet.org;",
      },
    ],
  );
  assert.equal(verdict.candidate?.host, "lupenet.org");
});

test("a truncated TLD loses to the clean same-org alternative", () => {
  const verdict = chooseWebsiteMatch(
    {
      name: "Catholic Charities of the Archdiocese of Washington",
      city: "Washington",
      state: "DC",
    },
    [
      {
        title: "Catholic Charities of the Archdiocese of Washington",
        url: "http://www.catholiccharitiesdc.o",
      },
      {
        title: "Catholic Charities DC an Independent Social Services Agency",
        url: "https://www.catholiccharitiesdc.org",
      },
    ],
  );
  assert.equal(verdict.tier, "high");
  assert.equal(verdict.candidate?.host, "catholiccharitiesdc.org");
});

test("a close domain/title match is high confidence", () => {
  const verdict = chooseWebsiteMatch(
    { name: "Centro Legal de la Raza", city: "Oakland", state: "CA" },
    [
      {
        title: "Centro Legal de la Raza",
        url: "https://www.centrolegal.org/",
        snippet: "Immigration legal services in Oakland",
      },
      {
        title: "Centro Legal de la Raza | Immigration Advocates",
        url: "https://www.immigrationadvocates.org/legaldirectory/organization.123",
        snippet: "Directory listing",
      },
    ],
  );
  assert.equal(verdict.tier, "high");
  assert.equal(verdict.candidate?.host, "centrolegal.org");
  assert.equal(verdict.websiteScope, "local");
});

test("HIAS acronym domain is high confidence", () => {
  const verdict = chooseWebsiteMatch(
    { name: "HIAS", city: "New York", state: "NY" },
    [{ title: "HIAS", url: "https://www.hias.org/", snippet: "Welcome to HIAS" }],
  );
  assert.equal(verdict.tier, "high");
  assert.equal(verdict.candidate?.host, "hias.org");
  assert.equal(verdict.websiteScope, "parent");
});

test("IIBA acronym-plus-place domain is high confidence", () => {
  const verdict = chooseWebsiteMatch(
    { name: "Immigration Institute of the Bay Area", city: "San Francisco", state: "CA" },
    [
      {
        title: "Immigration Institute of the Bay Area",
        url: "https://iibayarea.org/",
        snippet: "San Francisco legal services",
      },
    ],
  );
  assert.equal(verdict.tier, "high");
  assert.equal(verdict.candidate?.host, "iibayarea.org");
});

test("short acronym domain still high when the title is the full name", () => {
  const verdict = chooseWebsiteMatch(
    { name: "Brooklyn Defender Services", city: "Brooklyn", state: "NY" },
    [
      {
        title: "Brooklyn Defender Services",
        url: "https://bds.org/",
        snippet: "Public defense in Brooklyn",
      },
    ],
  );
  assert.equal(verdict.tier, "high");
  assert.equal(verdict.candidate?.host, "bds.org");
  assert.equal(verdict.websiteScope, "local");
});

test("directory listings are never high confidence", () => {
  const verdict = chooseWebsiteMatch(
    { name: "Centro Legal de la Raza", city: "Oakland", state: "CA" },
    [
      {
        title: "Centro Legal de la Raza",
        url: "https://www.immigrationadvocates.org/nonprofit/123",
        snippet: "Oakland",
      },
      {
        title: "Recognized Organizations | DOJ",
        url: "https://www.justice.gov/eoir/recognized-organizations",
        snippet: "Centro Legal de la Raza Oakland",
      },
    ],
  );
  assert.equal(verdict.tier, "low");
  assert.equal(verdict.candidate, null);
});

test("a national generic domain is not high for a local Catholic Charities office", () => {
  const verdict = chooseWebsiteMatch(
    { name: "Catholic Charities of Santa Clara County", city: "San Jose", state: "CA" },
    [
      {
        title: "Catholic Charities USA",
        url: "https://www.catholiccharitiesusa.org/",
        snippet: "National office",
      },
    ],
  );
  assert.equal(verdict.tier, "low");
});

test("two close first-party hosts stay low as ambiguous", () => {
  const verdict = chooseWebsiteMatch(
    { name: "Casa Cornelia Law Center", city: "San Diego", state: "CA" },
    [
      {
        title: "Casa Cornelia Law Center",
        url: "https://www.casacornelia.org/",
        snippet: "San Diego",
      },
      {
        title: "Casa Cornelia Law Center — Donate",
        url: "https://www.casacornelialaw.org/",
        snippet: "San Diego immigration legal services",
      },
    ],
  );
  assert.equal(verdict.tier, "low");
  assert.match(verdict.reason, /ambiguous/);
});

test("a one-token domain that is only part of a longer name stays low", () => {
  const verdict = chooseWebsiteMatch(
    { name: "Mercy Center, Inc.", city: "Bronx", state: "NY" },
    [
      {
        title: "Mercy | Hospitals and Clinics",
        url: "https://www.mercy.net/",
        snippet: "Mercy health system",
      },
    ],
  );
  assert.equal(verdict.tier, "low");
});

test("no hits stay low without guessing", () => {
  const verdict = chooseWebsiteMatch(
    { name: "Unknown Aid Society", city: "Boise", state: "ID" },
    [],
  );
  assert.equal(verdict.tier, "low");
  assert.equal(verdict.candidate, null);
});

test("parenthetical acronym plus my- prefix domain is high", () => {
  const verdict = chooseWebsiteMatch(
    {
      name: "Louisiana Organization for Refugees and Immigrants (LORI)",
      city: "Baton Rouge",
      state: "LA",
    },
    [
      {
        title: "Louisiana Organization For Refugees and Immigrants",
        url: "https://www.mylori.org/",
      },
    ],
  );
  assert.equal(verdict.tier, "high");
  assert.equal(verdict.candidate?.host, "mylori.org");
});

test("Spanish article plus remaining initials can match an acronym domain", () => {
  const verdict = chooseWebsiteMatch(
    { name: "La Union del Pueblo Entero", city: "San Juan", state: "TX" },
    [{ title: "Home - LUPE", url: "https://lupenet.org/en/" }],
  );
  assert.equal(verdict.tier, "high");
  assert.equal(verdict.candidate?.host, "lupenet.org");
});

test("homepage title matching the org name on an .org is high", () => {
  const verdict = chooseWebsiteMatch(
    { name: "Catholic Charities of Louisville", city: "Louisville", state: "KY" },
    [
      {
        title: "Helping individuals rebuild, reclaim and rise - Catholic Charities of Louisville",
        url: "https://cclou.org/",
      },
    ],
  );
  assert.equal(verdict.tier, "high");
  assert.equal(verdict.candidate?.host, "cclou.org");
  assert.equal(verdict.websiteScope, "local");
});

test("a national support domain that only ends with the acronym stays low", () => {
  const verdict = chooseWebsiteMatch(
    {
      name: "Kids In Need of Defense (KIND) - Boston Field Office",
      city: "Providence",
      state: "RI",
    },
    [
      {
        title: "United States - KIND",
        url: "https://supportkind.org/united-states/",
      },
    ],
  );
  assert.equal(verdict.tier, "low");
});

test("a dedicated org domain is an office-specific local match", () => {
  const verdict = chooseWebsiteMatch(
    { name: "Immigration Aid Resource Center", city: "Reseda", state: "CA" },
    [{ title: "Home | Immigration Aid Resource Center", url: "https://www.immigrationaidresourcecenter.org/" }],
  );
  assert.equal(verdict.tier, "high");
  assert.equal(verdict.websiteScope, "local");
});

test("World Relief on the national domain is a parent match", () => {
  const verdict = chooseWebsiteMatch(
    { name: "World Relief", city: "Kent", state: "WA" },
    [
      {
        title: "King County - World Relief",
        url: "https://worldrelief.org/western-wa/about-us/king/",
      },
    ],
  );
  assert.equal(verdict.tier, "high");
  assert.equal(verdict.websiteScope, "parent");
  assert.equal(verdict.candidate?.host, "worldrelief.org");
});

test("IRCO locations index is a parent match for a satellite city", () => {
  const verdict = chooseWebsiteMatch(
    { name: "Immigrant and Refugee Community Organization", city: "Vancouver", state: "WA" },
    [{ title: "Locations | IRCO", url: "https://irco.org/locations/" }],
  );
  assert.equal(verdict.tier, "high");
  assert.equal(verdict.websiteScope, "parent");
});

test("HQ city in the org name vs a different row city is a parent match", () => {
  const verdict = chooseWebsiteMatch(
    { name: "Jewish Family Service of San Diego", city: "Oceanside", state: "CA" },
    [{ title: "Locations and Hours - JFSSD", url: "https://www.jfssd.org/about-us/locations/" }],
  );
  assert.equal(verdict.tier, "high");
  assert.equal(verdict.websiteScope, "parent");
});
