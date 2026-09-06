import assert from "node:assert/strict";
import test from "node:test";

import {
  consolidateProBonoRecords,
  parseProBono,
} from "./parse-pro-bono";
import type { PdfLine, PdfPage } from "./pdf-text";
import type { EoirOfficeRecord } from "./types";

function run(
  text: string,
  x: number,
  y: number,
  width = Math.max(text.length * 5, 10),
): PdfLine["runs"][number] {
  return { text, x, y, width };
}

function line(
  parts: Array<{ text: string; x: number }>,
  y: number,
  page = 4,
): PdfLine {
  const runs = parts.map((part) => run(part.text, part.x, y));
  return {
    page,
    y,
    runs,
    text: parts.map((part) => part.text).join(" "),
  };
}

function header(page = 4): PdfLine[] {
  return [
    line([{ text: "* Non-Profit Organization", x: 31 }], 774.7, page),
    line([{ text: "Updated July 2026", x: 473 }], 771.8, page),
    line([{ text: "List of Pro Bono Legal Service Providers", x: 164 }], 767.2, page),
    line([{ text: "** Referral Service", x: 31 }], 763.9, page),
    line(
      [
        { text: "*** Private Attorney", x: 31 },
        { text: "http://www.justice.gov/eoir/list-pro-bono-legal-service-providers", x: 146 },
      ],
      753.1,
      page,
    ),
  ];
}

function page(n: number, extra: PdfLine[]): PdfPage {
  const lines = [...header(n), ...extra];
  return { page: n, width: 612, height: 792, lines };
}

test("two-column lines keep left and right organizations separate", () => {
  const parsed = parseProBono([
    page(4, [
      line([{ text: "Eloy Immigration Court", x: 216 }], 734.2),
      line([{ text: "Eloy, Arizona", x: 34 }], 719.6),
      line(
        [
          { text: "ABA Commission on Immigration Detention", x: 34 },
          { text: "Florence Immigrant and Refugee Rights Project*", x: 286 },
        ],
        704.6,
      ),
      line([{ text: "Information Hotline**", x: 34 }], 689.6),
      line([{ text: "P.O. Box 32670", x: 286 }], 674.6),
      line(
        [
          { text: "1050 Connecticut Avenue, NW, Unit 400", x: 34 },
          { text: "Phoenix, AZ 85064", x: 286 },
        ],
        659.6,
      ),
      line(
        [
          { text: "Washington, DC 20036", x: 34 },
          { text: "Tel: (520) 868-0191", x: 286 },
        ],
        644.6,
      ),
      line(
        [
          { text: "immcenter@americanbar.org", x: 34 },
          { text: "firrp@firrp.org", x: 286 },
        ],
        629.6,
      ),
      line(
        [
          { text: "www.americanbar.org/groups/public_interest/", x: 34 },
          { text: "www.firrp.org", x: 286 },
        ],
        614.6,
      ),
      line([{ text: "immigration/", x: 34 }], 599.6),
    ]),
  ]);

  assert.equal(parsed.diagnostics.abandonedBlocks, 0);
  assert.equal(parsed.records.length, 2);

  const aba = parsed.records.find((row) => row.name.startsWith("ABA"));
  const firrp = parsed.records.find((row) => row.name.startsWith("Florence"));
  assert.ok(aba);
  assert.ok(firrp);

  assert.equal(aba.city, "Washington");
  assert.equal(aba.state, "DC");
  assert.equal(aba.zip, "20036");
  assert.equal(aba.street, "1050 Connecticut Avenue, NW, Unit 400");
  assert.equal(aba.providerKind, "referral");
  assert.equal(aba.website, "www.americanbar.org/groups/public_interest/immigration/");
  assert.deepEqual(aba.courts, ["Eloy Immigration Court"]);

  assert.equal(firrp.city, "Phoenix");
  assert.equal(firrp.state, "AZ");
  assert.equal(firrp.zip, "85064");
  assert.equal(firrp.street, "P.O. Box 32670");
  assert.equal(firrp.providerKind, "nonprofit");
  assert.equal(firrp.phone, "(520) 868-0191");
  assert.notEqual(aba.name, firrp.name);
});

