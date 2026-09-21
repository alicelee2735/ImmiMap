/**
 * Write high-confidence parent-tier websites from the discovery report.
 *
 * Holds the 3 CCUSA member-directory matches for manual review.
 * Does not touch local-tier rows.
 *
 * Usage:
 *   npx tsx scripts/apply-parent-website-discovery.ts
 *   npx tsx scripts/apply-parent-website-discovery.ts --apply
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
  "reports/website-discovery-parent-apply.json",
);

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

function sanitizeUrl(raw: string): string | null {
  const cleaned = sanitizeDiscoveredWebsiteUrl(raw);
  if (!cleaned) return null;
  return canonicalizeWebsiteUrl(cleaned) ?? cleaned;
}

function isCcusaHold(row: DiscoveryRow): boolean {
  return hostOf(row).includes("catholiccharitiesusa.org");
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
  const parent = report.highParent ?? [];
  if (parent.length !== 118) {
    throw new Error(`Expected 118 high-parent rows, got ${parent.length}`);
  }

  const holds = parent.filter(isCcusaHold);
  const writes = parent.filter((row) => !isCcusaHold(row));
  if (holds.length !== 3) {
    throw new Error(`Expected 3 CCUSA parent holds, got ${holds.length}`);
  }
  if (writes.length !== 115) {
    throw new Error(`Expected 115 parent writes, got ${writes.length}`);
  }

  const payloads = writes.map((row) => {
    const url = row.url ? sanitizeUrl(row.url) : null;
    if (!url) {
      throw new Error(`Unusable URL for ${row.id} (${row.name}): ${row.url}`);
    }
    return {
      id: row.id,
      name: row.name,
      city: row.city,
      state: row.state,
      url,
      host: hostOf(row),
    };
  });

  const plan = {
    generatedAt: new Date().toISOString(),
    apply,
    arithmetic: {
      highParent: 118,
      ccusaParentHolds: holds.length,
      written: payloads.length,
    },
    ccusaParentHolds: holds.map((row) => ({
      id: row.id,
      name: row.name,
      city: row.city,
      state: row.state,
      url: row.url,
    })),
  };

  console.log(
    `\nParent-tier website apply (${apply ? "WRITE" : "dry-run"})` +
      `\n  118 − 3 CCUSA holds → ${payloads.length} website writes\n`,
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
      .update({ website_url: row.url, website_scope: "parent" })
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

  mkdirSync(dirname(APPLY_REPORT_PATH), { recursive: true });
  writeFileSync(
    APPLY_REPORT_PATH,
    JSON.stringify({ ...plan, wrote, skipped, failures }, null, 2),
  );

  console.log(`  wrote     ${wrote}`);
  console.log(`  skipped   ${skipped}  (already had website_url)`);
  console.log(`  failures  ${failures.length}`);
  console.log(`  report    ${APPLY_REPORT_PATH}\n`);

  if (failures.length) {
    throw new Error(`${failures.length} website writes failed`);
  }
  if (wrote !== 115 || skipped !== 0) {
    throw new Error(`Expected 115 writes / 0 skipped, got ${wrote} / ${skipped}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
