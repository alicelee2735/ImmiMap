/**
 * Locates and downloads the current EOIR List of Pro Bono Legal Service
 * Providers PDF. The published path is stable (`/file/probonofulllist/download`)
 * unlike the R&A roster's rotating media id, but the landing page is still
 * scraped first so a rename degrades to the last-known-good URL rather than
 * failing the run.
 */
import {
  EOIR_PRO_BONO_LIST_URL,
  EOIR_PRO_BONO_PAGE_URL,
  FETCH_TIMEOUT_MS,
} from "@/lib/ingestion/eoir/constants";
import type { RosterDownload } from "@/lib/ingestion/eoir/fetch-roster";

const USER_AGENT =
  "ImmiMap-ingest/1.0 (+https://github.com/immimap; public-data sync)";

async function fetchWithTimeout(
  url: string,
  accept: string,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { Accept: accept, "User-Agent": USER_AGENT },
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
}

function isPdf(data: Uint8Array): boolean {
  return (
    data.length > 4 &&
    data[0] === 0x25 &&
    data[1] === 0x50 &&
    data[2] === 0x44 &&
    data[3] === 0x46
  );
}

/**
 * Scrapes the pro bono landing page for the full-list download href.
 * Returns null when no matching anchor is found.
 */
export async function resolveProBonoUrl(): Promise<string | null> {
  const response = await fetchWithTimeout(EOIR_PRO_BONO_PAGE_URL, "text/html");
  if (!response.ok) {
    throw new Error(
      `EOIR pro bono page returned HTTP ${response.status}.`,
    );
  }

  const html = await response.text();
  const anchors = html.matchAll(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi,
  );

  for (const match of anchors) {
    const href = match[1];
    if (!href) continue;
    if (/probono/i.test(href) && /download|file|media/i.test(href)) {
      return new URL(href, EOIR_PRO_BONO_PAGE_URL).toString();
    }
  }

  return null;
}

/** Downloads the pro bono list PDF, verifying the response really is a PDF. */
export async function downloadProBonoList(): Promise<RosterDownload> {
  let sourceUrl: string | null = null;
  let usedFallbackUrl = false;

  try {
    sourceUrl = await resolveProBonoUrl();
  } catch {
    // Fall through to the known-good URL below.
  }

  if (!sourceUrl) {
    sourceUrl = EOIR_PRO_BONO_LIST_URL;
    usedFallbackUrl = true;
  }

  const response = await fetchWithTimeout(sourceUrl, "application/pdf");
  if (!response.ok) {
    throw new Error(
      `Pro bono list download failed: HTTP ${response.status} from ${sourceUrl}`,
    );
  }

  const data = new Uint8Array(await response.arrayBuffer());

  if (!isPdf(data)) {
    throw new Error(
      `Pro bono download from ${sourceUrl} is not a PDF (got ${
        response.headers.get("content-type") ?? "unknown content-type"
      }).`,
    );
  }

  return {
    data,
    sourceUrl,
    lastModified: response.headers.get("last-modified"),
    usedFallbackUrl,
  };
}