test("the same office listed under two courts collapses to one row", () => {
  function listing(pageNumber: number, court: string, courtX: number): PdfPage {
    return page(pageNumber, [
      line([{ text: court, x: courtX }], 734.2, pageNumber),
      line([{ text: "Eloy, Arizona", x: 34 }], 719.6, pageNumber),
      line([{ text: "Florence Immigrant and Refugee Rights Project*", x: 34 }], 704.6, pageNumber),
      line([{ text: "P.O. Box 32670", x: 34 }], 674.6, pageNumber),
      line([{ text: "Phoenix, AZ 85064", x: 34 }], 659.6, pageNumber),
      line([{ text: "Tel: (602) 307-1008", x: 34 }], 644.6, pageNumber),
      line([{ text: "www.firrp.org", x: 34 }], 614.6, pageNumber),
    ]);
  }

  const parsed = parseProBono([
    listing(4, "Eloy Immigration Court", 216),
    listing(5, "Florence Immigration Court", 203),
  ]);

  assert.equal(parsed.diagnostics.appearances, 2);
  assert.equal(parsed.records.length, 1);
  assert.equal(
    parsed.records[0].name,
    "Florence Immigrant and Refugee Rights Project",
  );
  assert.deepEqual(parsed.records[0].courts, [
    "Eloy Immigration Court",
    "Florence Immigration Court",
  ]);
});

test("a nested office label after an address is a second office, not a court duplicate", () => {
  const parsed = parseProBono([
    page(14, [
      line([{ text: "Concord Immigration Court", x: 204 }], 734.2, 14),
      line([{ text: "Concord, California (page 2 of 2)", x: 34 }], 719.6, 14),
      line([{ text: "Kids in Need of Defense (KIND)*", x: 34 }], 704.6, 14),
      line([{ text: "San Francisco Office:", x: 34 }], 674.6, 14),
      line([{ text: "71 Stevenson Street, Suite 1450", x: 34 }], 659.6, 14),
      line([{ text: "San Francisco, CA 94105", x: 34 }], 644.6, 14),
      line([{ text: "Tel: (415) 694-7389", x: 34 }], 629.6, 14),
      line([{ text: "www.supportkind.org", x: 34 }], 584.6, 14),
      line([{ text: "Fresno Office:", x: 34 }], 449.6, 14),
      line([{ text: "550 E. Shaw Avenue, Suite 210", x: 34 }], 434.6, 14),
      line([{ text: "Fresno, CA 93710", x: 34 }], 419.6, 14),
      line([{ text: "Tel: (559) 573-8404", x: 34 }], 404.6, 14),
    ]),
  ]);

  assert.equal(parsed.records.length, 2);
  assert.ok(parsed.records.every((row) => row.name === "Kids in Need of Defense (KIND)"));
  const cities = parsed.records.map((row) => row.city).sort();
  assert.deepEqual(cities, ["Fresno", "San Francisco"]);
  assert.equal(
    parsed.records.find((row) => row.city === "San Francisco")?.officeLabel,
    "San Francisco Office",
  );
});

test("a block that ends without an address is abandoned, not inserted", () => {
  const parsed = parseProBono([
    page(7, [
      line([{ text: "Phoenix Immigration Court", x: 205 }], 734.2, 7),
      line([{ text: "Phoenix, Arizona", x: 34 }], 719.6, 7),
      line([{ text: "Some Org Without An Address*", x: 34 }], 704.6, 7),
      line([{ text: "Tel: (602) 555-0100", x: 34 }], 644.6, 7),
    ]),
  ]);

  assert.equal(parsed.records.length, 0);
  assert.equal(parsed.diagnostics.abandonedBlocks, 1);
  assert.equal(parsed.diagnostics.abandoned[0].name, "Some Org Without An Address");
  assert.equal(parsed.diagnostics.abandoned[0].sourcePage, 7);
  assert.equal(parsed.diagnostics.abandoned[0].reason, "end_of_section");
});

test("table of contents and state divider pages produce no records", () => {
  const parsed = parseProBono([
    page(1, [
      line([{ text: "Table of Contents", x: 226 }], 733.4, 1),
      line([{ text: "ARIZONA", x: 34 }], 719.6, 1),
    ]),
    page(3, [line([{ text: "ARIZONA", x: 233 }], 417, 3)]),
  ]);

  assert.equal(parsed.records.length, 0);
  assert.equal(parsed.diagnostics.abandonedBlocks, 0);
  assert.equal(parsed.diagnostics.reportUpdatedAt, "July 2026");
});

