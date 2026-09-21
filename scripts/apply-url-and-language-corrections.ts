/**
 * Apply the website URL pull-backs / typo fixes and write website-confirmed
 * non-English languages from the audit report.
 *
 * Does not write English from switcher / hreflang / list detection or weak
 * LEP copy. Leaves the 547 assumed-English rows untouched. Leaves gated
 * (403) and HTTP/2-flake URLs as-is. Does not rewrite the USD careers page.
 *
 * Usage:
 *   npx tsx scripts/apply-url-and-language-corrections.ts
 *   npx tsx scripts/apply-url-and-language-corrections.ts --apply
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createIngestClient } from "../src/lib/ingestion/eoir/client";
import {
  mergeOrganizationLanguages,
  pickBestLanguageEvidence,
} from "../src/lib/language-evidence";
import { canonicalizeWebsiteUrl } from "../src/lib/website-corrections";
import type { LanguageEvidence } from "../src/types/database.types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const LANGUAGE_REPORT_PATH = join(__dirname, "reports/language-verification.json");
const APPLY_REPORT_PATH = join(
  __dirname,
  "reports/url-and-language-corrections-apply.json",
);

const EXPECTED_LANGUAGE_ORGS = 371;

const DEAD_PULLBACKS = [
  {
    id: "4f53b8ae-1cba-47c0-bee3-dfb4bbf81020",
    name: "Latin American Coalition",
    from: "https://www.latinamericancoalition.org/",
  },
  {
    id: "59d8600d-6c6a-4a4d-931f-f6e201b1e09b",
    name: "Libreria Del Pueblo, Inc.",
    from: "https://www.libreriadelpueblo.org/",
  },
  {
    id: "50453a80-18c0-46f5-8929-b19a33e41480",
    name: "Servicios Latinos de Burlington County, Inc.",
    from: "https://www.servicioslatinos-nj.org/",
  },
  {
    id: "5108b30c-9d3c-4bca-9bcc-7dfb6be303cf",
    name: "Guymon Church of the Nazarene",
    from: "https://www.guymonnazarene.org/",
  },
  {
    id: "84ed7ebf-3588-41b9-9717-c218376f7436",
    name: "Kabod Ministries",
    from: "https://www.kabodministries.org/",
  },
  {
    id: "c51f6cf4-b8dd-4383-9886-d0457e73b155",
    name: "Orlando Center for Justice",
    from: "https://www.orlandojustice.org/",
  },
  {
    id: "ddda5f41-7f62-435a-8b9e-c5ab2171a8ce",
    name: "Bethany Immigration Services",
    from: "https://www.bethanyimmigration.org/",
  },
] as const;

const TYPO_FIXES = [
  {
    id: "14a6807a-a020-4c53-b99a-32cf304117f9",
    name: "Hispanic and Immigrant Center of Alabama",
    from: "https://hicaalabama.org/en/home;",
    to: "https://hicaalabama.org/en/home",
  },
  {
    id: "53bee26b-559f-4de7-a85d-c513cd1a8e92",
    name: "La Union del Pueblo Entero",
    from: "https://www.lupenet.org;/",
    to: "https://www.lupenet.org/",
  },
  {
    id: "55afea9a-18ca-4482-9619-6c7791a3d795",
    name: "Centro Hispano Comunitario de Nebraska",
    from: "https://www.centrohispanone.org;/",
    to: "https://www.centrohispanone.org/",
  },
  {
    id: "615ea928-f7de-4a65-91a0-b0fb6e872657",
    name: "Florida Immigrant Rights Coalition",
    from: "https://www.firclaw.org;/",
    to: "https://www.firclaw.org/",
  },
  {
    id: "b21440f2-812e-4e21-a63b-5ada04a33f94",
    name: "Institute for Children's Aid",
    from: "https://instituteforchildrensaid.org;/",
    to: "https://instituteforchildrensaid.org/",
  },
  {
    id: "5aac6b10-fe1f-4e5a-b33f-15200fe52f82",
    name: "Catholic Charities of the Archdiocese of Washington",
    from: "https://www.catholiccharitiesdc.o/",
    to: "https://www.catholiccharitiesdc.org/",
  },
  {
    id: "ca338879-b2f4-4696-a5a4-8a00abb3f3b7",
    name: "Vanessa's Social Services",
    from: "https://vanessasocialservices.co/",
    to: "https://vanessasocialservices.com/",
  },
] as const;

type LanguageMatch = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  languages: string[];
  evidence: LanguageEvidence[];
};

type LanguageReport = {
  matches: LanguageMatch[];
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

function canonicalUrl(raw: string): string {
  return canonicalizeWebsiteUrl(raw) ?? raw;
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

function languagePayloads(report: LanguageReport) {
  const payloads: Array<{
    id: string;
    name: string;
    languages: string[];
    evidence: LanguageEvidence[];
  }> = [];

  for (const row of report.matches) {
    const evidence = pickBestLanguageEvidence(row.evidence);
    if (evidence.length === 0) continue;
    payloads.push({
      id: row.id,
      name: row.name,
      languages: evidence.map((item) => item.language),
      evidence,
    });
  }

  return payloads;
}

function countByLanguage(payloads: Array<{ languages: string[] }>) {
  const counts = new Map<string, number>();
  for (const row of payloads) {
    for (const language of new Set(row.languages)) {
      counts.set(language, (counts.get(language) ?? 0) + 1);
    }
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (!existsSync(LANGUAGE_REPORT_PATH)) {
    throw new Error(`Missing language report: ${LANGUAGE_REPORT_PATH}`);
  }

  const report = JSON.parse(readFileSync(LANGUAGE_REPORT_PATH, "utf8")) as LanguageReport;
  const languages = languagePayloads(report);
  if (languages.length !== EXPECTED_LANGUAGE_ORGS) {
    throw new Error(
      `Expected ${EXPECTED_LANGUAGE_ORGS} non-English language orgs, got ${languages.length}`,
    );
  }

  const englishInEvidence = languages.filter((row) =>
    row.evidence.some((item) => item.language === "English"),
  );
  if (englishInEvidence.length) {
    throw new Error(`Refusing to write English evidence for ${englishInEvidence.length} orgs`);
  }

  const plan = {
    generatedAt: new Date().toISOString(),
    apply,
    deadPullbacks: DEAD_PULLBACKS.length,
    typoFixes: TYPO_FIXES.length,
    languageOrgs: languages.length,
    languageBreakdown: countByLanguage(languages),
    usdCareersNote: {
      id: "d8bf710c-341d-458a-9594-118408c465db",
      url: "https://jobs.sandiego.edu/",
      note: "Live link, wrong page (careers, not the legal clinic). Manual correction later; not this batch.",
    },
    leftAsIs: [
      "3 gated 403 URLs (dioceseoffresno.org, maps-inc.org, jobs.sandiego.edu)",
      "4 HTTP/2 flakes (Community Legal Aid SoCal x3, Public Law Center)",
    ],
  };

  console.log(
    `\nURL + language corrections (${apply ? "WRITE" : "dry-run"})` +
      `\n  dead pull-backs  ${DEAD_PULLBACKS.length}` +
      `\n  typo URL fixes   ${TYPO_FIXES.length}` +
      `\n  language orgs    ${languages.length}` +
      `\n  left as-is       gated 403s + HTTP/2 flakes + USD careers page` +
      `\n  breakdown        ${JSON.stringify(plan.languageBreakdown)}\n`,
  );

  if (!apply) {
    mkdirSync(dirname(APPLY_REPORT_PATH), { recursive: true });
    writeFileSync(APPLY_REPORT_PATH, JSON.stringify({ ...plan, wrote: null }, null, 2));
    console.log(`Dry-run plan written to ${APPLY_REPORT_PATH}`);
    console.log("Re-run with --apply to write.\n");
    return;
  }

  const client = await createIngestClient();
  const failures: Array<{ id: string; step: string; error: string }> = [];

  const deadResults = await mapPool([...DEAD_PULLBACKS], 8, async (row) => {
    const { data: existing, error: readError } = await client
      .from("organizations")
      .select("id, website_url, website_scope")
      .eq("id", row.id)
      .maybeSingle();
    if (readError) {
      failures.push({ id: row.id, step: "dead-read", error: readError.message });
      return { id: row.id, ok: false, skipped: false };
    }
    if (!existing) {
      failures.push({ id: row.id, step: "dead-read", error: "row missing" });
      return { id: row.id, ok: false, skipped: false };
    }
    if (existing.website_url !== row.from) {
      return {
        id: row.id,
        ok: true,
        skipped: true,
        reason: `stored URL is ${existing.website_url ?? "null"}, expected ${row.from}`,
      };
    }
    const { data, error } = await client
      .from("organizations")
      .update({
        website_url: null,
        website_scope: null,
        website_check_error: null,
      })
      .eq("id", row.id)
      .eq("website_url", row.from)
      .select("id");
    if (error) {
      failures.push({ id: row.id, step: "dead-write", error: error.message });
      return { id: row.id, ok: false, skipped: false };
    }
    return { id: row.id, ok: Boolean(data?.length), skipped: !data?.length };
  });

  const typoResults = await mapPool([...TYPO_FIXES], 8, async (row) => {
    const to = canonicalUrl(row.to);
    const { data: existing, error: readError } = await client
      .from("organizations")
      .select("id, website_url, website_scope")
      .eq("id", row.id)
      .maybeSingle();
    if (readError) {
      failures.push({ id: row.id, step: "typo-read", error: readError.message });
      return { id: row.id, ok: false, skipped: false };
    }
    if (!existing) {
      failures.push({ id: row.id, step: "typo-read", error: "row missing" });
      return { id: row.id, ok: false, skipped: false };
    }
    if (existing.website_url === to) {
      return { id: row.id, ok: true, skipped: true, reason: "already corrected" };
    }
    if (existing.website_url !== row.from) {
      return {
        id: row.id,
        ok: true,
        skipped: true,
        reason: `stored URL is ${existing.website_url ?? "null"}, expected ${row.from}`,
      };
    }
    const { data, error } = await client
      .from("organizations")
      .update({
        website_url: to,
        website_check_error: null,
        is_website_active: true,
      })
      .eq("id", row.id)
      .eq("website_url", row.from)
      .select("id");
    if (error) {
      failures.push({ id: row.id, step: "typo-write", error: error.message });
      return { id: row.id, ok: false, skipped: false };
    }
    return { id: row.id, ok: Boolean(data?.length), skipped: !data?.length };
  });

  const languageResults = await mapPool(languages, 8, async (row) => {
    const { data: existing, error: readError } = await client
      .from("organizations")
      .select("id, languages, languages_confirmed, languages_evidence")
      .eq("id", row.id)
      .maybeSingle();
    if (readError) {
      failures.push({ id: row.id, step: "lang-read", error: readError.message });
      return { id: row.id, ok: false, skipped: false };
    }
    if (!existing) {
      failures.push({ id: row.id, step: "lang-read", error: "row missing" });
      return { id: row.id, ok: false, skipped: false };
    }

    const mergedLanguages = mergeOrganizationLanguages(
      existing.languages as string[] | null,
      row.languages,
    );
    const { data, error } = await client
      .from("organizations")
      .update({
        languages: mergedLanguages,
        languages_confirmed: true,
        languages_evidence: row.evidence,
      })
      .eq("id", row.id)
      .select("id");
    if (error) {
      failures.push({ id: row.id, step: "lang-write", error: error.message });
      return { id: row.id, ok: false, skipped: false };
    }
    return { id: row.id, ok: Boolean(data?.length), skipped: !data?.length };
  });

  mkdirSync(dirname(APPLY_REPORT_PATH), { recursive: true });
  writeFileSync(
    APPLY_REPORT_PATH,
    JSON.stringify(
      {
        ...plan,
        deadResults,
        typoResults,
        languageWrote: languageResults.filter((row) => row.ok && !row.skipped).length,
        languageSkipped: languageResults.filter((row) => row.skipped).length,
        failures,
      },
      null,
      2,
    ),
  );

  console.log(`  dead wrote     ${deadResults.filter((row) => row.ok && !row.skipped).length}`);
  console.log(`  dead skipped   ${deadResults.filter((row) => row.skipped).length}`);
  console.log(`  typo wrote     ${typoResults.filter((row) => row.ok && !row.skipped).length}`);
  console.log(`  typo skipped   ${typoResults.filter((row) => row.skipped).length}`);
  console.log(`  langs wrote    ${languageResults.filter((row) => row.ok && !row.skipped).length}`);
  console.log(`  failures       ${failures.length}`);
  console.log(`  report         ${APPLY_REPORT_PATH}\n`);

  if (failures.length) {
    throw new Error(`${failures.length} writes failed`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
