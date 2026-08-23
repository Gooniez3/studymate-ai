import dotenv from "dotenv";
import {
  HumanMessage,
  AIMessage,
} from "@langchain/core/messages";

import type {
  StudyMateGraphState,
} from "../lib/ai/graph/state";

dotenv.config({
  path: ".env.local",
});

type TurnMessage = {
  role: "user" | "assistant";
  content: string;
};

const FIXTURE_DOCUMENT_NAME =
  "TechPoint POS.pdf";

function buildState(options: {
  chatId: string | null;

  message: string;

  history?: TurnMessage[];

  previousRoute?:
    | "direct"
    | "document"
    | "web"
    | "quiz"
    | null;

  documentNames?: string[];

  attachedThisTurn?: boolean;
}) {
  const messages = (
    options.history ?? []
  ).map((turn) =>
    turn.role === "user"
      ? new HumanMessage(
          turn.content
        )
      : new AIMessage(
          turn.content
        )
  );

  messages.push(
    new HumanMessage(
      options.message
    )
  );

  return {
    messages,

    chatId: options.chatId,

    mode: "default" as const,

    webSearchEnabled: false,

    route:
      options.previousRoute ??
      "direct",

    previousRoute:
      options.previousRoute ??
      null,

    documentNames:
      options.documentNames ?? [],

    documentAttachedThisTurn:
      options.attachedThisTurn ??
      false,

    documentContext: "",

    webContext: "",

    verificationContext: "",

    webSources: [],

    documentCitations: [],

    quizTopic: "",

    quizContext: "",

    quizData: null,

    plannerTopic: "",

    plannerContext: "",

    plannerData: null,

    revisionTopic: "",

    revisionContext: "",

    revisionData: null,

    response: "",

    error: null,
  };
}