test("a leading-1 hotline and hours are notes, not a new street or abandonment", () => {
  const parsed = parseProBono([
    page(4, [
      line([{ text: "Eloy Immigration Court", x: 216 }], 734.2),
      line([{ text: "Eloy, Arizona", x: 34 }], 719.6),
      line([{ text: "ABA Commission on Immigration Detention", x: 34 }], 704.6),
      line([{ text: "Information Hotline**", x: 34 }], 689.6),
      line([{ text: "1050 Connecticut Avenue, NW, Unit 400", x: 34 }], 659.6),
      line([{ text: "Washington, DC 20036", x: 34 }], 644.6),
      line([{ text: "www.americanbar.org/groups/public_interest/", x: 34 }], 614.6),
      line([{ text: "immigration/", x: 34 }], 599.6),
      line([{ text: "• Pro se case assistance for detained respondents only", x: 34 }], 569.6),
      line([{ text: "1 (855) 641-6081", x: 44 }], 434.6),
    ]),
  ]);

  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.diagnostics.abandonedBlocks, 0);
  assert.equal(
    parsed.records[0].name,
    "ABA Commission on Immigration Detention Information Hotline",
  );
  assert.equal(parsed.records[0].street, "1050 Connecticut Avenue, NW, Unit 400");
});

test("a department line after a marked name becomes the office label", () => {
  const parsed = parseProBono([
    page(11, [
      line([{ text: "Adelanto Immigration Court", x: 201 }], 734.2, 11),
      line([{ text: "Adelanto, California", x: 34 }], 720.1, 11),
      line([{ text: "Esperanza Immigrant Rights Project, Catholic Charities", x: 34 }], 704.6, 11),
      line([{ text: "of Los Angeles, Inc. Main Office*", x: 34 }], 689.6, 11),
      line([{ text: "Catholic Charities of Los Angeles", x: 34 }], 659.6, 11),
      line([{ text: "1530 James M Wood Boulevard", x: 34 }], 644.6, 11),
      line([{ text: "Los Angeles, CA 90015", x: 34 }], 629.6, 11),
      line([{ text: "www.esperanza-la.org", x: 34 }], 584.6, 11),
      line([{ text: "petitions", x: 44 }], 539.6, 11),
    ]),
  ]);

  assert.equal(parsed.records.length, 1);
  assert.equal(
    parsed.records[0].name,
    "Esperanza Immigrant Rights Project, Catholic Charities of Los Angeles, Inc. Main Office",
  );
  assert.equal(parsed.records[0].officeLabel, "Catholic Charities of Los Angeles");
  assert.equal(parsed.records[0].website, "www.esperanza-la.org");
});

test("consolidateProBonoRecords merges courts but keeps distinct addresses", () => {
  const aba = (court: string): EoirOfficeRecord => ({
    name: "ABA Commission on Immigration Detention Information Hotline",
    officeLabel: null,
    street: "1050 Connecticut Avenue, NW, Unit 400",
    city: "Washington",
    state: "DC",
    zip: "20036",
    phone: null,
    dateRecognized: null,
    expirationDate: null,
    status: null,
    pendingRenewal: false,
    sourcePage: 4,
    courts: [court],
    website: "www.americanbar.org/groups/public_interest/immigration/",
    providerKind: "referral",
  });

  const merged = consolidateProBonoRecords([
    aba("Eloy Immigration Court"),
    aba("Florence Immigration Court"),
    {
      ...aba("Adelanto Immigration Court"),
      street: "3845 Selig Place",
      city: "Los Angeles",
      state: "CA",
      zip: "90031",
      name: "International Institute of Los Angeles",
      providerKind: "nonprofit",
      website: "www.iilosangeles.org",
    },
  ]);

  assert.equal(merged.length, 2);
  const abaRow = merged.find((row) => row.name.startsWith("ABA"));
  assert.equal(abaRow?.courts?.length, 2);
});

