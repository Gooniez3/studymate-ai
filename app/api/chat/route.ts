import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  retrieveDocumentChunks,
  type RetrievedChunk,
} from "@/lib/rag/retriever";
import {
  createAITextStream,
  createAICompletion,
  createAIStructuredCompletion,
  type ChatMessage,
} from "@/lib/ai/provider";
import {
  searchRewritePrompt,
  webVerificationPrompt,
  searchRewriteSchema,
  getModePrompt,
  getPdfRules,
} from "@/lib/ai/prompts";
import {
  searchWebMultiple,
  type SearchWebResult,
} from "@/lib/ai/tools/web-search";

import { HumanMessage, AIMessage } from "@langchain/core/messages";

import {
  studyMateGraph,
} from "@/lib/ai/graph/graph";

import {
  extractPdfPages,
  PdfExtractionError,
} from "@/lib/rag/pdf-extract";

import {
  savePdfDocument,
} from "@/lib/rag/pdf-ingest";

type ClientMessage = {
  role: "user" | "assistant";
  content: string;
  attachment?: {
    name: string;
    type: string;
    size: number;
  } | null;
};





function extractUsedEvidenceIndexes(
  text: string,
  maxEvidence: number
): number[] {
  const matches =
    text.matchAll(
      /\[EVIDENCE_(\d+)\]/g
    );

  const indexes = new Set<number>();

  for (const match of matches) {
    const evidenceNumber =
      Number(match[1]);

    if (
      Number.isInteger(evidenceNumber) &&
      evidenceNumber >= 1 &&
      evidenceNumber <= maxEvidence
    ) {
      indexes.add(
        evidenceNumber - 1
      );
    }
  }

  return [...indexes];
}



