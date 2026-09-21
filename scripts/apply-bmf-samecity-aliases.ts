/**
 * Attach confirmed same-city BMF EINs as organization_source_keys.
 * Usage: npx tsx scripts/apply-bmf-samecity-aliases.ts --apply
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createIngestClient } from "../src/lib/ingestion/eoir/client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const PAYLOAD = join(__dirname, "reports/bmf-samecity-attaches.json");

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

type Row = { ein: string; id: string; bmf: string; catalog: string };

async function main() {
  const apply = process.argv.includes("--apply");
  const rows = JSON.parse(readFileSync(PAYLOAD, "utf8")) as Row[];
  const payload = rows.map((row) => ({
    legacy_id: `irs-eo-${row.ein}`,
    organization_id: row.id,
  }));
  console.log(`planned ${payload.length} aliases; apply=${apply}`);
  if (!apply) return;

  const client = await createIngestClient();
  const { data, error } = await client
    .from("organization_source_keys")
    .upsert(payload, { onConflict: "legacy_id", ignoreDuplicates: true })
    .select("legacy_id");
  if (error) throw new Error(error.message);
  console.log(`wrote ${data?.length ?? 0}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