test("hyphenated house numbers are street lines, not name glue", () => {
  const parsed = parseProBono([
    page(94, [
      line([{ text: "New York Immigration Courts", x: 200 }], 734.2, 94),
      line([{ text: "New York, New York (page 2 of 2)", x: 34 }], 719.6, 94),
      line([{ text: "Catholic Migration Services*", x: 286 }], 524.6, 94),
      line([{ text: "Queens Office:", x: 286 }], 494.6, 94),
      line([{ text: "47-01 Queens Blvd., Suite 203", x: 286 }], 479.6, 94),
      line([{ text: "Sunnyside, NY 11104", x: 286 }], 464.6, 94),
    ]),
  ]);

  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].name, "Catholic Migration Services");
  assert.equal(parsed.records[0].officeLabel, "Queens Office");
  assert.equal(parsed.records[0].street, "47-01 Queens Blvd., Suite 203");
  assert.equal(parsed.records[0].city, "Sunnyside");
  assert.equal(parsed.records[0].zip, "11104");
});

test("mailing and physical address labels bound separate offices of the same org", () => {
  const parsed = parseProBono([
    page(79, [
      line([{ text: "Las Vegas Immigration Court", x: 200 }], 736.0, 79),
      line([{ text: "Las Vegas, Nevada", x: 34 }], 719.8, 79),
      line([{ text: "UNLV Immigration Clinic*", x: 34 }], 704.9, 79),
      line([{ text: "Physical Address:", x: 34 }], 674.8, 79),
      line([{ text: "1212 Casino Center Blvd.", x: 34 }], 659.8, 79),
      line([{ text: "Las Vegas, Nevada 89104", x: 34 }], 644.8, 79),
      line([{ text: "Mailing Address:", x: 34 }], 614.8, 79),
      line([{ text: "P.O. Box 71075", x: 34 }], 599.8, 79),
      line([{ text: "Las Vegas, NV 89170", x: 34 }], 584.8, 79),
    ]),
  ]);

  assert.equal(parsed.records.length, 2);
  assert.ok(parsed.records.every((row) => row.name === "UNLV Immigration Clinic"));
  const physical = parsed.records.find((row) => row.zip === "89104");
  const mailing = parsed.records.find((row) => row.zip === "89170");
  assert.equal(physical?.street, "1212 Casino Center Blvd.");
  assert.equal(physical?.officeLabel, "Physical Address");
  assert.equal(mailing?.street, "P.O. Box 71075");
  assert.equal(mailing?.officeLabel, "Mailing Address");
});

test("continuation headers and nested Office (cont.) labels do not glue onto the name", () => {
  const parsed = parseProBono([
    page(146, [
      line([{ text: "Tacoma Immigration Court", x: 200 }], 734.2, 146),
      line([{ text: "Tacoma, Washington (page 1 of 2)", x: 34 }], 719.6, 146),
      line(
        [
          { text: "The Northwest Immigrant Rights Project*", x: 34 },
          { text: "The Northwest Immigrant Rights Project* (cont.)", x: 286 },
        ],
        704.6,
        146,
      ),
      line(
        [
          { text: "Seattle Office:", x: 34 },
          { text: "Wenatchee Office (cont.):", x: 286 },
        ],
        674.6,
        146,
      ),
      line([{ text: "615 2nd Avenue, Suite 400", x: 34 }], 659.6, 146),
      line([{ text: "Seattle, WA 98104", x: 34 }], 644.6, 146),
      line([{ text: "• Hours: Monday-Friday", x: 286 }], 659.6, 146),
      line([{ text: "Tacoma Office:", x: 286 }], 539.6, 146),
      line([{ text: "2209 N. Pearl Street, Suite 200", x: 286 }], 524.6, 146),
      line([{ text: "Tacoma, WA 98406", x: 286 }], 509.6, 146),
    ]),
  ]);

  const names = parsed.records.map((row) => row.name);
  assert.ok(names.every((name) => name === "The Northwest Immigrant Rights Project"));
  assert.ok(names.every((name) => !/\(cont\.\)/i.test(name)));
  assert.ok(!names.some((name) => /Wenatchee Office/i.test(name)));
  const cities = parsed.records.map((row) => row.city).sort();
  assert.deepEqual(cities, ["Seattle", "Tacoma"]);
});

