/**
 * Write high-confidence local-tier websites from the discovery report.
 *
 * Holds Check 1 (umbrella / repeated-domain) and the narrow Check 2
 * city-collision slice. Does not write parent-tier URLs.
 *
 * Usage:
 *   npx tsx scripts/apply-local-website-discovery.ts
 *   npx tsx scripts/apply-local-website-discovery.ts --apply
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createIngestClient } from "../src/lib/ingestion/eoir/client";
import { canonicalizeWebsiteUrl } from "../src/lib/website-corrections";
import { sanitizeDiscoveredWebsiteUrl } from "../src/lib/ingestion/website-discovery";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const REPORT_PATH = join(__dirname, "reports/website-discovery.json");
const APPLY_REPORT_PATH = join(
  __dirname,
  "reports/website-discovery-local-apply.json",
);

const KNOWN_UMBRELLA_HOSTS = new Set([
  "catholiccharitiesusa.org",
  "worldrelief.org",
  "rescue.org",
  "theirc.org",
  "supportkind.org",
  "kind.org",
  "hias.org",
  "irco.org",
  "cwsglobal.org",
  "churchworldservice.org",
  "lirs.org",
  "switchboard.org",
  "uscirefugees.org",
  "humanrightsfirst.org",
  "tahirih.org",
  "ufwfoundation.org",
  "naleo.org",
  "baji.org",
  "cliniclegal.org",
  "aila.org",
]);

const LEGAL_SUFFIXES = new Set([
  "inc",
  "llc",
  "ltd",
  "llp",
  "pllc",
  "pc",
  "pa",
  "corp",
  "co",
  "incorporated",
  "company",
  "the",
]);

const FOREIGN_CITY_TOKENS = [
  "philly",
  "philadelphia",
  "boston",
  "chicago",
  "houston",
  "dallas",
  "seattle",
  "portland",
  "denver",
  "miami",
  "atlanta",
  "oakland",
  "brooklyn",
  "bronx",
  "queens",
  "baltimore",
  "detroit",
  "minneapolis",
  "pittsburgh",
  "cleveland",
  "cincinnati",
  "phoenix",
  "tucson",
  "sacramento",
  "sandiego",
  "sanfrancisco",
  "losangeles",
  "lancaster",
  "milwaukee",
];

const CITY_TYPO_FIXES: Array<{
  id: string;
  fromCity: string;
  toCity: string;
  fromAddress?: string;
  toAddress?: string;
}> = [
  {
    id: "deac1882-cdd1-4b64-b256-d629bd0f3509",
    fromCity: "Balitmore",
    toCity: "Baltimore",
    fromAddress: "5400 Loch Raven Blvd, Suite 1, Balitmore, MD 21239",
    toAddress: "5400 Loch Raven Blvd, Suite 1, Baltimore, MD 21239",
  },
];

type DiscoveryRow = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  url: string | null;
  host: string | null;
  websiteScope: "local" | "parent" | null;
};

type ReportFile = {
  highLocal: DiscoveryRow[];
  highParent: DiscoveryRow[];
};

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

function normName(name: string): string {
  const stripped = name.replace(/\([^)]*\)/g, " ").toLowerCase();
  return stripped
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token && !LEGAL_SUFFIXES.has(token))
    .join(" ");
}

function citySlug(city: string | null): string {
  return (city ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hostOf(row: DiscoveryRow): string {
  const raw = (row.host ?? "").toLowerCase().replace(/^www\./, "").replace(/\.+$/, "");
  if (raw) return raw;
  if (!row.url) return "";
  try {
    return new URL(row.url).hostname.toLowerCase().replace(/^www\./, "").replace(/\.+$/, "");
  } catch {
    return "";
  }
}

function registrable(host: string): string {
  const parts = host.split(".").filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join(".") : host;
}

function sanitizeUrl(raw: string): string | null {
  const cleaned = sanitizeDiscoveredWebsiteUrl(raw);
  if (!cleaned) return null;
  return canonicalizeWebsiteUrl(cleaned) ?? cleaned;
}

function collisionHits(row: DiscoveryRow): string[] {
  const label = hostOf(row).split(".")[0]?.replace(/-/g, "") ?? "";
  const city = citySlug(row.city);
  const name = (row.name ?? "").toLowerCase().replace(/\s+/g, "");
  return FOREIGN_CITY_TOKENS.filter(
    (token) =>
      token.length >= 4 &&
      label.includes(token) &&
      !city.includes(token) &&
      !name.includes(token),
  );
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
  if (!existsSync(REPORT_PATH)) {
    throw new Error(`Missing discovery report: ${REPORT_PATH}`);
  }

  const report = JSON.parse(readFileSync(REPORT_PATH, "utf8")) as ReportFile;
  const local = report.highLocal;
  if (local.length !== 740) {
    throw new Error(`Expected 740 high-local rows, got ${local.length}`);
  }

  const namesByHost = new Map<string, Set<string>>();
  for (const row of local) {
    const host = registrable(hostOf(row));
    const names = namesByHost.get(host) ?? new Set<string>();
    names.add(normName(row.name));
    namesByHost.set(host, names);
  }

  const umbrella = local.filter((row) => {
    const host = registrable(hostOf(row));
    return KNOWN_UMBRELLA_HOSTS.has(host) || (namesByHost.get(host)?.size ?? 0) >= 2;
  });
  const collisions = local.filter((row) => collisionHits(row).length > 0);
  const typoIds = new Set(CITY_TYPO_FIXES.map((fix) => fix.id));
  const collisionHolds = collisions.filter((row) => !typoIds.has(row.id));
  const holdIds = new Set([
    ...umbrella.map((row) => row.id),
    ...collisionHolds.map((row) => row.id),
  ]);
  const writes = local.filter((row) => !holdIds.has(row.id));

  const ccusaParent = (report.highParent ?? []).filter((row) =>
    hostOf(row).includes("catholiccharitiesusa.org"),
  );

  if (umbrella.length !== 24) {
    throw new Error(`Expected 24 umbrella holds, got ${umbrella.length}`);
  }
  if (collisions.length !== 6) {
    throw new Error(`Expected 6 city-collision rows, got ${collisions.length}`);
  }
  if (collisionHolds.length !== 5) {
    throw new Error(`Expected 5 remaining collision holds, got ${collisionHolds.length}`);
  }
  if (writes.length !== 711) {
    throw new Error(`Expected 711 local writes, got ${writes.length}`);
  }

  const payloads = writes.map((row) => {
    const url = row.url ? sanitizeUrl(row.url) : null;
    if (!url) {
      throw new Error(`Unusable URL for ${row.id} (${row.name}): ${row.url}`);
    }
    return { id: row.id, name: row.name, city: row.city, url };
  });

  const plan = {
    generatedAt: new Date().toISOString(),
    apply,
    arithmetic: {
      highLocal: 740,
      check1Umbrella: 24,
      check2Collision: 6,
      naiveClean: 710,
      cityTypoUnheld: typoIds.size,
      written: payloads.length,
      websiteHolds: holdIds.size,
      ccusaParentHolds: ccusaParent.length,
    },
    umbrellaHolds: umbrella.map((row) => ({
      id: row.id,
      name: row.name,
      city: row.city,
      state: row.state,
      host: hostOf(row),
    })),
    collisionHolds: collisionHolds.map((row) => ({
      id: row.id,
      name: row.name,
      city: row.city,
      state: row.state,
      host: hostOf(row),
      hits: collisionHits(row),
    })),
    cityTypoFixes: CITY_TYPO_FIXES,
    ccusaParentHolds: ccusaParent.map((row) => ({
      id: row.id,
      name: row.name,
      city: row.city,
      url: row.url,
    })),
  };

  console.log(
    `\nLocal-tier website apply (${apply ? "WRITE" : "dry-run"})` +
      `\n  740 − 24 umbrella − 6 collision = 710 naive clean` +
      `\n  + ${typoIds.size} city-typo row(s) written instead of held` +
      `\n  → ${payloads.length} website writes, ${holdIds.size} website holds` +
      `\n  parent CCUSA holds left untouched: ${ccusaParent.length}\n`,
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

  const client = await createIngestClient();
  let wrote = 0;
  let skipped = 0;
  const failures: Array<{ id: string; error: string }> = [];

  await mapPool(payloads, 8, async (row) => {
    const { data, error } = await client
      .from("organizations")
      .update({ website_url: row.url, website_scope: "local" })
      .eq("id", row.id)
      .is("website_url", null)
      .select("id");
    if (error) {
      failures.push({ id: row.id, error: error.message });
      return;
    }
    if (!data?.length) skipped += 1;
    else wrote += 1;
  });

  const cityFixResults: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const fix of CITY_TYPO_FIXES) {
    const patch: { city: string; address?: string } = { city: fix.toCity };
    if (fix.toAddress) patch.address = fix.toAddress;
    const { data, error } = await client
      .from("organizations")
      .update(patch)
      .eq("id", fix.id)
      .eq("city", fix.fromCity)
      .select("id");
    cityFixResults.push({
      id: fix.id,
      ok: !error && Boolean(data?.length),
      error: error?.message,
    });
  }

  mkdirSync(dirname(APPLY_REPORT_PATH), { recursive: true });
  writeFileSync(
    APPLY_REPORT_PATH,
    JSON.stringify(
      { ...plan, wrote, skipped, failures, cityFixResults },
      null,
      2,
    ),
  );

  console.log(`  wrote     ${wrote}`);
  console.log(`  skipped   ${skipped}  (already had website_url)`);
  console.log(`  failures  ${failures.length}`);
  for (const fix of cityFixResults) {
    console.log(`  city fix  ${fix.id}  ${fix.ok ? "ok" : fix.error ?? "missed"}`);
  }
  console.log(`  report    ${APPLY_REPORT_PATH}\n`);

  if (failures.length) {
    throw new Error(`${failures.length} website writes failed`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
