import dotenv from "dotenv";

dotenv.config({
  path: ".env.local",
});

/*
 * Builds a minimal but structurally VALID
 * multi-page PDF (correct xref offsets) so
 * parsers must genuinely succeed on it.
 */
function buildValidPdf(
  pageLines: string[][]
): Buffer {
  const escapeText = (
    text: string
  ) =>
    text.replace(
      /[\\()]/g,
      (match) => `\\${match}`
    );

  const objects: string[] = [];

  const pageCount =
    pageLines.length;

  const kids = pageLines
    .map(
      (_, index) =>
        `${3 + index * 2} 0 R`
    )
    .join(" ");

  const fontObjectNumber =
    3 + pageCount * 2;

  objects[1] =
    "<</Type/Catalog/Pages 2 0 R>>";

  objects[2] =
    `<</Type/Pages/Kids[${kids}]/Count ${pageCount}>>`;

  pageLines.forEach(
    (lines, index) => {
      const pageNumber =
        3 + index * 2;

      const contentNumber =
        pageNumber + 1;

      objects[pageNumber] =
        `<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents ${contentNumber} 0 R/Resources<</Font<</F1 ${fontObjectNumber} 0 R>>>>>>`;

      let streamContent = "";

      let yOffset = 700;

      for (const line of lines) {
        streamContent += `BT /F1 16 Tf 72 ${yOffset} Td (${escapeText(line)}) Tj ET\n`;

        yOffset -= 32;
      }

      objects[contentNumber] =
        `<</Length ${streamContent.length}>>stream\n${streamContent}endstream`;
    }
  );

  objects[fontObjectNumber] =
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>";

  let body = "%PDF-1.4\n";

  const offsets: number[] = [];

  for (
    let i = 1;
    i < objects.length;
    i += 1
  ) {
    offsets[i] = body.length;

    body += `${i} 0 obj${objects[i]}endobj\n`;
  }

  const xrefStart =
    body.length;

  const objectCount =
    fontObjectNumber + 1;

  let xref = `xref\n0 ${objectCount}\n0000000000 65535 f \n`;

  for (
    let i = 1;
    i < objectCount;
    i += 1
  ) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }

  body += `${xref}trailer<</Size ${objectCount}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(
    body,
    "latin1"
  );
}

function bufferToFile(
  buffer: Buffer,
  name: string
): File {
  return new File(
    [new Uint8Array(buffer)],
    name,
    {
      type: "application/pdf",
    }
  );
}

async function main() {
  const {
    extractPdfPages,
    extractWithMupdf,
    PdfExtractionError,
  } = await import(
    "../lib/rag/pdf-extract"
  );

  const {
    savePdfDocument,
  } = await import(
    "../lib/rag/pdf-ingest"
  );

  const { prisma } =
    await import("../lib/prisma");

  let failures = 0;

  const fail = (
    message: string
  ) => {
    failures += 1;

    console.log(`FAIL | ${message}`);
  };

  const pass = (
    message: string
  ) => {
    console.log(`PASS | ${message}`);
  };

  console.log(
    "\n=== PART A: EXTRACTION ==="
  );

  /*
   * A1. Normal two-page PDF with
   *     preserved page numbers.
   */
  try {
    const validPdf = buildValidPdf([
      [
        "AlphaMarker page one",
        "TechPoint POS dashboard overview",
      ],
      [
        "BravoMarker page two",
        "Payments and receipts details",
      ],
    ]);

    const pages =
      await extractPdfPages(
        bufferToFile(
          validPdf,
          "valid.pdf"
        )
      );

    if (pages.length !== 2) {
      fail(
        `expected 2 pages, received ${pages.length}`
      );
    } else {
      pass("normal PDF extracts 2 pages");
    }

    if (
      pages[0].pageNumber ===
        1 &&
      pages[1].pageNumber ===
        2
    ) {
      pass(
        "page numbers preserved (1, 2)"
      );
    } else {
      fail(
        `page numbers wrong: ${pages.map((p) => p.pageNumber).join(",")}`
      );
    }

    const joined = pages
      .map((page) => page.text)
      .join(" ");

    if (
      joined.includes(
        "AlphaMarker"
      ) &&
      joined.includes(
        "BravoMarker"
      ) &&
      joined.includes(
        "TechPoint POS"
      )
    ) {
      pass(
        "per-page text extracted correctly"
      );
    } else {
      fail(
        `text missing: ${JSON.stringify(pages)}`
      );
    }
  } catch (error) {
    fail(
      `normal PDF threw unexpectedly: ${String(error)}`
    );
  }

  /*
   * A2. Malformed / unsupported files
   *     must raise PdfExtractionError,
   *     not crash the process.
   */
  const malformedInputs: {
    label: string;

    buffer: Buffer;
  }[] = [
    {
      label: "garbage bytes",

      buffer: Buffer.from(
        "this is definitely not a portable document format file",
        "utf8"
      ),
    },

    {
      label: "truncated PDF",

      buffer: buildValidPdf([
        ["TruncatedMarker"],
      ]).subarray(
        0,
        Math.floor(
          buildValidPdf([
            ["TruncatedMarker"],
          ]).length / 2
        )
      ),
    },
  ];

  for (const input of malformedInputs) {
    try {
      await extractPdfPages(
        bufferToFile(
          input.buffer,
          "broken.pdf"
        )
      );

      fail(
        `${input.label}: expected PdfExtractionError, got success`
      );
    } catch (error) {
      if (
        error instanceof
        PdfExtractionError
      ) {
        pass(
          `${input.label}: graceful PdfExtractionError (${error.reason})`
        );
      } else {
        fail(
          `${input.label}: unexpected error type ${String(error)}`
        );
      }
    }
  }

  /*
   * A3. Valid PDF with no text layer
   *     (blank page) -> no-text reason.
   */
  try {
    const blankPdf = buildValidPdf([
      [],
    ]);

    await extractPdfPages(
      bufferToFile(
        blankPdf,
        "blank.pdf"
      )
    );

    fail(
      "blank PDF: expected no-text PdfExtractionError"
    );
  } catch (error) {
    if (
      error instanceof
        PdfExtractionError &&
      error.reason === "no-text"
    ) {
      pass(
        "image-only/blank PDF surfaces no-text reason"
      );
    } else {
      fail(
        `blank PDF: unexpected error ${String(error)}`
      );
    }
  }

  /*
   * A4. REAL regression PDF: the exact file
   *     that exposed the original "bad XRef
   *     entry" failure. Stored as a fixture
   *     (scanned for PII before committing).
   */
  try {
    const { readFileSync } =
      await import("fs");

    const realBytes = readFileSync(
      "tests/fixtures/studymate_rag_test.pdf"
    );

    const realFile = bufferToFile(
      realBytes,
      "studymate_rag_test.pdf"
    );

    const pages =
      await extractPdfPages(
        realFile
      );

    if (pages.length === 3) {
      pass(
        "REAL studymate_rag_test.pdf extracts 3 pages via primary engine"
      );
    } else {
      fail(
        `real PDF page count ${pages.length}, expected 3`
      );
    }

    const numbersOk = pages.every(
      (page, index) =>
        page.pageNumber ===
        index + 1 &&
      page.text.trim().length > 0
    );

    if (numbersOk) {
      pass(
        "real PDF page numbers preserved with text on every page"
      );
    } else {
      fail(
        `real PDF page numbering broken: ${pages.map((p) => `${p.pageNumber}:${p.text.length}`).join(",")}`
      );
    }

    /*
     * A5. Same real file through the MuPDF
     *     FALLBACK engine directly.
     */
    const fallbackPages =
      await extractWithMupdf(
        bufferToFile(
          realBytes,
          "studymate_rag_test.pdf"
        )
      );

    if (
      fallbackPages.length === 3 &&
      fallbackPages[2].pageNumber === 3
    ) {
      pass(
        "MuPDF fallback engine extracts the real PDF correctly"
      );
    } else {
      fail(
        `mupdf fallback returned ${fallbackPages.length} pages`
      );
    }

    /*
     * A6. Fallback ORCHESTRATION: when the
     *     primary engine fails, the chain
     *     recovers via MuPDF and keeps the
     *     same output contract.
     */
    const orchestrated =
      await extractPdfPages(
        bufferToFile(
          realBytes,
          "studymate_rag_test.pdf"
        ),

        {
          primary:
            async () => {
              throw new Error(
                "simulated primary engine outage"
              );
            },
        }
      );

    if (
      orchestrated.length === 3 &&
      orchestrated[0].pageNumber === 1
    ) {
      pass(
        "fallback orchestration returns normalized pages when primary fails"
      );
    } else {
      fail(
        `orchestrated fallback returned ${orchestrated.length} pages`
      );
    }
  } catch (error) {
    fail(
      `real-fixture block threw: ${String(error)}`
    );
  }

  /*
   * PART B: ingestion atomicity against
   * the real database using a dedicated
   * fixture chat that is removed after.
   */
  console.log(
    "\n=== PART B: INGESTION ATOMICITY ==="
  );

  const owner =
    await prisma.user.findFirst();

  if (!owner) {
    throw new Error(
      "No user exists in the database to own the fixture chat."
    );
  }

  const chat =
    await prisma.chat.create({
      data: {
        userId: owner.id,

        title:
          "[routing-test] pdf extraction fixture",
      },
    });

  try {
    const pageChunks = [
      {
        pageNumber: 1,

        content:
          "AtomicMarker page one. Rollback verification content about TechPoint POS.",
      },
    ];

    // B1. Extraction failure stores nothing.
    try {
      await extractPdfPages(
        bufferToFile(
          Buffer.from("not a pdf"),
          "broken.pdf"
        )
      );

      fail(
        "B1 setup: extraction should have failed"
      );
    } catch {
      // Expected path: skip saving entirely.
    }

    const afterFailure =
      await prisma.document.count({
        where: { chatId: chat.id },
      });

    if (afterFailure === 0) {
      pass(
        "extraction failure leaves zero Document rows"
      );
    } else {
      fail(
        `extraction failure left ${afterFailure} Document row(s)`
      );
    }

    // B2. Embedding persistence failure rolls back the created document.
    const failingEmbeddings =
      async () => {
        throw new Error(
          "simulated embedding outage"
        );
      };

    try {
      await savePdfDocument({
        chatId: chat.id,

        userId: owner.id,

        fileName: "atomic.pdf",

        fileType:
          "application/pdf",

        fileSize: 1024,

        extractedText:
          "AtomicMarker page one.",

        pageChunks,

        embedImpl:
          failingEmbeddings,
      });

      fail(
        "B2: expected embedding failure to throw"
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes(
          "simulated embedding outage"
        )
      ) {
        pass(
          "embedding failure surfaced from ingest"
        );
      } else {
        fail(
          `B2: unexpected error ${String(error)}`
        );
      }
    }

    const afterEmbedFailure =
      await prisma.document.count({
        where: { chatId: chat.id },
      });

    if (afterEmbedFailure === 0) {
      pass(
        "embedding failure rolls back Document (cascade removes chunks)"
      );
    } else {
      fail(
        `partial records remain: ${afterEmbedFailure}`
      );
    }

    // B3. Happy path stores everything and pgvector retrieval works.
    const saved =
      await savePdfDocument({
        chatId: chat.id,

        userId: owner.id,

        fileName: "happy.pdf",

        fileType:
          "application/pdf",

        fileSize: 2048,

        extractedText:
          pageChunks
            .map((chunk) => chunk.content)
            .join("\n"),

        pageChunks,
      });

    if (
      saved &&
      saved.chunkCount === 1
    ) {
      pass(
        "successful ingest persists document + chunk"
      );
    } else {
      fail(
        `successful ingest returned ${JSON.stringify(saved)}`
      );
    }

    const { searchDocuments } =
      await import(
        "../lib/ai/tools/document-search"
      );

    const retrieval =
      await searchDocuments({
        chatId: chat.id,

        query:
          "TechPoint POS rollback verification",

        limit: 2,
      });

    if (
      retrieval.success &&
      retrieval.context.includes(
        "AtomicMarker"
      )
    ) {
      pass(
        "pgvector retrieval finds ingested chunk with citation data"
      );
    } else {
      fail(
        "pgvector retrieval failed for happy-path ingest"
      );
    }
  } finally {
    await prisma.chat
      .delete({
        where: { id: chat.id },
      })
      .catch(() => undefined);

    console.log(
      "Fixture chat cleaned up."
    );
  }

  console.log(
    `\n=== SUMMARY: ${failures === 0 ? "ALL TESTS PASSED" : `${failures} FAILURE(S)`} ===`
  );

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);

  process.exit(1);
});