test("a colon-terminated city label starts a nested office, not a name suffix", () => {
  const parsed = parseProBono([
    page(117, [
      line([{ text: "Dallas Immigration Court", x: 200 }], 734.2, 117),
      line([{ text: "Dallas, Texas", x: 34 }], 719.6, 117),
      line([{ text: "RAICES*", x: 286 }], 704.6, 117),
      line([{ text: "Dallas:", x: 286 }], 644.6, 117),
      line([{ text: "1420 W. Mockingbird Ln., Suite 840", x: 286 }], 629.6, 117),
      line([{ text: "Dallas, TX 75247", x: 286 }], 614.6, 117),
    ]),
  ]);

  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].name, "RAICES");
  assert.equal(parsed.records[0].officeLabel, "Dallas");
  assert.equal(parsed.records[0].street, "1420 W. Mockingbird Ln., Suite 840");
});

test("a location subtitle with page N or M is not prepended to the next org name", () => {
  const parsed = parseProBono([
    page(131, [
      line([{ text: "San Antonio Immigration Court", x: 200 }], 734.2, 131),
      line([{ text: "San Antonio, Texas (page 1 or 2)", x: 34 }], 719.6, 131),
      line([{ text: "American Gateways*", x: 34 }], 704.6, 131),
      line([{ text: "American Gateways – Austin:", x: 34 }], 674.6, 131),
      line([{ text: "314 E. Highland Mall Blvd., Suite 501", x: 34 }], 659.6, 131),
      line([{ text: "Austin, TX 78752", x: 34 }], 644.6, 131),
    ]),
  ]);

  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].name, "American Gateways");
  assert.equal(parsed.records[0].officeLabel, "American Gateways – Austin");
  assert.equal(parsed.records[0].city, "Austin");
});

test("a wrapped legal name after the previous org's notes keeps both lines", () => {
  const parsed = parseProBono([
    page(84, [
      line([{ text: "Newark Immigration Court", x: 200 }], 734.2, 84),
      line([{ text: "Newark, New Jersey", x: 34 }], 719.6, 84),
      line([{ text: "Legal Services of New Jersey*", x: 34 }], 704.6, 84),
      line([{ text: "100 Metroplex Drive, Suite 101", x: 34 }], 674.6, 84),
      line([{ text: "Edison, NJ 08817", x: 34 }], 659.6, 84),
      line([{ text: "• No walk-ins", x: 34 }], 584.6, 84),
      line([{ text: "American Military Families Immigration Services,", x: 34 }], 449.6, 84),
      line([{ text: "Inc. (AMFIS)*", x: 34 }], 434.6, 84),
      line([{ text: "1177 Clinton Avenue, Suite 100", x: 34 }], 404.6, 84),
      line([{ text: "Irvington, NJ 07111", x: 34 }], 389.6, 84),
    ]),
  ]);

  const amfis = parsed.records.find((row) => /AMFIS/i.test(row.name));
  assert.ok(amfis);
  assert.equal(
    amfis.name,
    "American Military Families Immigration Services, Inc. (AMFIS)",
  );
  assert.equal(amfis.city, "Irvington");
  assert.ok(parsed.records.some((row) => row.name === "Legal Services of New Jersey"));
});