function removeModelSources(text: string): string {
  return text
    .replace(/\n+---\s*\n*#{0,3}\s*\*?\*?Sources?\*?\*?[\s\S]*$/i, "")
    .replace(/\n+#{1,6}\s*Sources?[\s\S]*$/i, "")
    .replace(/\n+\*?\*?Sources?\*?\*?[\s\S]*$/i, "")
    .replace(/\[\d+\]/g, "")
    .trim();
}

function truncateText(text: string, maxChars: number) {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(
    0,
    maxChars
  )}\n\n[PDF content truncated because it is too long.]`;
}

type ExtractedPdfPage = {
  pageNumber: number;
  text: string;
};

/*
 * Friendly user-facing failures must reach the
 * frontend through the normal streaming protocol,
 * otherwise the client throws "No stream returned."
 * when a non-200/plain-error response arrives.
 */
function streamTextResponse(
  text: string
): Response {
  const encoder =
    new TextEncoder();

  const stream =
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(text)
        );

        controller.close();
      },
    });

  return new Response(stream, {
    headers: {
      "Content-Type":
        "text/plain; charset=utf-8",

      "Cache-Control":
        "no-cache, no-transform",

      Connection: "keep-alive",
    },
  });
}

async function parseRequest(req: NextRequest): Promise<{
  messages: ClientMessage[];
  webSearchEnabled: boolean;
  mode: string;
  file: File | null;
  chatId: string | null;
}> {
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();

    const messagesRaw = formData.get("messages");
    const modeRaw = formData.get("mode");
    const webSearchRaw = formData.get("webSearchEnabled");
    const fileRaw = formData.get("file");
    const chatIdRaw = formData.get("chatId");

    const messages =
      typeof messagesRaw === "string" ? JSON.parse(messagesRaw) : [];

    return {
      messages,
      mode: typeof modeRaw === "string" ? modeRaw : "default",
      webSearchEnabled: webSearchRaw === "true",
      file: fileRaw instanceof File ? fileRaw : null,
      chatId: typeof chatIdRaw === "string" ? chatIdRaw : null,
    };
  }

  const body = await req.json();

  return {
    messages: body.messages || [],
    mode: body.mode || "default",
    webSearchEnabled: body.webSearchEnabled || false,
    file: null,
    chatId: body.chatId || null,
  };
}

function chunkDocumentText(
  text: string,
  maxChars = 1800,
  overlapChars = 250
): string[] {
  const cleaned = text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!cleaned) {
    return [];
  }

  if (cleaned.length <= maxChars) {
    return [cleaned];
  }

  const chunks: string[] = [];

  let start = 0;

  while (start < cleaned.length) {
    let end = Math.min(
      start + maxChars,
      cleaned.length
    );

    if (end < cleaned.length) {
      const minimumBreakPoint =
        start + Math.floor(maxChars * 0.6);

      const window =
        cleaned.slice(
          minimumBreakPoint,
          end
        );

      const paragraphBreak =
        window.lastIndexOf("\n\n");

      const sentenceBreak =
        window.lastIndexOf(". ");

      const lineBreak =
        window.lastIndexOf("\n");

      const spaceBreak =
        window.lastIndexOf(" ");

      const bestBreak = Math.max(
        paragraphBreak >= 0
          ? paragraphBreak + 2
          : -1,
        sentenceBreak >= 0
          ? sentenceBreak + 2
          : -1,
        lineBreak >= 0
          ? lineBreak + 1
          : -1,
        spaceBreak
      );

      if (bestBreak >= 0) {
        end =
          minimumBreakPoint +
          bestBreak;
      }
    }

    const chunk =
      cleaned
        .slice(start, end)
        .trim();

    if (chunk) {
      chunks.push(chunk);
    }

    if (end >= cleaned.length) {
      break;
    }

    const nextStart =
      Math.max(
        end - overlapChars,
        start + 1
      );

    start = nextStart;
  }

  return chunks;
}


async function rewriteSearchQueries(
  messages: ChatMessage[],
  currentDate: string
): Promise<string[]> {
  const recentMessages = messages.slice(-6);

  const formattedPrompt =
  await searchRewritePrompt.formatMessages({
    currentDate,
  });

const rewritePrompt: ChatMessage[] = [
  ...formattedPrompt.map((message) => ({
    role:
      message._getType() === "system"
        ? ("system" as const)
        : message._getType() === "ai"
          ? ("assistant" as const)
          : ("user" as const),
    content:
      typeof message.content === "string"
        ? message.content
        : "",
  })),

  ...recentMessages,
];;

  try {
    const completion =
  await createAIStructuredCompletion(
    rewritePrompt,
    searchRewriteSchema,
    "search_query_rewrite",
    {
      /*
       * Query rewriting is control-plane work -
       * the small fast model is sufficient.
       */
      preferFastModel: true,
    }
  );

const queries =
  completion.data.queries
    .map((query) =>
      query
        .trim()
        .replace(/^["']|["']$/g, "")
        .replace(/\.$/, "")
        .trim()
    )
    .filter(Boolean)
    .slice(0, 2);

if (queries.length === 0) {
  return [
    messages.at(-1)?.content || "",
  ];
}

return queries;
  } catch (error) {
    console.error(
      "Search query rewrite failed:",
      error
    );

    return [messages.at(-1)?.content || ""];
  }
}
async function verifyWebEvidence(
  userQuestion: string,
  searchQuery: string,
  searchContext: string
): Promise<string> {
  const formattedPrompt =
  await webVerificationPrompt.formatMessages({
    userQuestion,
    searchQuery,
    searchContext,
  });

const verificationMessages: ChatMessage[] =
  formattedPrompt.map((message) => ({
    role:
      message._getType() === "system"
        ? ("system" as const)
        : message._getType() === "ai"
          ? ("assistant" as const)
          : ("user" as const),
    content:
      typeof message.content === "string"
        ? message.content
        : "",
  }));

  try {
  const completion =
    await createAICompletion(
      verificationMessages,
      {
        temperature: 0,
        maxTokens: 500,
      }
    );

  return (
    completion.content.trim() ||
    "VERDICT: INSUFFICIENT\n\nVERIFIED:\n- None\n\nNOT VERIFIED:\n- Evidence verification failed.\n\nCONFLICTS:\n- None"
  );
} catch (error) {
  console.error(
    "Web evidence verification failed:",
    error
  );

  return `
VERDICT: INSUFFICIENT

VERIFIED:
- None

NOT VERIFIED:
- Evidence verification could not be completed.

CONFLICTS:
- None
  `.trim();
}
}

type VerificationReason =
  | "current"
  | "regulated"
  | "normal";

function classifyVerificationNeed(
  question: string
): {
  requiresVerification: boolean;
  reason: VerificationReason;
} {
  const text = question
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  // Current / fast-changing information
  const currentPatterns = [
    /\bcurrent\b/,
    /\blatest\b/,
    /\btoday\b/,
    /\btonight\b/,
    /\bright now\b/,
    /\bnow\b/,
    /\brecent\b/,
    /\blive\b/,
    /\bthis week\b/,
    /\bthis month\b/,
    /\bthis year\b/,
    /\bprice\b/,
    /\bcost\b/,
    /\bexchange rate\b/,
    /\bstock price\b/,
    /\bweather\b/,
    /\bforecast\b/,
    /\branking\b/,
    /\brichest\b/,
  ];

  if (
    currentPatterns.some((pattern) =>
      pattern.test(text)
    )
  ) {
    return {
      requiresVerification: true,
      reason: "current",
    };
  }

  // Legal / immigration / employment / regulated information
  const regulatedPatterns = [
    /\bvisa\b/,
    /\bstudent pass\b/,
    /\bwork permit\b/,
    /\bemployment pass\b/,
    /\bwork authorization\b/,
    /\bwork eligibility\b/,
    /\bimmigration\b/,
    /\bmom\b/,
    /\bministry of manpower\b/,
    /\binternational student\b/,
    /\binternational students\b/,
    /\bprivate school\b.*\bwork\b/,
    /\bprivate institution\b.*\bwork\b/,
    /\bpart[- ]?time work\b/,
    /\bcan i work\b/,
    /\ballowed to work\b/,
    /\blegally work\b/,
    /\btax law\b/,
    /\bemployment law\b/,
    /\blabor law\b/,
    /\blabour law\b/,
  ];

  if (
    regulatedPatterns.some((pattern) =>
      pattern.test(text)
    )
  ) {
    return {
      requiresVerification: true,
      reason: "regulated",
    };
  }

  return {
    requiresVerification: false,
    reason: "normal",
  };
}
export async function POST(req: NextRequest) {
  try {
    const {
      messages,
      webSearchEnabled = false,
      mode = "default",
      file,
      chatId,
    } = await parseRequest(req);

    const session = await auth();

    if (!session?.user?.id) {
      return new Response("Unauthorized", {
        status: 401,
      });
    }

    if (
      !Array.isArray(messages) ||
      messages.length === 0
    ) {
      return new Response("Messages are required.", {
        status: 400,
      });
    }

    let pdfContext = "";
    let pdfFileName = "";

    /*
     * Document facts used by the router:
     * which documents actually exist for this
     * chat and whether a PDF was attached to
     * this very request.
     */
    let documentNames: string[] = [];
    let documentAttachedThisTurn = false;

    if (file) {
      if (file.type !== "application/pdf") {
        return new Response(
          "Only PDF files are supported for now.",
          {
            status: 400,
          }
        );
      }

      if (file.size > 10 * 1024 * 1024) {
        return new Response(
          "PDF must be under 10MB.",
          {
            status: 400,
          }
        );
      }

      pdfFileName = file.name;

      console.log("Starting PDF extraction");

      const extractionStartedAt =
        performance.now();

      /*
       * Extraction failures are user-facing
       * conditions, not server errors: they are
       * reported through the normal streaming
       * protocol so the frontend renders the
       * message instead of "No stream returned."
       */
      let pages: ExtractedPdfPage[];

      try {
        pages =
          await extractPdfPages(file);
      } catch (error) {
        if (
          error instanceof
          PdfExtractionError
        ) {
          console.error(
            "PDF extraction failed:",
            error.message,
            error.reason
          );

          if (
            error.reason === "no-text"
          ) {
            return streamTextResponse(
              "This PDF looks image-based. Text could not be extracted. Try a text-based PDF or run OCR on it first."
            );
          }

          return streamTextResponse(
            "I couldn't read this PDF. The file may be damaged or use an unsupported PDF format. Try re-exporting or printing it to PDF and upload it again."
          );
        }

        throw error;
      }

      console.log(
        `[perf] pdf extraction: ${Math.round(
          performance.now() -
            extractionStartedAt
        )}ms`
      );

console.log(
  "PDF extraction complete:",
  {
    pages: pages.length,
  }
);

const usablePages =
  pages.filter(
    (page) =>
      page.text.trim().length > 0
  );

if (usablePages.length === 0) {
  return streamTextResponse(
    "This PDF looks image-based. Text could not be extracted. Try a text-based PDF or run OCR on it first."
  );
}

// Keep the complete extracted text on the Document
// for compatibility with the existing system.
const extractedText =
  usablePages
    .map((page) => page.text)
    .join("\n\n");

// Chunk each page separately so chunks never
// lose their original PDF page number.
const pageAwareChunks =
  usablePages.flatMap((page) =>
    chunkDocumentText(page.text).map(
      (content) => ({
        pageNumber: page.pageNumber,
        content,
      })
    )
  );

if (pageAwareChunks.length === 0) {
  return streamTextResponse(
    "No readable text could be prepared from this PDF. Try re-exporting it and upload it again."
  );
}

console.log(
  "Page-aware PDF chunking:",
  {
    pages: usablePages.length,
    chunks: pageAwareChunks.length,
  }
);

if (chatId) {
  try {
    const savedDocument =
      await savePdfDocument({
        chatId,

        userId:
          session.user.id,

        fileName: file.name,

        fileType: file.type,

        fileSize: file.size,

        extractedText,

        pageChunks:
          pageAwareChunks,
      });

    if (savedDocument) {
      documentNames = [
        savedDocument.name,
      ];

      documentAttachedThisTurn =
        true;

      console.log(
        "RAG document stored:",
        {
          documentId:
            savedDocument.documentId,

          name:
            savedDocument.name,

          characters:
            extractedText.length,

          pages:
            usablePages.length,

          chunks:
            savedDocument.chunkCount,
        }
      );
    }
  } catch (error) {
    /*
     * savePdfDocument rolls back partial
     * records internally; here we surface a
     * friendly streaming message instead of
     * a generic 500.
     */
    console.error(
      "PDF ingestion failed:",
      error
    );

    return streamTextResponse(
      "I read your PDF but couldn't prepare it for search. The upload was not saved - please try again."
    );
  }
}
}
     if (!file && chatId) {
  const existingChat =
    await prisma.chat.findFirst({
      where: {
        id: chatId,
        userId: session.user.id,
      },
      include: {
        documents: {
          select: {
            name: true,
          },
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

  const savedDocs =
    existingChat?.documents ?? [];

  if (savedDocs.length > 0) {
    documentNames = savedDocs
      .map((doc) => doc.name);

    pdfFileName = documentNames.join(
      ", "
    );
  }
}

    const currentDate =
      new Date().toLocaleString("en-SG", {
        timeZone: "Asia/Singapore",
        dateStyle: "full",
        timeStyle: "short",
      });

      const graphMessages = messages
  .filter(
    (msg: ClientMessage) =>
      msg &&
      (msg.role === "user" ||
        msg.role === "assistant") &&
      typeof msg.content === "string" &&
      msg.content.trim() !== ""
  )
  .slice(-8)
  .map((msg: ClientMessage) => {
    if (msg.role === "user") {
      return new HumanMessage(
        msg.content.trim()
      );
    }

    return new AIMessage(
      msg.content.trim()
    );
  });
const graphThreadId =
  chatId
    ? `chat:${chatId}`
    : `ephemeral:${session.user.id}:${crypto.randomUUID()}`;

const requestStartedAt =
  performance.now();

const graphEncoder =
  new TextEncoder();

/*
 * True streaming setup: the Response is
 * returned immediately, and answer tokens
 * are forwarded into it by the graph's
 * response node through the configurable
 * onToken callback while generation is
 * still running.
 */
/*
 * Holder object defeats TypeScript control-flow
 * narrowing across closures (the controller is
 * assigned inside the stream's start callback).
 */
const streamState: {
  controller: ReadableStreamDefaultController<Uint8Array> | null;
} = {
  controller: null,
};

const appendToStream = (
  text: string
) => {
  const controller =
    streamState.controller;

  if (!controller) {
    return;
  }

  try {
    controller.enqueue(
      graphEncoder.encode(text)
    );
  } catch {
    /*
     * Client disconnected mid-stream -
     * stop writing but let the graph run
     * to completion so checkpoints stay
     * consistent.
     */
    streamState.controller =
      null;
  }
};

let streamedAnyToken = false;

const graphReadableStream =
  new ReadableStream<Uint8Array>({
    start(controller) {
      streamState.controller =
        controller;
    },

    cancel() {
      streamState.controller =
        null;
    },
  });

void (async () => {
  try {
    const graphResult =
      await studyMateGraph.invoke(
        {
          messages: graphMessages,

          chatId,

          mode:
            mode === "exam" ||
            mode === "assignment" ||
            mode === "career"
              ? mode
              : "default",

          webSearchEnabled,

          /*
           * `route` is intentionally NOT reset
           * here: the checkpointed value from the
           * previous turn is what allows the
           * router to detect document follow-ups.
           * The router always sets a fresh route.
           */

          documentNames,

          documentAttachedThisTurn,

          documentContext: "",

          webContext: "",

          verificationContext: "",

          response: "",

          webSources: [],

          documentCitations: [],

          error: null,
        },
        {
          configurable: {
            thread_id:
              graphThreadId,

            onToken: (delta: string) => {
              streamedAnyToken =
                true;

              appendToStream(delta);
            },
          },
        }
      );

    console.log(
      "API LangGraph result:",
      {
        route: graphResult.route,
        responseLength:
          graphResult.response
            .length,
        webSources:
          graphResult.webSources
            ?.length ?? 0,
        documentCitations:
          graphResult.documentCitations
            ?.length ?? 0,
        error: graphResult.error,
      }
    );

    console.log(
      `[perf] total request: ${Math.round(
        performance.now() -
          requestStartedAt
      )}ms`
    );

    /*
     * Non-streamed answers (quiz summaries,
     * graceful retrieval-error replies) are
     * short - send them in one piece so the
     * existing UI protocol stays intact.
     */
    if (
      !streamedAnyToken &&
      graphResult.response
    ) {
      appendToStream(
        graphResult.response
      );
    }

    if (
      graphResult.webSources &&
      graphResult.webSources.length > 0
    ) {
      const sourcesBlock =
        graphResult.webSources
          .map(
            (source) =>
              `- [${source.title}](${source.url})`
          )
          .join("\n");

      appendToStream(
        `\n\n---\n\n**Sources**\n\n${sourcesBlock}`
      );
    }

    if (
      graphResult.documentCitations &&
      graphResult.documentCitations
        .length > 0
    ) {
      const documentSourcesBlock =
        graphResult.documentCitations
          .map(
            (citation) =>
              `- [${citation.evidenceNumber}] ${citation.documentName}${
                citation.pageNumber !==
                null
                  ? ` · Page ${citation.pageNumber}`
                  : ""
              }`
          )
          .join("\n");

      appendToStream(
        `\n\n---\n\n**Document Sources**\n\n${documentSourcesBlock}`
      );
    }

    if (
      graphResult.route === "quiz" &&
      graphResult.quizData
    ) {
      const quizMetadata =
        JSON.stringify({
          type: "quiz",
          data: graphResult.quizData,
        });

      appendToStream(
        `\n\n__STUDYMATE_QUIZ__${quizMetadata}__END_STUDYMATE_QUIZ__`
      );
    }

    streamState.controller?.close();
  } catch (streamError) {
    console.error(
      "LangGraph streaming failed:",
      streamError
    );

    appendToStream(
      "\n\nStudyMate AI could not complete that response. Please try again."
    );

    try {
      streamState.controller?.close();
    } catch {
      // Already closed.
    }
  }
})();

return new Response(
  graphReadableStream,
  {
    headers: {
      "Content-Type":
        "text/plain; charset=utf-8",
      "Cache-Control":
        "no-cache, no-transform",
      Connection:
        "keep-alive",
    },
  }
);

  } catch (error) {
    console.error(
      "Route error:",
      error
    );

    return new Response(
      "StudyMate AI is temporarily unavailable. Please try again later.",
      {
        status: 500,
      }
    );
  }
}