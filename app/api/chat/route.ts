import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { embedTexts } from "@/lib/rag/embeddings";
import { saveChunkEmbeddings } from "@/lib/rag/vector-store";
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

type PdfTextItem = {
  str?: string;
  transform?: number[];
};

async function extractPdfPages(
  file: File
): Promise<ExtractedPdfPage[]> {
  const arrayBuffer =
    await file.arrayBuffer();

  const buffer =
    Buffer.from(arrayBuffer);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse =
    require("pdf-parse/lib/pdf-parse.js");

  const pages: ExtractedPdfPage[] = [];

  let pageNumber = 0;

  await pdfParse(buffer, {
    pagerender: async (pageData: {
      getTextContent: () => Promise<{
        items: PdfTextItem[];
      }>;
    }) => {
      pageNumber += 1;

      const textContent =
        await pageData.getTextContent();

      let lastY: number | null = null;
      let pageText = "";

      for (const item of textContent.items) {
        const text =
          typeof item.str === "string"
            ? item.str
            : "";

        if (!text) {
          continue;
        }

        const currentY =
          Array.isArray(item.transform)
            ? item.transform[5]
            : null;

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

        if (currentY !== null) {
          lastY = currentY;
        }
      }

      const cleanedText =
        pageText
          .replace(/[ \t]+\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();

      pages.push({
        pageNumber,
        text: cleanedText,
      });

      // pdf-parse expects the page renderer
      // to return text.
      return cleanedText;
    },
  });

  return pages;
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
    "search_query_rewrite"
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

      const pages =
  await extractPdfPages(file);

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
  return new Response(
    "This PDF looks image-based. Text could not be extracted.",
    {
      status: 400,
    }
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
  return new Response(
    "No usable text chunks could be created from this PDF.",
    {
      status: 400,
    }
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
  const existingChat =
    await prisma.chat.findFirst({
      where: {
        id: chatId,
        userId: session.user.id,
      },
    });

  if (existingChat) {
    const document =
      await prisma.document.create({
        data: {
          chatId: existingChat.id,
          name: file.name,
          type: file.type,
          size: file.size,
          extractedText,

          chunks: {
            create:
              pageAwareChunks.map(
                (chunk, index) => ({
                  chunkIndex: index,
                  pageNumber:
                    chunk.pageNumber,
                  content:
                    chunk.content,
                })
              ),
          },
        },

        include: {
          chunks: {
            orderBy: {
              chunkIndex: "asc",
            },
          },
        },
      });

    documentNames = [document.name];
    documentAttachedThisTurn = true;

    console.log(
      "Generating embeddings for document chunks..."
    );

    const embeddings =
      await embedTexts(
        document.chunks.map(
          (chunk) =>
            chunk.content
        )
      );

    if (
      embeddings.length !==
      document.chunks.length
    ) {
      throw new Error(
        `Embedding count mismatch. Expected ${document.chunks.length}, received ${embeddings.length}.`
      );
    }

    await saveChunkEmbeddings(
      document.chunks.map(
        (chunk, index) => ({
          id: chunk.id,
          embedding:
            embeddings[index],
        })
      )
    );

    console.log(
      "Chunk embeddings stored:",
      {
        documentId:
          document.id,
        chunks:
          document.chunks.length,
        embeddings:
          embeddings.length,
      }
    );

    console.log(
      "RAG document stored:",
      {
        documentId:
          document.id,
        name:
          document.name,
        characters:
          extractedText.length,
        pages:
          usablePages.length,
        chunks:
          document.chunks.length,
      }
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

quizTopic: "",

quizContext: "",

quizData: null,

error: null,
    },
    {
      configurable: {
        thread_id: graphThreadId,
      },
    }
  );

console.log(
  "API LangGraph result:",
  {
    route: graphResult.route,
    responseLength:
      graphResult.response.length,
    webSources:
      graphResult.webSources?.length ??
      0,
    documentCitations:
      graphResult.documentCitations
        ?.length ?? 0,
    error: graphResult.error,
  }
);
    const graphEncoder =
  new TextEncoder();

const graphReadableStream =
  new ReadableStream({
    start(controller) {
      controller.enqueue(
        graphEncoder.encode(
          graphResult.response
        )
      );

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

        controller.enqueue(
          graphEncoder.encode(
            `\n\n---\n\n**Sources**\n\n${sourcesBlock}`
          )
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

        controller.enqueue(
          graphEncoder.encode(
            `\n\n---\n\n**Document Sources**\n\n${documentSourcesBlock}`
          )
        );
      }
      if (
  graphResult.quizData
) {
  const quizMetadata =
    JSON.stringify({
      type: "quiz",
      data: graphResult.quizData,
    });

  controller.enqueue(
    graphEncoder.encode(
      `\n\n__STUDYMATE_QUIZ__${quizMetadata}__END_STUDYMATE_QUIZ__`
    )
  );
}

      controller.close();
    },
  });

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