test("a wrapped name whose second line starts with and is joined, not started as a new org", () => {
  const parsed = parseProBono([
    page(128, [
      line([{ text: "Pearsall Immigration Court", x: 200 }], 734.2, 128),
      line([{ text: "Pearsall, Texas", x: 34 }], 719.6, 128),
      line([{ text: "American Gateways*", x: 34 }], 704.6, 128),
      line([{ text: "314 E. Highland Mall Blvd., Suite 501", x: 34 }], 659.6, 128),
      line([{ text: "Austin, TX 78752", x: 34 }], 644.6, 128),
      line([{ text: "• No walk-ins", x: 34 }], 374.6, 128),
      line([{ text: "University of Texas School of Law", x: 34 }], 314.6, 128),
      line([{ text: "Immigration Clinic*", x: 34 }], 299.6, 128),
      line([{ text: "727 East Dean Keeton Street", x: 34 }], 269.6, 128),
      line([{ text: "Austin, TX 78705", x: 34 }], 254.6, 128),
      line([{ text: "St. Mary's University School of Law Immigration", x: 286 }], 299.6, 128),
      line([{ text: "and Human Rights Clinic*", x: 286 }], 284.6, 128),
      line([{ text: "2507 NW 36th Street", x: 286 }], 254.6, 128),
      line([{ text: "San Antonio, TX 78228", x: 286 }], 239.6, 128),
    ]),
  ]);

  const names = parsed.records.map((row) => row.name).sort();
  assert.ok(
    names.includes("University of Texas School of Law Immigration Clinic"),
  );
  assert.ok(
    names.includes("St. Mary's University School of Law Immigration and Human Rights Clinic"),
  );
  assert.ok(!names.includes("Immigration Clinic"));
  assert.ok(!names.includes("and Human Rights Clinic"));
  assert.equal(
    parsed.records.filter((row) => row.name.includes("Immigration Clinic")).length,
    1,
  );
});

test("a wrapped name after an address with no intervening bullets still keeps both lines", () => {
  const parsed = parseProBono([
    page(90, [
      line([{ text: "Boston Immigration Court", x: 200 }], 734.2, 90),
      line([{ text: "Boston, Massachusetts", x: 34 }], 719.6, 90),
      line([{ text: "Catholic Charities of Southern Nevada,", x: 34 }], 704.6, 90),
      line([{ text: "Immigration Services*", x: 34 }], 689.6, 90),
      line([{ text: "1501 Las Vegas Blvd.", x: 34 }], 659.6, 90),
      line([{ text: "Las Vegas, NV 89104", x: 34 }], 644.6, 90),
      line([{ text: "Erie County Volunteer Lawyers", x: 34 }], 599.6, 90),
      line([{ text: "Project, Inc.*", x: 34 }], 584.6, 90),
      line([{ text: "237 Main Street, Suite 1030", x: 34 }], 554.6, 90),
      line([{ text: "Buffalo, NY 14203", x: 34 }], 539.6, 90),
    ]),
  ]);

  const names = parsed.records.map((row) => row.name).sort();
  assert.ok(names.includes("Catholic Charities of Southern Nevada, Immigration Services"));
  assert.ok(names.includes("Erie County Volunteer Lawyers Project, Inc."));
  assert.ok(!names.includes("Immigration Services"));
  assert.ok(!names.includes("Project, Inc."));
});

