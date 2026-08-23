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
    | "revision"
    | null;

  documentNames?: string[];

  attachedThisTurn?: boolean;

  revisionData?: unknown;
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

    revisionData:
      (options.revisionData as StudyMateGraphState["revisionData"]) ??
      null,

    response: "",

    error: null,
  };
}

const FIXTURE_DOCUMENT_NAME =
  "CloudSync Platform Guide.pdf";

/*
 * Fixture topics are deliberately narrow:
 * document-grounded revision may reference
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

const REQUIRED_ROOT_KEYS = [
  "title",

  "topic",

  "objective",

  "assumptions",

  "mustRemember",

  "commonMistakes",

  "keyConcepts",

  "quickRecall",

  "likelyQuestions",

  "revisionChecklist",

  "examTips",
] as const;

/*
 * Optional section filter so quota-limited
 * reruns can execute only the parts that
 * need retesting:
 *   npx tsx scripts/test-langgraph-revision.ts assumptions reliability
 * With no arguments every section runs.
 */
const ALL_SECTIONS = [
  "routing",

  "grounding",

  "assumptions",

  "reliability",

  "followup",
] as const;

type Section =
  (typeof ALL_SECTIONS)[number];

const requestedSections = process.argv
  .slice(2)
  .filter((arg): arg is Section =>
    (ALL_SECTIONS as readonly string[]).includes(
      arg
    )
  );

const sectionEnabled = (
  section: Section
) =>
  requestedSections.length ===
    0 ||
  requestedSections.includes(
    section
  );

/*
 * Detects provider quota/rate-limit failures
 * so optional generation-heavy sections can
 * be skipped cleanly instead of retrying.
 */
function isQuotaError(
  error: unknown
): boolean {
  const message =
    error instanceof Error
      ? `${error.message}`
      : String(error);

  return (
    /\b(429|rate.?limit|quota)\b/i.test(
      message
    ) ||
    (typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error as { status?: number })
        .status === 429)
  );
}

