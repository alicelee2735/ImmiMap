/**
 * Coordinate-aware PDF text extraction for the EOIR rosters.
 *
 * EOIR publishes its rosters only as PDFs, and the text streams are heavily
 * fragmented (numbers are frequently emitted as their own runs, so a street
 * number and its street name arrive separately). Grouping runs back into
 * visual lines by their y-coordinate — rather than trusting the stream order —
 * is what makes the roster parseable at all.
 *
 * X positions are preserved because the Pro Bono list is a two-column layout
 * whose columns interleave when flattened to plain text.
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** A single text run with its position on the page. */
export type PdfTextRun = {
  text: string;
  x: number;
  y: number;
  width: number;
};

/** Text runs grouped into one visual line, ordered left to right. */
export type PdfLine = {
  page: number;
  y: number;
  runs: PdfTextRun[];
  /** Runs joined with whitespace normalized; the primary parser input. */
  text: string;
};

export type PdfPage = {
  page: number;
  width: number;
  height: number;
  lines: PdfLine[];
};

/**
 * Runs whose baselines differ by less than this are treated as one line.
 * The rosters use ~15pt leading, so 2pt absorbs sub/superscript jitter
 * without merging adjacent rows.
 */
const LINE_TOLERANCE_PT = 2;

/**
 * Gap between the end of one run and the start of the next that implies a
 * real space. Below this the runs are a single fragmented word (e.g. the
 * "4455" + "Narrow Lane Road" split).
 */
const WORD_GAP_PT = 1.2;

/** Joins runs on one visual line, inserting a space only when the gap is real. */
export function joinRuns(runs: PdfTextRun[]): string {
  let out = "";

  for (let i = 0; i < runs.length; i += 1) {
    const run = runs[i];
    if (i === 0) {
      out = run.text;
      continue;
    }

    const previous = runs[i - 1];
    const gap = run.x - (previous.x + previous.width);
    const needsSpace =
      gap > WORD_GAP_PT && !out.endsWith(" ") && !run.text.startsWith(" ");

    out += needsSpace ? ` ${run.text}` : run.text;
  }

  return out.replace(/\s+/g, " ").trim();
}

function groupIntoLines(runs: PdfTextRun[], page: number): PdfLine[] {
  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PdfLine[] = [];

  for (const run of sorted) {
    const current = lines[lines.length - 1];
    if (current && Math.abs(current.y - run.y) <= LINE_TOLERANCE_PT) {
      current.runs.push(run);
      continue;
    }
    lines.push({ page, y: run.y, runs: [run], text: "" });
  }

  for (const line of lines) {
    line.runs.sort((a, b) => a.x - b.x);
    line.text = joinRuns(line.runs);
  }

  return lines.filter((line) => line.text.length > 0);
}

/** Extracts every page of a PDF into position-aware visual lines. */
export async function extractPdfPages(data: Uint8Array): Promise<PdfPage[]> {
  const loadingTask = getDocument({
    data,
    // The rosters are plain text documents; skip the extra network/CPU cost.
    disableFontFace: true,
    useSystemFonts: false,
  });
  const doc = await loadingTask.promise;

  try {
    const pages: PdfPage[] = [];

    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();

      const runs: PdfTextRun[] = [];
      for (const item of content.items) {
        if (!("str" in item) || typeof item.str !== "string") continue;
        if (item.str.trim().length === 0) continue;

        runs.push({
          text: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: typeof item.width === "number" ? item.width : 0,
        });
      }

      pages.push({
        page: pageNumber,
        width: viewport.width,
        height: viewport.height,
        lines: groupIntoLines(runs, pageNumber),
      });

      page.cleanup();
    }

    return pages;
  } finally {
    await loadingTask.destroy();
  }
}

/** Flattens extracted pages to an ordered list of visual lines. */
export function flattenLines(pages: PdfPage[]): PdfLine[] {
  return pages.flatMap((page) => page.lines);
}