test("a leftover coverage note is not prepended to the next wrapped name", () => {
  const parsed = parseProBono([
    page(131, [
      line([{ text: "San Antonio Immigration Court", x: 200 }], 734.2, 131),
      line([{ text: "San Antonio, Texas", x: 34 }], 719.6, 131),
      line([{ text: "C T Lobos Y A Inc.*", x: 286 }], 539.6, 131),
      line([{ text: "2180 Woodward Street", x: 286 }], 509.6, 131),
      line([{ text: "Austin, TX 78744", x: 286 }], 494.6, 131),
      line([{ text: "• Specialize in Special Immigrant Juvenile", x: 286 }], 344.6, 131),
      line([{ text: "• Representation limited to residents of Bexar,", x: 286 }], 329.6, 131),
      line([{ text: "Caldwell, Comal, Hays, and Travis", x: 286 }], 314.6, 131),
      line([{ text: "St. Mary's University School of Law Immigration", x: 286 }], 299.6, 131),
      line([{ text: "and Human Rights Clinic*", x: 286 }], 284.6, 131),
      line([{ text: "2507 NW 36th Street", x: 286 }], 254.6, 131),
      line([{ text: "San Antonio, TX 78228", x: 286 }], 239.6, 131),
    ]),
  ]);

  assert.equal(parsed.records.length, 2);
  const clinic = parsed.records.find((row) => /St\. Mary's/i.test(row.name));
  assert.equal(
    clinic?.name,
    "St. Mary's University School of Law Immigration and Human Rights Clinic",
  );
  assert.ok(!clinic?.name.includes("Caldwell"));
});

test("a note that happens to be title-case is not glued onto a following Law Office name", () => {
  const parsed = parseProBono([
    page(50, [
      line([{ text: "Indianapolis Immigration Court", x: 200 }], 734.2, 50),
      line([{ text: "Indianapolis, Indiana", x: 34 }], 719.6, 50),
      line([{ text: "National Immigrant Justice Center*", x: 34 }], 704.6, 50),
      line([{ text: "110 E. Washington Street", x: 34 }], 674.6, 50),
      line([{ text: "Goshen, IN 46528", x: 34 }], 659.6, 50),
      line([{ text: "• Detained immigrants may call collect", x: 34 }], 599.6, 50),
      line([{ text: "NIJC's 3-digit code: 565", x: 34 }], 569.6, 50),
      line([{ text: "Law Office of the Cook County Public Defender*", x: 34 }], 554.6, 50),
      line([{ text: "69 W. Washington Street, Suite 1600", x: 34 }], 524.6, 50),
      line([{ text: "Chicago, IL 60602", x: 34 }], 509.6, 50),
    ]),
  ]);

  const defender = parsed.records.find((row) => /Public Defender/i.test(row.name));
  assert.equal(defender?.name, "Law Office of the Cook County Public Defender");
  assert.equal(defender?.city, "Chicago");
  assert.ok(
    !parsed.records.some(
      (row) => /3-digit|NIJC/i.test(row.name) && /Defender/i.test(row.name),
    ),
  );
});

test("a facility-coverage note is not prepended to the next wrapped affiliate name", () => {
  const parsed = parseProBono([
    page(65, [
      line([{ text: "Chelmsford Immigration Court", x: 200 }], 734.2, 65),
      line([{ text: "Chelmsford, Massachusetts", x: 34 }], 719.6, 65),
      line(
        [{ text: "Political Asylum/Immigration Representation Project (PAIR)*", x: 286 }],
        704.6,
        65,
      ),
      line([{ text: "98 North Washington Street, Suite 106", x: 286 }], 659.6, 65),
      line([{ text: "Boston, MA 02114", x: 286 }], 644.6, 65),
      line(
        [{ text: "• Know your rights presentations conducted at local", x: 286 }],
        464.6,
        65,
      ),
      line([{ text: "Plymouth County Correctional Facility, MA and", x: 286 }], 434.6, 65),
      line([{ text: "Donald W. Wyatt Detention Facility, RI", x: 286 }], 419.6, 65),
      line([{ text: "Central West Justice Center - An affiliate of", x: 286 }], 404.6, 65),
      line([{ text: "Community Legal Aid*", x: 286 }], 389.6, 65),
      line([{ text: "370 Main Street, Suite 200", x: 286 }], 359.6, 65),
      line([{ text: "Worcester, MA 01608", x: 286 }], 344.6, 65),
    ]),
  ]);

  const names = parsed.records.map((row) => row.name);
  assert.ok(
    names.includes("Central West Justice Center - An affiliate of Community Legal Aid"),
  );
  assert.ok(!names.some((name) => /Plymouth|Wyatt/i.test(name)));
});

test("a complete marked name after notes is not joined to the previous note line", () => {
  const parsed = parseProBono([
    page(144, [
      line([{ text: "Seattle Immigration Court", x: 200 }], 734.2, 144),
      line([{ text: "Seattle, Washington", x: 34 }], 719.6, 144),
      line([{ text: "The Northwest Immigrant Rights Project*", x: 34 }], 704.6, 144),
      line([{ text: "615 2nd Avenue, Suite 400", x: 34 }], 659.6, 144),
      line([{ text: "Seattle, WA 98104", x: 34 }], 644.6, 144),
      line([{ text: "• Walk-ins welcome", x: 34 }], 479.6, 144),
      line([{ text: "Kids In Need of Defense (KIND) - Seattle Field Office*", x: 34 }], 344.6, 144),
      line([{ text: "1215 Fourth Avenue, Suite 1925", x: 34 }], 314.6, 144),
      line([{ text: "Seattle, WA 98161", x: 34 }], 299.6, 144),
    ]),
  ]);

  const kind = parsed.records.find((row) => /KIND/i.test(row.name));
  assert.equal(
    kind?.name,
    "Kids In Need of Defense (KIND) - Seattle Field Office",
  );
  assert.ok(!kind?.name.includes("Walk-ins"));
});