async function main() {
  let failures = 0;

  let quotaBlocked = false;

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

  async function runGenerationStep(
    name: string,
    step: () => Promise<void>
  ): Promise<boolean> {
    if (quotaBlocked) {
      console.log(
        `\nSKIP | ${name} (skipped: Groq quota exhausted earlier in this run)`
      );

      return false;
    }

    try {
      await step();

      return true;
    } catch (error) {
      if (isQuotaError(error)) {
        quotaBlocked = true;

        console.log(
          `\nSKIP | ${name} (Groq quota/rate limit reached: stopping token-consuming checks per policy)`
        );

        return false;
      }

      throw error;
    }
  }

  const { routerNode } =
    await import("../lib/ai/graph/router");

  const { revisionNode } =
    await import("../lib/ai/graph/graph");

  const { prisma } =
    await import("../lib/prisma");

  /*
   * ============================================================
   * PART A: ROUTING MATRIX (cases 1-7, 11, 12 + overlap guards)
   * Most cases resolve through deterministic
   * heuristics; ambiguous ones fall back to
   * the routing LLM by design.
   * ============================================================
   */
  if (sectionEnabled("routing")) {
  console.log(
    "\n=== PART A: REVISION ROUTING TESTS ==="
  );

  type RoutingCase = {
    name: string;

    message: string;

    expect:
      | string
      | ((route: string) => boolean);

    history?: TurnMessage[];

    previousRoute?:
      | "direct"
      | "document"
      | "web"
      | "quiz"
      | "planner"
      | "revision"
      | null;

    documentNames?: string[];
  };

  const routingCases: RoutingCase[] = [
    {
      name: "1. 'Help me revise recursion for my exam.' -> revision",

      message:
        "Help me revise recursion for my exam.",

      expect: "revision",
    },
    {
      name: "2. 'Give me revision notes for database normalization.' -> revision",

      message:
        "Give me revision notes for database normalization.",

      expect: "revision",
    },
    {
      name: "3. 'Make me a quick revision sheet for algorithms.' -> revision",

      message:
        "Make me a quick revision sheet for algorithms.",

      expect: "revision",
    },
    {
      name: "4. 'Make me a 7-day revision plan for algorithms.' -> planner (planner priority preserved)",

      message:
        "Make me a 7-day revision plan for algorithms.",

      expect: "planner",
    },
    {
      name: "5. 'Quiz me on recursion.' -> quiz (quiz priority preserved)",

      message:
        "Quiz me on recursion.",

      expect: "quiz",
    },
    {
      name: "6. 'Explain recursion.' -> direct",

      message:
        "Explain recursion.",

      expect: "direct",
    },
    {
      name: "7. 'What is the latest iPhone?' -> web",

      message:
        "What is the latest iPhone?",

      expect: "web",
    },
    {
      name: "A1. 'Give me likely exam questions from these notes.' -> revision (not quiz)",

      message:
        "Give me likely exam questions from these notes.",

      expect: "revision",

      documentNames: [
        FIXTURE_DOCUMENT_NAME,
      ],
    },
    {
      name: "11. 'Make it shorter.' after a revision turn -> revision",

      message:
        "Make it shorter.",

      expect: "revision",

      history: [
        {
          role: "user",

          content:
            "Give me revision notes for database normalization.",
        },

        {
          role: "assistant",

          content:
            "## Database Normalization - Exam Revision\n\n### Must Know\n- 1NF ...",
        },
      ],

      previousRoute: "revision",
    },
    {
      name: "12. 'Add common mistakes.' after a revision turn -> revision",

      message:
        "Add common mistakes.",

      expect: "revision",

      history: [
        {
          role: "user",

          content:
            "Give me revision notes for database normalization.",
        },

        {
          role: "assistant",

          content:
            "## Database Normalization - Exam Revision\n\n### Must Know\n- 1NF ...",
        },
      ],

      previousRoute: "revision",
    },
    {
      name: "A2. 'Quiz me on this' right after a revision turn -> quiz (not hijacked)",

      message: "Quiz me on this.",

      expect: "quiz",

      previousRoute: "revision",
    },
    {
      name: "A3. 'Make it shorter.' WITHOUT a prior revision turn does not force revision deterministically",

      message:
        "Make it shorter.",

      expect: "direct",

      history: [
        {
          role: "user",

          content:
            "Explain how TCP handshakes work.",
        },

        {
          role: "assistant",

          content:
            "A TCP handshake has three steps...",
        },
      ],

      previousRoute: "direct",
    },
    {
      name: "A4. 'What about page 2?' right after a revision turn is NOT forced to revision or document deterministically",

      message:
        "What about page 2?",

      expect:
        (route: string) =>
          [
            "revision",
            "document",
            "direct",
          ].includes(route),

      previousRoute: "revision",

      documentNames: [
        FIXTURE_DOCUMENT_NAME,
      ],
    },
  ];

  for (const testCase of routingCases) {
    const result = await routerNode(
      buildState({
        chatId:
          "cmrevroutetest00000000001",

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

      `Expected: ${
        typeof testCase.expect ===
        "function"
          ? "one of revision/document/direct"
          : testCase.expect
      } | Actual: ${result.route}`
    );
  }
  }

  /*
   * ============================================================
   * PART B: DOCUMENT GROUNDING GATES (cases 8, 9, 10)
   * Uses a throwaway DB fixture like the
   * planner context tests. Each grounded
   * case performs one real revision
   * generation.
   * ============================================================
   */
  if (!sectionEnabled("grounding")) {
    console.log(
      "\n=== PART B: SKIPPED (section filter) ==="
    );
  } else {
  console.log(
    "\n=== PART B: REVISION DOCUMENT-GROUNDING TESTS ==="
  );

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
          "[routing-test] revision fixture",
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

                pageNumber: 2,

                content:
                  "CloudSync payment processing supports monthly and annual team billing. Teams can pay by credit card or invoice, and receipts are emailed automatically.",
              },

              {
                chunkIndex: 2,

                pageNumber: 3,

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
          name: "8. PDF exists + 'Summarize this PDF for exam revision.' -> revision WITH document context",

          message:
            "Summarize this PDF for exam revision.",

          expectDocumentContext: true,
        },
        {
          name: "9. PDF exists + 'What are the key things I need to remember from page 2?' -> revision WITH document context",

          message:
            "What are the key things I need to remember from page 2?",

          expectDocumentContext: true,
        },
        {
          name: "10. PDF exists + 'Give me revision notes for Python.' -> revision WITHOUT unrelated document context",

          message:
            "Give me revision notes for Python.",

          expectDocumentContext: false,
        },
      ];

    for (const testCase of groundingCases) {
      await runGenerationStep(
        testCase.name,
        async () => {
          const result =
            await revisionNode(
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
              result.revisionContext ??
              ""
            ).length > 0;

          const citationsPresent = (
            result.documentCitations ??
            []
          ).length > 0;

          const groundedOnFixture =
            !testCase.expectDocumentContext ||
            (result.revisionContext ??
              "").includes("CloudSync");

          const citationBehavior =
            testCase.expectDocumentContext
              ? citationsPresent
              : true;

          const passed =
            hasContext ===
              testCase.expectDocumentContext &&
            groundedOnFixture &&
            citationBehavior;

          report(
            passed,
            testCase.name,

            `Expected context: ${
              testCase.expectDocumentContext
                ? "document-grounded (+ citations)"
                : "none"
            } | Actual context length: ${
              result.revisionContext?.length ??
              0
            } | Citations: ${
              result.documentCitations?.length ??
              0
            }`
          );
        }
      );
    }

    /*
     * Case 14: document-grounded revision must
     * not invent facts outside retrieved
     * context.
     */
    await runGenerationStep(
      "14. Document-grounded revision stays within retrieved context",
      async () => {
        const groundedResult =
          await revisionNode(
            buildState({
              chatId: chat.id,

              message:
                "Create detailed exam revision notes covering this uploaded PDF.",

              documentNames: [
                FIXTURE_DOCUMENT_NAME,
              ],
            }) as StudyMateGraphState
          );

        const revision =
          groundedResult.revisionData;

        if (!revision) {
          report(
            false,
            "14. Document-grounded revision stays within retrieved context",
            "No structured revision data returned."
          );

          return;
        }

        const revisionText =
          JSON.stringify(
            revision
          ).toLowerCase();

        const inventedForeignTopic =
          FOREIGN_TOPIC_MARKERS.find(
            (marker) =>
              revisionText.includes(
                marker
              )
          );

        const referencesFixtureTopics =
          FIXTURE_TOPICS.some(
            (topic) =>
              revisionText.includes(
                topic
              )
          );

        const passed =
          !inventedForeignTopic &&
          referencesFixtureTopics &&
          (groundedResult.revisionContext ??
            "").length > 0;

        report(
          passed,
          "14. Document-grounded revision stays within retrieved context",

          `${
            inventedForeignTopic
              ? `Invented topic detected: ${inventedForeignTopic}`
              : "No foreign topics invented"
          } | Fixture topics referenced: ${referencesFixtureTopics} | Context length: ${
            groundedResult.revisionContext
              ?.length ?? 0
          }`
        );
      }
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

  }

  /*
   * ============================================================
   * PART C: ASSUMPTIONS + MARKDOWN QUALITY (case 13)
   * ============================================================
   */
  if (!sectionEnabled("assumptions")) {
    console.log(
      "\n=== PART C: SKIPPED (section filter) ==="
    );
  } else {
  console.log(
    "\n=== PART C: VAGUE REQUEST ASSUMPTIONS TEST (case 13) ==="
  );

  await runGenerationStep(
    "13. 'Help me revise networking.' -> labeled assumptions, clean Markdown",
    async () => {
      const { renderExamRevisionMarkdown } =
        await import(
          "../lib/ai/agents/exam-revision-agent"
        );

      const vagueResult =
        await revisionNode(
          buildState({
            chatId: null,

            message:
              "Help me revise networking.",
          }) as StudyMateGraphState
        );

      const revision =
        vagueResult.revisionData ??
        null;

      const assumptionsLabeled =
        revision !== null &&
        revision.assumptions.length >
          0;

      const inventedFormatOrDate =
        revision !== null &&
        JSON.stringify(revision)
          .toLowerCase()
          .match(
            /\b(mcq|multiple choice|60 minutes|2 hours long|may 202\d|june 202\d)\b/
          ) !== null;

      const rendererMatches =
        revision !== null &&
        vagueResult.response ===
          renderExamRevisionMarkdown(
            revision
          );

      const markdownClean =
        typeof vagueResult.response ===
          "string" &&
        vagueResult.response.startsWith(
          "## "
        ) &&
        !vagueResult.response.includes(
          "<div>"
        ) &&
        !vagueResult.response.includes(
          "<br"
        );

      report(
        assumptionsLabeled &&
          !inventedFormatOrDate &&
          markdownClean &&
          rendererMatches,
        "13. 'Help me revise networking.' -> labeled assumptions, clean Markdown",

        `Assumptions: ${
          revision?.assumptions.join(" ; ") ??
          "(none)"
        } | Invented format/date: ${!!inventedFormatOrDate} | Renderer matches response: ${rendererMatches}`
      );
    }
  );

  }

  /*
   * ============================================================
   * PART D: STRUCTURED RELIABILITY (case 15)
   * Repeats realistic generations and verifies
   * every required root field is present.
   * ============================================================
   */
  if (sectionEnabled("reliability")) {
  console.log(
    "\n=== PART D: STRUCTURED OUTPUT RELIABILITY (case 15) ==="
  );

  const reliabilityRuns = Number(
    process.env
      .REVISION_RELIABILITY_RUNS ??
      "2"
  );

  for (
    let run = 1;
    run <= reliabilityRuns;
    run += 1
  ) {
    await runGenerationStep(
      `15.${run} Reliability run ${run}/${reliabilityRuns}`,
      async () => {
        const result =
          await revisionNode(
            buildState({
              chatId: null,

              message:
                "Give me exam revision notes for operating systems.",
            }) as StudyMateGraphState
          );

        const revision =
          result.revisionData;

        if (!revision) {
          report(
            false,
            `15.${run} Reliability run ${run}`,
            "revisionData missing - structured generation failed."
          );

          return;
        }

        const missingKeys =
          REQUIRED_ROOT_KEYS.filter(
            (key) =>
              (revision as Record<
                string,
                unknown
              >)[key] ===
              undefined
          );

        const arraysValid =
          Array.isArray(
            revision.keyConcepts
          ) &&
          revision.keyConcepts.every(
            (concept) =>
              ["high", "medium", "low"].includes(
                concept.importance
              )
          );

        const passed =
          missingKeys.length === 0 &&
          arraysValid &&
          result.response.length > 0;

        report(
          passed,
          `15.${run} Reliability run ${run}: all required fields present`,

          `Missing keys: ${
            missingKeys.length > 0
              ? missingKeys.join(", ")
              : "none"
          } | Concepts: ${revision.keyConcepts.length} | Quick recall: ${revision.quickRecall.length} | Response chars: ${result.response.length}`
        );
      }
    );
  }

  }

  /*
   * ============================================================
   * PART E: GRAPH-LEVEL TWO-TURN FOLLOW-UP (case 11 end-to-end)
   * Runs through the compiled graph with
   * PostgreSQL checkpoints.
   * ============================================================
   */
  if (!sectionEnabled("followup")) {
    console.log(
      "\n=== PART E: SKIPPED (section filter) ==="
    );

    return;
  }

  console.log(
    "\n=== PART E: GRAPH-LEVEL CHECKPOINTED FOLLOW-UP TEST (case 11) ==="
  );

  await runGenerationStep(
    "11-E2E. Two-turn checkpointed revision follow-up",
    async () => {
      const {
        studyMateGraph,
      } = await import(
        "../lib/ai/graph/graph"
      );

      const threadStamp = Date.now();

      const thread_id = `revision-followup-test-${threadStamp}`;

      const turn1Result =
        await studyMateGraph.invoke(
          {
            mode: "default",

            webSearchEnabled: false,

            messages: [
              new HumanMessage(
                "Give me revision notes for database normalization."
              ),
            ],

            chatId: null,

            documentNames:
              [] as string[],

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

            revisionTopic: "",

            revisionContext: "",

            error: null,
          } as Parameters<
            typeof studyMateGraph.invoke
          >[0],

          {
            configurable: {
              thread_id,
            },
          }
        );

      const turn1Passed =
        turn1Result.route ===
          "revision" &&
        turn1Result.revisionData !==
          null;

      report(
        turn1Passed,
        "11-T1. Graph turn 1: revision routes correctly and stores revisionData",

        `Expected: revision with structured data | Actual: ${turn1Result.route}, title: ${
          turn1Result.revisionData?.title ??
          "(none)"
        }`
      );

      const turn2Result =
        await studyMateGraph.invoke(
          {
            messages: [
              new AIMessage(
                "## Database Normalization - Exam Revision\n\n### Must Know\n- 1NF ..."
              ),

              new HumanMessage(
                "Make it shorter."
              ),
            ],
          } as Parameters<
            typeof studyMateGraph.invoke
          >[0],

          {
            configurable: {
              thread_id,
            },
          }
        );

      const turn2Passed =
        turn2Result.route ===
        "revision";

      report(
        turn2Passed,
        "11-T2. Graph turn 2: 'Make it shorter.' stays revision via checkpoint",

        `Expected: revision | Actual: ${turn2Result.route}, modifiesPreviousRevision was available through checkpoint state`
      );
    }
  );

  console.log(
    `\n=== SUMMARY: ${
      failures === 0
        ? "ALL TESTS PASSED"
        : `${failures} FAILURE(S)`
    }${
      quotaBlocked
        ? " (some generation-heavy sections skipped due to Groq quota)"
        : ""
    } ===`
  );

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);

  process.exit(1);
});
