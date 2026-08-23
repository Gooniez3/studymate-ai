/*
 * Page-aware PDF text extraction with a
 * two-engine robustness chain:
 *
 *   attempt 1: pdfjs-dist (Mozilla, fast)
 *       ↓ fails to parse
 *   attempt 2: MuPDF (WASM, repairs many
 *              malformed PDF structures)
 *       ↓ fails
 *   PdfExtractionError("unreadable")
 *
 * Both engines normalize to:
 *   [{ pageNumber: number, text: string }, ...]
 * because RAG citations display page numbers.
 */

export type ExtractedPdfPage = {
  pageNumber: number;
  text: string;
};

export class PdfExtractionError extends Error {
  /*
   * "unreadable": both engines failed to parse.
   * "no-text": parsed but contains no text layer.
   */
  readonly reason:
    | "unreadable"
    | "no-text";

  constructor(
    reason: "unreadable" | "no-text",
    message: string,
    cause?: unknown
  ) {
    super(message);

    this.name =
      "PdfExtractionError";

    this.reason = reason;

    if (
      cause !== undefined
    ) {
      this.cause = cause;
    }
  }
}

type PdfTextItem = {
  str?: string;

  transform?: number[];

  hasEOL?: boolean;
};

type PdfJsPage = {
  getTextContent: () => Promise<{
    items: unknown[];
  }>;

  cleanup?: () => void;
};

type PdfJsDocument = {
  numPages: number;

  getPage: (
    pageNumber: number
  ) => Promise<PdfJsPage>;
};

type PdfJsLoadingTask = {
  promise: Promise<PdfJsDocument>;

  /*
   * pdf.js v6 exposes teardown on the
   * loading task rather than the
   * document proxy.
   */
  destroy?: () => Promise<void>;
};

type PdfJsModule = {
  getDocument: (options: {
    data: Uint8Array;

    isEvalSupported?: boolean;

    verbosity?: number;
  }) => PdfJsLoadingTask;
};

type MupdfDocument = {
  countPages: () => number;

  loadPage: (index: number) => {
    toStructuredText: () => {
      asText: () => string;
    };

    destroy?: () => void;
  };

  destroy?: () => void;
};

type MupdfModule = {
  Document: {
    openDocument: (
      data: Uint8Array,

      mimeType: string
    ) => MupdfDocument;
  };
};

let pdfjsModulePromise: Promise<PdfJsModule> | null =
  null;

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsModulePromise) {
    pdfjsModulePromise =
      import(
        "pdfjs-dist/legacy/build/pdf.mjs"
      ) as Promise<PdfJsModule>;
  }

  try {
    return await pdfjsModulePromise;
  } catch (error) {
    pdfjsModulePromise =
      null;

    throw error;
  }
}

function logEngineFailure(
    engine: string,

    stage: string,

    error: unknown
  ) {
    /*
     * Structural metadata only - never dump
     * document bytes or extracted content.
     */
    const detail =
      error instanceof Error
        ? `${error.name}: ${error.message}${
            (error as { details?: unknown }).details
              ? ` | details: ${(error as { details?: unknown }).details}`
              : ""
          }`
        : String(error);

    console.error(
      `[pdf-extract] ${engine} ${stage} failed: ${detail.slice(0, 300)}`
    );
  }