async function main() {
  const {
    quizNode,
  } = await import(
    "../lib/ai/graph/graph"
  );

  const {
    routerNode,
  } = await import(
    "../lib/ai/graph/router"
  );

  const { prisma } =
    await import("../lib/prisma");

  const { embedTexts } =
    await import(
      "../lib/rag/embeddings"
    );

  const { saveChunkEmbeddings } =
    await import(
      "../lib/rag/vector-store"
    );

  const owner =
    await prisma.user.findFirst();

  if (!owner) {
    throw new Error(
      "No user exists in the database to own the test chat."
    );
  }

  /*
   * Dedicated throwaway chat so the fixture
   * never appears inside a real user chat.
   * Deleting the chat cascades to the test
   * document and its chunks.
   */
  const chat =
    await prisma.chat.create({
      data: {
        userId: owner.id,

        title:
          "[routing-test] quiz context fixture",
      },
    });

  let failures = 0;

  let documentId: string | null =
    null;

  try {
    const document =
      await prisma.document.create({
        data: {
          chatId: chat.id,

          name: FIXTURE_DOCUMENT_NAME,

          type: "application/pdf",

          size: 1024,

          extractedText: `
TechPoint POS is a point-of-sale system for small retailers. Page 1 covers the dashboard, the quick-sale workflow, and barcode scanning setup.

TechPoint POS payment processing supports cash, card, and mobile wallet payments. Receipts can be printed or emailed to customers.

Inventory management in TechPoint POS tracks stock levels automatically and raises low-stock alerts when items need reordering.
          `.trim(),

          chunks: {
            create: [
              {
                chunkIndex: 0,

                pageNumber: 1,

                content:
                  "TechPoint POS is a point-of-sale system for small retailers. The page 1 dashboard shows daily sales, top products, and staff activity. The quick-sale workflow lets cashiers complete a sale with one tap.",
              },

              {
                chunkIndex: 1,

                pageNumber: 1,

                content:
                  "TechPoint POS payment processing supports cash, card, and mobile wallets such as Apple Pay and Google Pay. Receipts can be printed or emailed to customers after checkout.",
              },

              {
                chunkIndex: 2,

                pageNumber: 2,

                content:
                  "Inventory management in TechPoint POS tracks stock levels automatically as products are sold. Low-stock alerts notify staff when items fall below their reorder threshold.",
              },
            ],
          },
        },

        include: {
          chunks: true,
        },
      });

    documentId = document.id;

    const embeddings =
      await embedTexts(
        document.chunks.map(
          (chunk) => chunk.content
        )
      );

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
      `\nFixture ready: ${document.chunks.length} embedded chunks in chat ${chat.id}`
    );

    type QuizCase = {
      name: string;

      message: string;

      history?: TurnMessage[];

      previousRoute?:
        | "document"
        | "direct"
        | null;

      chatId: string;

      documentNames?: string[];

      expectDocumentContext: boolean;
    };

    const quizCases: QuizCase[] = [
      {
        name: "1. 'Quiz me on this.' with a document present uses document context",

        message: "Quiz me on this.",

        history: [
          {
            role: "user",

            content: "Explain this.",
          },

          {
            role: "assistant",

            content:
              "The uploaded TechPoint POS document describes a point-of-sale system for small retailers.",
          },
        ],

        previousRoute: "document",

        chatId: chat.id,

        documentNames: [
          FIXTURE_DOCUMENT_NAME,
        ],

        expectDocumentContext: true,
      },
      {
        name: "2. 'What about page 1? Quiz me on this.' uses document context (bug reproduction)",

        message:
          "What about page 1? Quiz me on this.",

        history: [
          {
            role: "user",

            content: "Explain this.",
          },

          {
            role: "assistant",

            content:
              "TechPoint POS is a point-of-sale system for small retailers with a dashboard and quick-sale workflow.",
          },

          {
            role: "user",

            content:
              "Explain that more simply.",
          },

          {
            role: "assistant",

            content:
              "In short: TechPoint POS helps small shops take payments and track sales easily.",
          },
        ],

        previousRoute: "document",

        chatId: chat.id,

        documentNames: [
          FIXTURE_DOCUMENT_NAME,
        ],

        expectDocumentContext: true,
      },
      {
        name: "3. 'Quiz me on Python.' stays general even with a document present",

        message: "Quiz me on Python.",

        history: [
          {
            role: "user",

            content: "Explain this.",
          },

          {
            role: "assistant",

            content:
              "TechPoint POS is a point-of-sale system for small retailers.",
          },
        ],

        previousRoute: "document",

        chatId: chat.id,

        documentNames: [
          FIXTURE_DOCUMENT_NAME,
        ],

        expectDocumentContext: false,
      },
      {
        name: "4. 'Test me on what we just discussed.' after a document answer uses document context",

        message:
          "Test me on what we just discussed.",

        history: [
          {
            role: "user",

            content:
              "What does page 2 cover?",
          },

          {
            role: "assistant",

            content:
              "Page 2 covers inventory management, automatic stock tracking, and low-stock alerts in TechPoint POS.",
          },
        ],

        previousRoute: "document",

        chatId: chat.id,

        documentNames: [
          FIXTURE_DOCUMENT_NAME,
        ],

        expectDocumentContext: true,
      },
      {
        name: "5. 'Quiz me on this.' without documents attempts no document context",

        message: "Quiz me on this.",

        history: [
          {
            role: "user",

            content: "Explain this.",
          },

          {
            role: "assistant",

            content:
              "Happy to explain once you share what you mean.",
          },
        ],

        previousRoute: null,

        chatId:
          "cmnosuchchat00000000000000",

        documentNames: [],

        expectDocumentContext: false,
      },
    ];

    console.log(
      "\n=== PART A: QUIZ NODE DOCUMENT-GROUNDING TESTS ==="
    );

    for (const testCase of quizCases) {
      const result =
        await quizNode(
          buildState({
            chatId:
              testCase.chatId,

            message:
              testCase.message,

            history:
              testCase.history,

            previousRoute:
              testCase.previousRoute,

            documentNames:
              testCase.documentNames,
          }) as StudyMateGraphState
        );

      const hasContext =
        (
          result.quizContext ?? ""
        ).length > 0;

      const passed =
        hasContext ===
        testCase.expectDocumentContext;

      const contextMatchesFixture =
        !testCase.expectDocumentContext ||
        (result.quizContext ??
          "").includes("TechPoint");

      const finalPassed =
        passed &&
        (hasContext
          ? contextMatchesFixture
          : true);

      if (!finalPassed) {
        failures += 1;
      }

      console.log(
        `\n${finalPassed ? "PASS" : "FAIL"} | ${testCase.name}`
      );

      console.log(
        `  Expected context: ${
          testCase.expectDocumentContext
            ? "document-grounded"
            : "none"
        } | Actual context length: ${
          result.quizContext?.length ?? 0
        }`
      );

      if (
        result.quizData
      ) {
        console.log(
          `  First question: ${result.quizData.questions[0]?.question}`
        );
      }
    }

    /*
     * PART B: routing for quiz requests
     * whose phrasing must still reach the
     * quiz node deterministically.
     */
    console.log(
      "\n=== PART B: QUIZ ROUTING SANITY ==="
    );

    const routingCases = [
      {
        name: "B1. 'Create questions from this.' routes to quiz",

        message:
          "Create questions from this.",

        expected: "quiz",
      },

      {
        name: "B2. 'Quiz me about page 1.' routes to quiz",

        message:
          "Quiz me about page 1.",

        expected: "quiz",
      },
    ];

    for (const routingCase of routingCases) {
      const result =
        await routerNode(
          buildState({
            chatId: chat.id,

            message:
              routingCase.message,

            history: [
              {
                role: "user",

                content: "Explain this.",
              },

              {
                role: "assistant",

                content:
                  "TechPoint POS is a point-of-sale system for small retailers.",
              },
            ],

            previousRoute:
              "document",

            documentNames: [
              FIXTURE_DOCUMENT_NAME,
            ],
          }) as StudyMateGraphState
        );

      const passed =
        result.route ===
        routingCase.expected;

      if (!passed) {
        failures += 1;
      }

      console.log(
        `\n${passed ? "PASS" : "FAIL"} | ${routingCase.name}`
      );

      console.log(
        `  Expected: ${routingCase.expected} | Actual: ${result.route}`
      );
    }
  } finally {
    if (documentId) {
      await prisma.document
        .delete({
          where: { id: documentId },
        })
        .catch(() => undefined);
    }

    await prisma.chat
      .delete({
        where: { id: chat.id },
      })
      .catch(() => undefined);

    console.log(
      "\nFixture cleaned up (test chat, document, and chunks removed)."
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
