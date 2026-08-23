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

function buildState(options: {
  chatId: string | null;

  message: string;

  history?: TurnMessage[];

  previousRoute?:
    | "direct"
    | "document"
    | "web"
    | "quiz"
    | "planner"
    | null;

  documentNames?: string[];

  attachedThisTurn?: boolean;

  plannerData?: unknown;
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

    plannerData:
      (options.plannerData as StudyMateGraphState["plannerData"]) ??
      null,

    response: "",

    error: null,
  };
}

const FIXTURE_DOCUMENT_NAME =
  "CloudSync Platform Guide.pdf";

/*
 * Fixture topics are deliberately narrow:
 * a document-grounded plan may reference
 * these, but must NOT invent outside
 * topics such as recursion or neural
 * networks.
 */
const FIXTURE_TOPICS = [
  "dashboard",

  "payment processing",

  "inventory",
];

const FOREIGN_TOPIC_MARKERS = [
  "recursion",

  "neural network",

  "photosynthesis",

  "french revolution",
];

async function main() {
  let failures = 0;

  function report(
    passed: boolean,
    name: string,
    detail: string
  ) {
    if (!passed) {
      failures += 1;
    }

    console.log(
      `\n${passed ? "PASS" : "FAIL"} | ${name}`
    );

    console.log(`  ${detail}`);
  }

  const { routerNode } =
    await import("../lib/ai/graph/router");

  /*
   * ============================================================
   * PART A: ROUTING (required cases 1-6, 9-T2, 10, 11)
   * ============================================================
   */
  console.log(
    "\n=== PART A: PLANNER ROUTING TESTS ==="
  );

  type RoutingCase = {
    name: string;

    message: string;

    expect: string | ((route: string) => boolean);

    expectLabel: string;

    history?: TurnMessage[];

    previousRoute?:
      | "direct"
      | "document"
      | "web"
      | "quiz"
      | "planner"
      | null;

    documentNames?: string[];
  };

  const routingCases: RoutingCase[] = [
    {
      name: "1. 'Make me a 7-day study plan for data structures.' -> planner",

      message:
        "Make me a 7-day study plan for data structures.",

      expect: "planner",

      expectLabel: "planner",
    },
    {
      name: "2. 'Create a 2-week revision plan for databases.' -> planner",

      message:
        "Create a 2-week revision plan for databases.",

      expect: "planner",

      expectLabel: "planner",
    },
    {
      name: "3. 'I have an exam next Friday. Make me a revision schedule for algorithms.' -> planner",

      message:
        "I have an exam next Friday. Make me a revision schedule for algorithms.",

      expect: "planner",

      expectLabel: "planner",
    },
    {
      name: "4. 'Explain recursion.' -> direct",

      message: "Explain recursion.",

      expect: "direct",

      expectLabel: "direct",
    },
    {
      name: "5. 'Quiz me on recursion.' -> quiz",

      message: "Quiz me on recursion.",

      expect: "quiz",

      expectLabel: "quiz",
    },
    {
      name: "6. 'What is the latest iPhone?' -> web",

      message:
        "What is the latest iPhone?",

      expect: "web",

      expectLabel: "web",
    },
    {
      name: "9-T2. 'Make it 5 days instead.' after a planner turn -> planner",

      message:
        "Make it 5 days instead.",

      expect: "planner",

      expectLabel: "planner",

      history: [
        {
          role: "user",

          content:
            "Make me a 7-day study plan for databases.",
        },

        {
          role: "assistant",

          content:
            "## 7-Day Database Study Plan\n\n### Day 1 - ER models...",
        },
      ],

      previousRoute: "planner",
    },
    {
      name: "10. 'I only have 2 hours per day.' after a planner turn -> planner",

      message:
        "I only have 2 hours per day.",

      expect: "planner",

      expectLabel: "planner",

      history: [
        {
          role: "user",

          content:
            "Make me a study plan for operating systems.",
        },

        {
          role: "assistant",

          content:
            "## Operating Systems Study Plan\n\n### Day 1 - Processes...",
        },
      ],

      previousRoute: "planner",
    },
    {
      name: "11. 'Make me a study plan for networking.' -> planner (assumptions expected downstream)",

      message:
        "Make me a study plan for networking.",

      expect: "planner",

      expectLabel: "planner",
    },
    {
      name: "A10. 'Thanks!' after a planner turn stays direct",

      message: "Thanks!",

      expect: "direct",

      expectLabel: "direct",

      previousRoute: "planner",
    },
    {
      name: "A11. 'What is recursion?' right after a planner turn is NOT hijacked to planner deterministically",

      message: "What is recursion?",

      expect: (route: string) =>
        route !== "planner",

      expectLabel: "not planner",

      previousRoute: "planner",
    },
    {
      name: "A12. 'Help me study Python.' returns a valid route (ambiguous -> LLM)",

      message: "Help me study Python.",

      expect: (route: string) =>
        [
          "direct",
          "planner",
          "document",
          "web",
          "quiz",
        ].includes(route),

      expectLabel: "any valid route",
    },
  ];

  for (const testCase of routingCases) {
    const result = await routerNode(
      buildState({
        chatId:
          "cmplannerroute000000000001",

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

    const passed =
      typeof testCase.expect ===
      "function"
        ? testCase.expect(
            result.route
          )
        : result.route ===
          testCase.expect;

    report(
      passed,
      testCase.name,
      `Expected: ${testCase.expectLabel} | Actual: ${result.route}`
    );
  }

  /*
   * ============================================================
   * PART B: PLANNER NODE DOCUMENT GROUNDING (cases 7 and 8)
   * Uses a throwaway DB fixture like the quiz context tests.
   * ============================================================
   */
  console.log(
    "\n=== PART B: PLANNER DOCUMENT-GROUNDING TESTS ==="
  );

  const { plannerNode } =
    await import("../lib/ai/graph/graph");

  const { prisma } =
    await import("../lib/prisma");

  const { embedTexts } =
    await import("../lib/rag/embeddings");

  const { saveChunkEmbeddings } =
    await import("../lib/rag/vector-store");

  const owner =
    await prisma.user.findFirst();

  if (!owner) {
    throw new Error(
      "No user exists in the database to own the test chat."
    );
  }

  const chat =
    await prisma.chat.create({
      data: {
        userId: owner.id,

        title:
          "[routing-test] planner fixture",
      },
    });

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
CloudSync is a file synchronization platform for small teams. The admin dashboard shows sync activity, storage usage, and active devices.

CloudSync payment processing supports monthly and annual team billing through credit card or invoice.

Inventory in CloudSync tracks shared storage quotas per team and raises alerts when teams approach their limits.
          `.trim(),

          chunks: {
            create: [
              {
                chunkIndex: 0,

                pageNumber: 1,

                content:
                  "The CloudSync admin dashboard shows sync activity, storage usage, and active devices for the whole team. Admins can filter dashboard widgets by date range.",
              },

              {
                chunkIndex: 1,

                pageNumber: 1,

                content:
                  "CloudSync payment processing supports monthly and annual team billing. Teams can pay by credit card or invoice, and receipts are emailed automatically.",
              },

              {
                chunkIndex: 2,

                pageNumber: 2,

                content:
                  "Inventory tracking in CloudSync monitors shared storage quotas per team. Alerts notify admins when a team reaches ninety percent of its quota.",
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

    type GroundingCase = {
      name: string;

      message: string;

      expectDocumentContext: boolean;
    };

    const groundingCases: GroundingCase[] =
      [
        {
          name: "7. PDF exists + 'Create a study plan from this PDF.' -> planner WITH document context",

          message:
            "Create a study plan from this PDF.",

          expectDocumentContext: true,
        },
        {
          name: "8. PDF exists + 'Make me a Python study plan.' -> planner WITHOUT document context",

          message:
            "Make me a Python study plan.",

          expectDocumentContext: false,
        },
      ];

    for (const testCase of groundingCases) {
      const result =
        await plannerNode(
          buildState({
            chatId: chat.id,

            message:
              testCase.message,

            documentNames: [
              FIXTURE_DOCUMENT_NAME,
            ],
          }) as StudyMateGraphState
        );

      const hasContext =
        (
          result.plannerContext ?? ""
        ).length > 0;

      const passed =
        hasContext ===
        testCase.expectDocumentContext;

      const groundedOnFixture =
        !testCase.expectDocumentContext ||
        (result.plannerContext ??
          "").includes("CloudSync");

      const finalPassed =
        passed && groundedOnFixture;

      report(
        finalPassed,
        testCase.name,
        `Expected context: ${
          testCase.expectDocumentContext
            ? "document-grounded"
            : "none"
        } | Actual context length: ${
          result.plannerContext?.length ??
          0
        }`
      );
    }

    /*
     * Case 12: document-grounded planner must
     * not invent topics absent from retrieved
     * context.
     */
    console.log(
      "\n=== PART C: DOCUMENT-GROUNDED NO-INVENTION TEST (case 12) ==="
    );

    const groundedResult =
      await plannerNode(
        buildState({
          chatId: chat.id,

          message:
            "Create a detailed study plan covering this uploaded PDF.",

          documentNames: [
            FIXTURE_DOCUMENT_NAME,
          ],
        }) as StudyMateGraphState
      );

    const plan =
      groundedResult.plannerData;

    if (!plan) {
      failures += 1;

      console.log(
        "\nFAIL | 12. Document-grounded planner returned no structured plan."
      );
    } else {
      const planText = JSON.stringify(
        plan
      ).toLowerCase();

      const inventedForeignTopic =
        FOREIGN_TOPIC_MARKERS.find(
          (marker) =>
            planText.includes(marker)
        );

      const referencesFixtureTopics =
        FIXTURE_TOPICS.every(
          (topic) =>
            planText.includes(topic)
        ) ||
        FIXTURE_TOPICS.some(
          (topic) =>
            planText.includes(topic)
        );

      const passed =
        !inventedForeignTopic &&
        referencesFixtureTopics &&
        (groundedResult.plannerContext ??
          "").length > 0;

      report(
        passed,
        "12. Document-grounded plan stays within retrieved context",

        `${
          inventedForeignTopic
            ? `Invented topic detected: ${inventedForeignTopic}`
            : "No foreign topics invented"
        } | Fixture topics referenced: ${referencesFixtureTopics} | Context length: ${
          groundedResult.plannerContext
            ?.length ?? 0
        }`
      );

      console.log(
        `\nPlan title: ${plan.title} | Days: ${plan.days.length} | First day focus: ${plan.days[0]?.focus}`
      );
    }

    /*
     * ============================================================
     * PART D: GRAPH-LEVEL TWO-TURN FOLLOW-UP (case 9 end-to-end)
     * Runs through the compiled graph with PostgreSQL checkpoints.
     * ============================================================
     */
    console.log(
      "\n=== PART D: GRAPH-LEVEL CHECKPOINTED FOLLOW-UP TEST (case 9) ==="
    );

    const {
      studyMateGraph,
    } = await import(
      "../lib/ai/graph/graph"
    );

    const threadStamp = Date.now();

    const turn1Input = {
      mode: "default",

      webSearchEnabled: false,

      messages: [
        new HumanMessage(
          "Make me a 7-day study plan for databases."
        ),
      ],

      chatId: chat.id,

      documentNames: [] as string[],

      documentAttachedThisTurn: false,

      documentContext: "",

      webContext: "",

      verificationContext: "",

      response: "",

      webSources: [],

      documentCitations: [],

      quizTopic: "",

      quizContext: "",

      quizData: null,

      plannerTopic: "",

      plannerContext: "",

      error: null,
    };

    const turn2Input = {
      mode: "default",

      webSearchEnabled: false,

      messages: [
        new AIMessage(
          "## 7-Day Database Study Plan\n\n### Day 1 - ER modeling..."
        ),

        new HumanMessage(
          "Make it 5 days instead."
        ),
      ],
    };

    async function invokeWithRetry(
      input: Record<
        string,
        unknown
      >,
      threadBase: number
    ) {
      const maxAttempts = 3;

      let lastError: unknown;

      for (
        let attempt = 1;
        attempt <= maxAttempts;
        attempt += 1
      ) {
        try {
          return await studyMateGraph.invoke(
            input as Parameters<
              typeof studyMateGraph.invoke
            >[0],

            {
              configurable:
                {
                  /*
                   * Both turns share ONE
                   * thread so checkpointed
                   * planner state carries
                   * over exactly like a
                   * real multi-turn chat.
                   */
                  thread_id: `planner-followup-test-${threadStamp}-${threadBase}`,
                },
            }
          );
        } catch (error) {
          lastError = error;

          console.log(
            `  Attempt ${attempt} failed, retrying...`
          );

          await new Promise(
            (resolve) =>
              setTimeout(
                resolve,
                1500 * attempt
              )
          );
        }
      }

      throw lastError;
    }

    const turn1Result =
      await invokeWithRetry(
        turn1Input,
        1
      );

    const turn1Passed =
      turn1Result.route ===
        "planner" &&
      turn1Result.plannerData !==
        null &&
      turn1Result.plannerData
        .days.length === 7;

    report(
      turn1Passed,
      "9-T1. Graph turn 1: 7-day database plan routes planner and stores plannerData",

      `Expected: planner with 7 days | Actual: ${turn1Result.route}, days: ${
        turn1Result.plannerData?.days.length ??
        0
      }, durationDays: ${
        turn1Result.plannerData?.durationDays ??
        "null"
      }`
    );

    const turn2Result =
      await invokeWithRetry(
        turn2Input,
        1
      );

    const turn2Plan =
      turn2Result.plannerData;

    const turn2Passed =
      turn2Result.route ===
        "planner" &&
      turn2Plan !== null &&
      turn2Plan.days.length === 5;

    report(
      turn2Passed,
      "9-T2. Graph turn 2: 'Make it 5 days instead.' stays planner and adjusts prior plan via checkpoint",

      `Expected: planner with 5 days | Actual: ${turn2Result.route}, days: ${
        turn2Plan?.days.length ?? 0
      }`
    );

    /*
     * ============================================================
     * PART E: MISSING-DURATION ASSUMPTIONS (case 11 generation)
     * ============================================================
     */
    console.log(
      "\n=== PART E: MISSING-DURATION ASSUMPTIONS TEST (case 11) ==="
    );

    const assumptionsResult =
      await plannerNode(
        buildState({
          chatId: null,

          message:
            "Make me a study plan for networking.",
        }) as StudyMateGraphState
      );

    const assumptionsPlan =
      assumptionsResult.plannerData ??
      null;

    const assumptionsPassed =
      assumptionsPlan !== null &&
      assumptionsPlan.assumptions.length >
        0;

    report(
      assumptionsPassed,
      "11. Missing duration produces clearly labeled assumptions",

      `Assumptions: ${
        assumptionsPlan?.assumptions.join(
          " ; "
        ) ?? "(none)"
      }`
    );

    const visibleMarkdown =
      assumptionsResult.response;

    const markdownClean =
      visibleMarkdown.startsWith(
        "## "
      ) &&
      !visibleMarkdown.includes(
        "<div>"
      ) &&
      !visibleMarkdown.includes(
        "<br"
      );

    report(
      markdownClean,
      "5b. Planner response renders as clean Markdown without raw HTML",

      `First line: ${visibleMarkdown.split("\n")[0]}`
    );
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