function cleanPageText(
  pageText: string
): string {
  return pageText
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/*
 * Engine 1 - pdf.js (pdfjs-dist).
 */
export async function extractWithPdfJs(
  file: File
): Promise<ExtractedPdfPage[]> {
  const arrayBuffer =
    await file.arrayBuffer();

  const data = new Uint8Array(
    arrayBuffer
  );

  const pdfjs =
    await loadPdfJs();

  let document: PdfJsDocument;

  let loadingTask: PdfJsLoadingTask;

  try {
    loadingTask =
      pdfjs.getDocument({
        data,

        isEvalSupported: false,

        verbosity: 0,
      });

    document =
      await loadingTask.promise;
  } catch (error) {
    logEngineFailure(
      "pdfjs",
      "document open",
      error
    );

    throw error;
  }

  const pages: ExtractedPdfPage[] =
    [];

  try {
    for (
      let pageNumber = 1;
      pageNumber <=
      document.numPages;
      pageNumber += 1
    ) {
      const page =
        await document.getPage(
          pageNumber
        );

      const textContent =
        await page.getTextContent();

      let lastY: number | null =
        null;

      let pageText = "";

      for (const rawItem of textContent.items) {
        const item =
          rawItem as PdfTextItem;

        const text =
          typeof item.str ===
          "string"
            ? item.str
            : "";

        const currentY =
          Array.isArray(item.transform)
            ? item.transform[5]
            : null;

        if (!text) {
          if (item.hasEOL) {
            pageText += "\n";

            lastY = null;
          }

          continue;
        }

        if (
          lastY !== null &&
          currentY !== null &&
          currentY !== lastY
        ) {
          pageText += "\n";
        } else if (pageText) {
          pageText += " ";
        }

        pageText += text;

        if (
          currentY !== null
        ) {
          lastY = currentY;
        }

        if (item.hasEOL) {
          pageText += "\n";

          lastY = null;
        }
      }

      pages.push({
        pageNumber,

        text: cleanPageText(
          pageText
        ),
      });

      page.cleanup?.();
    }
  } catch (error) {
    logEngineFailure(
      "pdfjs",
      `page loop (after ${pages.length} pages)`,
      error
    );

    throw error;
  } finally {
    await loadingTask
      .destroy?.()
      .catch(() => undefined);
  }

  return pages;
}

/*
 * Engine 2 - MuPDF (WASM). Tolerates and
 * repairs many malformed PDF structures
 * that stricter parsers reject.
 */
export async function extractWithMupdf(
  file: File
): Promise<ExtractedPdfPage[]> {
  const arrayBuffer =
    await file.arrayBuffer();

  const data = new Uint8Array(
    arrayBuffer
  );

  const mupdf =
    (await import("mupdf")) as unknown as MupdfModule;

  let document: MupdfDocument;

  try {
    document =
      mupdf.Document.openDocument(
        data,
        "application/pdf"
      );
  } catch (error) {
    logEngineFailure(
      "mupdf",
      "document open",
      error
    );

    throw error;
  }

  const pages: ExtractedPdfPage[] =
    [];

  try {
    const pageCount =
      document.countPages();

    for (
      let index = 0;
      index < pageCount;
      index += 1
    ) {
      const page =
        document.loadPage(index);

      const pageText =
        page.toStructuredText().asText();

      pages.push({
        pageNumber: index + 1,

        text: cleanPageText(
          pageText
        ),
      });

      page.destroy?.();
    }
  } catch (error) {
    logEngineFailure(
      "mupdf",
      `page loop (after ${pages.length} pages)`,
      error
    );

    throw error;
  } finally {
    document.destroy?.();
  }

  return pages;
}

export type PdfExtractionEngines = {
  primary?: (
    file: File
  ) => Promise<ExtractedPdfPage[]>;

  fallback?: (
    file: File
  ) => Promise<ExtractedPdfPage[]>;
};

/*
 * Orchestrates the engine chain. The optional
 * engines parameter exists so tests can inject
 * a failing primary and exercise the fallback.
 */
export async function extractPdfPages(
  file: File,

  engines: PdfExtractionEngines = {}
): Promise<ExtractedPdfPage[]> {
  const primary =
    engines.primary ??
    extractWithPdfJs;

  const fallback =
    engines.fallback ??
    extractWithMupdf;

  let primaryError: unknown;

  try {
    const pages =
      await primary(file);

    return assertHasText(pages);
  } catch (error) {
    /*
     * A successfully parsed document without
     * a text layer is a final verdict - the
     * fallback cannot invent text either.
     */
    if (
      error instanceof
        PdfExtractionError &&
      error.reason === "no-text"
    ) {
      throw error;
    }

    primaryError = error;
  }

  console.log(
    "[pdf-extract] primary engine failed - trying MuPDF fallback"
  );

  try {
    const pages =
      await fallback(file);

    console.log(
      `[pdf-extract] MuPDF fallback succeeded (${pages.length} pages)`
    );

    return assertHasText(pages);
  } catch (fallbackError) {
    if (
      fallbackError instanceof
        PdfExtractionError &&
      fallbackError.reason ===
        "no-text"
    ) {
      throw fallbackError;
    }

    logEngineFailure(
      "mupdf",
      "final",
      fallbackError
    );

    throw new PdfExtractionError(
      "unreadable",
      "This PDF could not be parsed. It may be damaged or use an unsupported PDF structure.",
      primaryError ?? fallbackError
    );
  }
}

function assertHasText(
  pages: ExtractedPdfPage[]
): ExtractedPdfPage[] {
  const hasAnyText = pages.some(
    (page) =>
      page.text.trim().length > 0
  );

  if (!hasAnyText) {
    throw new PdfExtractionError(
      "no-text",
      "This PDF looks image-based. Text could not be extracted."
    );
  }

  return pages;
}
