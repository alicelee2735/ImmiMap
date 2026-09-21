/**
 * Apply the 32 discovery-pass website holds after the manual research pass.
 *
 * Usage:
 *   npx tsx scripts/apply-held-website-research.ts
 *   npx tsx scripts/apply-held-website-research.ts --apply
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createIngestClient } from "../src/lib/ingestion/eoir/client";
import { sanitizeDiscoveredWebsiteUrl } from "../src/lib/ingestion/website-discovery";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const APPLY_REPORT_PATH = join(
  __dirname,
  "reports/held-website-research-apply.json",
);

type WebsiteScope = "local" | "parent";
type Bucket =
  | "wrong-umbrella"
  | "chapter-page"
  | "own-domain"
  | "shared-contact"
  | "umbrella-homepage"
  | "metro-naming";

type HoldWrite = {
  id: string;
  name: string;
  city: string;
  state: string;
  bucket: Bucket;
  url: string;
  scope: WebsiteScope;
};

const HOLDS: HoldWrite[] = [
  {
    id: "52dfcce0-83fa-4e63-b68d-84d9bf85a758",
    name: "Catholic Charities of Sacramento, Inc.",
    city: "Sacramento",
    state: "CA",
    bucket: "wrong-umbrella",
    url: "https://www.sacramentofoodbank.org/immigration",
    scope: "local",
  },
  {
    id: "61a7aad3-e0a0-44aa-9830-6183b51a84b2",
    name: "Catholic Charities of the Diocese of Stockton",
    city: "Stockton",
    state: "CA",
    bucket: "wrong-umbrella",
    url: "https://www.ccstockton.org/",
    scope: "local",
  },
  {
    id: "75fd3c6c-605c-4b77-8e67-65cc48fc47d0",
    name: "Catholic Charities of the Diocese of Monterey",
    city: "Seaside",
    state: "CA",
    bucket: "wrong-umbrella",
    url: "https://catholiccharitiesdom.org/",
    scope: "local",
  },
  {
    id: "c9f98677-983c-4cc7-923d-47fe3afeb65a",
    name: "Catholic Charities of the Diocese of Monterey",
    city: "San Luis Obispo",
    state: "CA",
    bucket: "wrong-umbrella",
    url: "https://catholiccharitiesdom.org/",
    scope: "local",
  },
  {
    id: "bb16991f-5fea-4ee6-a021-d776fb128872",
    name: "Catholic Charities of the Diocese of Monterey",
    city: "San Luis Obispo",
    state: "CA",
    bucket: "wrong-umbrella",
    url: "https://catholiccharitiesdom.org/",
    scope: "local",
  },
  {
    id: "3d497c2a-350d-4cd5-add1-cdd4f55f9600",
    name: "Logan Square Neighborhood Association",
    city: "Chicago",
    state: "IL",
    bucket: "wrong-umbrella",
    url: "https://www.palenquelsna.org/",
    scope: "local",
  },
  {
    id: "4a45a108-8190-4e47-95d4-2354f19074e0",
    name: "Immigrant Hope-Clifton NJ",
    city: "Clifton",
    state: "NJ",
    bucket: "chapter-page",
    url: "https://immigranthope.org/clifton",
    scope: "local",
  },
  {
    id: "f1602491-2317-4a85-a3f9-abcade416232",
    name: "Black Alliance for Just Immigration",
    city: "Oakland",
    state: "CA",
    bucket: "chapter-page",
    url: "https://baji.org/our-work/chapters/oakland/",
    scope: "local",
  },
  {
    id: "f6aa23b4-c8ee-4268-b540-11920c63102e",
    name: "Black Alliance for Just Immigration",
    city: "Los Angeles",
    state: "CA",
    bucket: "chapter-page",
    url: "https://baji.org/our-work/chapters/los-angeles/",
    scope: "local",
  },
  {
    id: "9d331e84-f0db-42a0-8807-ccec40dfeb1b",
    name: "Immigrant Hope Santa Barbara, CA",
    city: "Arroyo Grande",
    state: "CA",
    bucket: "own-domain",
    url: "https://immigranthopeag.org/",
    scope: "local",
  },
  {
    id: "344b2486-2385-4252-8f97-738242a45f26",
    name: "Catholic Charities of the East Bay",
    city: "Oakland",
    state: "CA",
    bucket: "own-domain",
    url: "https://cceb.org/",
    scope: "local",
  },
  {
    id: "98f6c7c3-3620-404d-bc18-7cafa3c1634c",
    name: "Catholic Charities of Buffalo",
    city: "Buffalo",
    state: "NY",
    bucket: "own-domain",
    url: "https://ccwny.org/",
    scope: "local",
  },
  {
    id: "bfabd93f-3840-45b4-a50b-278258d10073",
    name: "Catholic Charities of Louisville",
    city: "Louisville",
    state: "KY",
    bucket: "own-domain",
    url: "https://cclou.org/",
    scope: "local",
  },
  {
    id: "22e8914a-e8a8-4cc4-b62a-1a8bda72a41c",
    name: "UFW Foundation",
    city: "Oxnard",
    state: "CA",
    bucket: "shared-contact",
    url: "https://ufwfoundation.org/contact-us/",
    scope: "parent",
  },
  {
    id: "2c7f9735-a765-4273-b7fd-6d09ffd0ca1a",
    name: "UFW Foundation",
    city: "Fresno",
    state: "CA",
    bucket: "shared-contact",
    url: "https://ufwfoundation.org/contact-us/",
    scope: "parent",
  },
  {
    id: "62633344-8ad0-4736-8aea-d03af861cc8e",
    name: "UFW Foundation",
    city: "Salinas",
    state: "CA",
    bucket: "shared-contact",
    url: "https://ufwfoundation.org/contact-us/",
    scope: "parent",
  },
  {
    id: "263d3ff5-9b53-44e1-956f-728193981d98",
    name: "Tahirih Justice Center",
    city: "Falls Church",
    state: "VA",
    bucket: "shared-contact",
    url: "https://www.tahirih.org/about-us/contact-us/",
    scope: "parent",
  },
  {
    id: "2e8da41d-1660-4969-9efd-fda9c6e04beb",
    name: "Tahirih Justice Center",
    city: "Baltimore",
    state: "MD",
    bucket: "shared-contact",
    url: "https://www.tahirih.org/about-us/contact-us/",
    scope: "parent",
  },
  {
    id: "7cac35e7-479e-4f6a-b9bb-b92fa34f359f",
    name: "Tahirih Justice Center",
    city: "Atlanta",
    state: "GA",
    bucket: "shared-contact",
    url: "https://www.tahirih.org/about-us/contact-us/",
    scope: "parent",
  },
  {
    id: "f84e41db-8ca8-4b45-b17c-4cd8ee51c2bd",
    name: "Tahirih Justice Center",
    city: "San Bruno",
    state: "CA",
    bucket: "shared-contact",
    url: "https://www.tahirih.org/about-us/contact-us/",
    scope: "parent",
  },
  {
    id: "2dc4817d-0f58-4fb4-b213-ce4839df8bf3",
    name: "Human Rights First",
    city: "New York",
    state: "NY",
    bucket: "shared-contact",
    url: "https://www.humanrightsfirst.org/contact",
    scope: "parent",
  },
  {
    id: "8b72f250-3b0b-4da9-b8bc-214b9aaa1f50",
    name: "Human Rights First",
    city: "Washington",
    state: "DC",
    bucket: "shared-contact",
    url: "https://www.humanrightsfirst.org/contact",
    scope: "parent",
  },
  {
    id: "ccfa78e0-8f47-49ab-a4b9-3ec2a2025e42",
    name: "Human Rights First",
    city: "Los Angeles",
    state: "CA",
    bucket: "shared-contact",
    url: "https://www.humanrightsfirst.org/contact",
    scope: "parent",
  },
  {
    id: "5fe7473a-93a5-4b4c-9a11-133aa7fc99d5",
    name: "Catholic Legal Immigration Network, Inc.",
    city: "Silver Spring",
    state: "MD",
    bucket: "umbrella-homepage",
    url: "https://www.cliniclegal.org/",
    scope: "parent",
  },
  {
    id: "f6ecf0f1-3d2d-4f6b-b999-80e6a080baf8",
    name: "Black Alliance for Just Immigration",
    city: "Brooklyn",
    state: "NY",
    bucket: "umbrella-homepage",
    url: "https://www.baji.org/",
    scope: "parent",
  },
  {
    id: "648115cd-bfbc-431f-9eb4-d24ba663d643",
    name: "NALEO Educational Fund",
    city: "Houston",
    state: "TX",
    bucket: "umbrella-homepage",
    url: "https://naleo.org/",
    scope: "parent",
  },
  {
    id: "6f281151-306b-4cd8-bc00-7842e43a8c03",
    name: "NALEO Educational Fund",
    city: "Monterey Park",
    state: "CA",
    bucket: "umbrella-homepage",
    url: "https://naleo.org/",
    scope: "parent",
  },
  {
    id: "747b7b90-76a8-48fe-8971-a21b7339a748",
    name: "NALEO Educational Fund",
    city: "New York",
    state: "NY",
    bucket: "umbrella-homepage",
    url: "https://naleo.org/",
    scope: "parent",
  },
  {
    id: "47addce5-9569-4481-9a44-256cfe92fae1",
    name: "Middle Eastern Immigrant and Refugee Alliance (MIRA)",
    city: "Lincolnwood",
    state: "IL",
    bucket: "metro-naming",
    url: "https://mirachicago.org/",
    scope: "local",
  },
  {
    id: "b1a2d848-3f90-432d-8497-403b4e8ad817",
    name: "Southwest Suburban Immigrant Project",
    city: "Bolingbrook",
    state: "IL",
    bucket: "metro-naming",
    url: "https://www.ssipchicago.org/",
    scope: "local",
  },
  {
    id: "50bceed7-b06f-4a87-afb0-7d86086b0c7d",
    name: "Refugee and Immigrant Assistance Center",
    city: "Lynn",
    state: "MA",
    bucket: "metro-naming",
    url: "https://www.riacboston.org/",
    scope: "local",
  },
  {
    id: "bdd8c960-8c94-4902-8b5b-f60583524fe7",
    name: "The West African Community Council (WACC)",
    city: "Kent",
    state: "WA",
    bucket: "metro-naming",
    url: "https://www.waccofseattle.org/",
    scope: "local",
  },
];

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile(join(root, ".env.local"));

function sanitizeUrl(raw: string): string {
  const url = sanitizeDiscoveredWebsiteUrl(raw);
  if (!url) {
    throw new Error(`Unusable URL: ${raw}`);
  }
  return url;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  async function run() {
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length || 1) }, () => run()),
  );
  return results;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const ids = HOLDS.map((row) => row.id);
  if (new Set(ids).size !== 32 || HOLDS.length !== 32) {
    throw new Error(`Expected 32 unique hold writes, got ${HOLDS.length}`);
  }

  const payloads = HOLDS.map((row) => ({
    ...row,
    url: sanitizeUrl(row.url),
  }));

  const client = await createIngestClient();
  const { data: existing, error: readError } = await client
    .from("organizations")
    .select("id, name, city, state, website_url, website_scope")
    .in("id", ids);
  if (readError) {
    throw new Error(`Failed to read holds: ${readError.message}`);
  }

  const byId = new Map(
    (existing ?? []).map((row) => [row.id as string, row]),
  );
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) {
    throw new Error(`Missing organizations: ${missing.join(", ")}`);
  }

  const occupied = payloads.filter((row) => byId.get(row.id)?.website_url);
  const plan = {
    generatedAt: new Date().toISOString(),
    apply,
    count: payloads.length,
    byBucket: Object.fromEntries(
      [
        "wrong-umbrella",
        "chapter-page",
        "own-domain",
        "shared-contact",
        "umbrella-homepage",
        "metro-naming",
      ].map((bucket) => [
        bucket,
        payloads.filter((row) => row.bucket === bucket).length,
      ]),
    ),
    local: payloads.filter((row) => row.scope === "local").length,
    parent: payloads.filter((row) => row.scope === "parent").length,
    alreadyHadUrl: occupied.map((row) => ({
      id: row.id,
      stored: byId.get(row.id)?.website_url,
    })),
    rows: payloads.map((row) => ({
      id: row.id,
      name: row.name,
      city: row.city,
      state: row.state,
      bucket: row.bucket,
      beforeUrl: byId.get(row.id)?.website_url ?? null,
      beforeScope: byId.get(row.id)?.website_scope ?? null,
      afterUrl: row.url,
      afterScope: row.scope,
    })),
  };

  console.log(
    `\nHeld website research apply (${apply ? "WRITE" : "dry-run"})` +
      `\n  rows     ${payloads.length}` +
      `\n  local    ${plan.local}` +
      `\n  parent   ${plan.parent}` +
      `\n  occupied ${occupied.length}\n`,
  );

  if (!apply) {
    mkdirSync(dirname(APPLY_REPORT_PATH), { recursive: true });
    writeFileSync(
      APPLY_REPORT_PATH,
      JSON.stringify({ ...plan, wrote: 0, skipped: 0 }, null, 2),
    );
    console.log(`Dry-run plan written to ${APPLY_REPORT_PATH}`);
    console.log("Re-run with --apply to write.\n");
    return;
  }

  if (occupied.length) {
    throw new Error(
      `${occupied.length} hold(s) already have website_url; refusing to overwrite`,
    );
  }

  const failures: Array<{ id: string; error: string }> = [];
  const results = await mapPool(payloads, 8, async (row) => {
    const { data, error } = await client
      .from("organizations")
      .update({ website_url: row.url, website_scope: row.scope })
      .eq("id", row.id)
      .is("website_url", null)
      .select("id, website_url, website_scope");
    if (error) {
      failures.push({ id: row.id, error: error.message });
      return { id: row.id, ok: false, skipped: false };
    }
    if (!data?.length) {
      return { id: row.id, ok: true, skipped: true };
    }
    return {
      id: row.id,
      ok: true,
      skipped: false,
      website_url: data[0]?.website_url,
      website_scope: data[0]?.website_scope,
    };
  });

  mkdirSync(dirname(APPLY_REPORT_PATH), { recursive: true });
  writeFileSync(
    APPLY_REPORT_PATH,
    JSON.stringify({ ...plan, results, failures }, null, 2),
  );

  const wrote = results.filter((row) => row.ok && !row.skipped).length;
  const skipped = results.filter((row) => row.skipped).length;
  console.log(`  wrote     ${wrote}`);
  console.log(`  skipped   ${skipped}`);
  console.log(`  failures  ${failures.length}`);
  console.log(`  report    ${APPLY_REPORT_PATH}\n`);

  if (failures.length || wrote !== 32) {
    throw new Error(
      `Expected 32 writes, got wrote=${wrote} skipped=${skipped} failures=${failures.length}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
