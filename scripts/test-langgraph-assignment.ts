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
    | "assignment"
    | null;

  documentNames?: string[];

  attachedThisTurn?: boolean;

  assignmentData?: unknown;
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

    assignmentTopic: "",

    assignmentContext: "",

    assignmentData:
      (options.assignmentData as StudyMateGraphState["assignmentData"]) ??
      null,

    response: "",

    error: null,
  };
}

const BRIEF_DOCUMENT_NAME =
  "CloudSync Assignment Brief.pdf";

const RUBRIC_DOCUMENT_NAME =
  "Marking Rubric.pdf";

const UNRELATED_DOCUMENT_NAME =
  "PythonRecursion Notes.pdf";

/*
 * Fixture topics are deliberately narrow.
 * Grounded guidance may reference these but
 * must NOT invent outside topics or rubric
 * criteria that were never in the documents.
 */
const FIXTURE_TOPICS = [
  "dashboard",

  "payment",

  "inventory",
];

const FOREIGN_MARKERS = [
  "quantum",

  "photosynthesis",

  "french revolution",

  "creativity and innovation weighting",
];

const REQUIRED_ROOT_KEYS = [
  "title",

  "taskType",

  "objective",

  "assumptions",

  "draftStrengths",

  "commonMistakes",

  "improvementSuggestions",

  "nextActions",

  "requirements",

  "suggestedStructure",

  "taskBreakdown",

  "rubricFocus",
] as const;

const ALL_SECTIONS = [
  "routing",

  "grounding",

  "draft",

  "honesty",

  "followup",

  "honestydoc",
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
  requestedSections.length === 0 ||
  requestedSections.includes(section);

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
        `\nSKIP | ${name} (skipped: provider quota exhausted earlier in this run)`
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
          `\nSKIP | ${name} (provider quota/rate limit reached - stopping token-consuming checks per policy)`
        );

        return false;
      }

      throw error;
    }
  }

  const { routerNode } =
    await import("../lib/ai/graph/router");

  const { assignmentNode } =
    await import("../lib/ai/graph/graph");

  /*
   * ============================================================
   * PART A: ROUTING MATRIX (cases 1-8 + overlap guards)
   * ============================================================
   */
  if (sectionEnabled("routing")) {
    console.log(
      "\n=== PART A: ASSIGNMENT ROUTING TESTS ==="
    );

    type RoutingCase = {
      name: string;

      message: string;

      expect:
        | string
        | ((route: string) => boolean);

      expectLabel?: string;

      history?: TurnMessage[];

      previousRoute?:
        | "direct"
        | "document"
        | "web"
        | "quiz"
        | "planner"
        | "revision"
        | "assignment"
        | null;

      documentNames?: string[];
    };

    const routingCases: RoutingCase[] = [
      {
        name: "1. 'Help me understand this assignment.' -> assignment",

        message:
          "Help me understand this assignment.",

        expect: "assignment",
      },
      {
        name: "2. 'Break down this assignment question for me.' -> assignment",

        message:
          "Break down this assignment question for me.",

        expect: "assignment",
      },
      {
        name: "3. 'Create an outline for my cloud computing report.' -> assignment",

        message:
          "Create an outline for my cloud computing report.",

        expect: "assignment",
      },
      {
        name: "4. 'Make me a 7-day plan for this assignment.' -> planner (planner priority)",

        message:
          "Make me a 7-day plan for this assignment.",

        expect: "planner",
      },
      {
        name: "5. 'Quiz me on database normalization.' -> quiz",

        message:
          "Quiz me on database normalization.",

        expect: "quiz",
      },
      {
        name: "6. 'Give me revision notes for normalization.' -> revision",

        message:
          "Give me revision notes for normalization.",

        expect: "revision",
      },
      {
        name: "7. 'Explain normalization.' -> direct",

        message:
          "Explain normalization.",

        expect: "direct",
      },
      {
        name: "8. 'What is the latest AWS Lambda pricing?' -> web",

        message:
          "What is the latest AWS Lambda pricing?",

        expect: "web",
      },
      {
        name: "A1. 'Quiz me on this assignment content.' -> quiz (not hijacked)",

        message:
          "Quiz me on this assignment content.",

        expect: "quiz",

        previousRoute: "assignment",
      },
      {
        name: "A2. 'Give me revision notes from this assignment PDF.' -> revision",

        message:
          "Give me revision notes from this assignment PDF.",

        expect: "revision",

        documentNames: [
          BRIEF_DOCUMENT_NAME,
        ],
      },
      {
        name: "A3. 'Make me a 7-day plan for my assignment.' -> planner",

        message:
          "Make me a 7-day plan for my assignment.",

        expect: "planner",
      },
      {
        name: "A4. 'What does this rubric require?' -> assignment",

        message:
          "What does this rubric require?",

        expect: "assignment",
      },
      {
        name: "A5. 'Review my introduction and tell me how to improve it.' -> assignment",

        message:
          "Review my introduction and tell me how to improve it.",

        expect: "assignment",
      },
      {
        name: "11-T2. 'Make it shorter.' after an assignment turn -> assignment",

        message:
          "Make it shorter.",

        expect: "assignment",

        history: [
          {
            role: "user",

            content:
              "Create an outline for my database assignment.",
          },

          {
            role: "assistant",

            content:
              "## Database Assignment Breakdown\n\n### Suggested Structure\n1. Introduction...",
          },
        ],

        previousRoute: "assignment",
      },
      {
        name: "13. 'Focus more on methodology.' after an assignment turn -> assignment",

        message:
          "Focus more on methodology.",

        expect: "assignment",

        history: [
          {
            role: "user",

            content:
              "Create an outline for my database assignment.",
          },

          {
            role: "assistant",

            content:
              "## Database Assignment Breakdown\n\n### Suggested Structure\n1. Introduction...",
          },
        ],

        previousRoute: "assignment",
      },
      {
        name: "A6. 'Make it shorter.' WITHOUT any prior turn resolves through the routing LLM to a valid route",

        message:
          "Make it shorter.",

        expect: (route: string) =>
          [
            "direct",

            "document",

            "web",

            "quiz",

            "planner",

            "revision",

            "assignment",
          ].includes(route),

        expectLabel:
          "any valid route (LLM decides)",

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
    ];

    for (const testCase of routingCases) {
      const result = await routerNode(
        buildState({
          chatId:
            "cmassignroutetest000000001",

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
          testCase.expectLabel ??
          (typeof testCase.expect ===
            "string"
            ? testCase.expect
            : "custom")
        } | Actual: ${result.route}`
      );
    }
  } else {
    console.log(
      "\n=== PART A: SKIPPED (section filter) ==="
    );
  }

  /*
   * ============================================================
   * PART B: DOCUMENT GROUNDING GATES (cases 9, 10, 11, 16, 17)
   * Three-document fixture: brief + rubric + unrelated PDF.
   * ============================================================
   */
  let fixtureChatId: string | null =
    null;

  if (!sectionEnabled("grounding")) {
    console.log(
      "\n=== PART B: SKIPPED (section filter) ==="
    );
  } else {
    console.log(
      "\n=== PART B: ASSIGNMENT DOCUMENT-GROUNDING TESTS ==="
    );

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
            "[routing-test] assignment fixture",
        },
      });

    fixtureChatId = chat.id;

    const createdDocumentIds: string[] =
      [];

    try {
      const briefDoc =
        await prisma.document.create({
          data: {
            chatId: chat.id,

            name: BRIEF_DOCUMENT_NAME,

            type: "application/pdf",

            size: 1024,

            extractedText: `
CloudSync coursework task sheet. Task one: analyse the CloudSync admin dashboard and identify two usability problems. Task two: evaluate the payment processing flow and compare monthly versus annual billing. Task three: produce a short inventory tracking report.

Deliverables: a 2000-word report covering all three tasks plus supporting diagrams. Submit as PDF.
          `.trim(),

            chunks: {
              create: [
                {
                  chunkIndex: 0,

                  pageNumber: 1,

                  content:
                    "Assignment brief part 1: Analyse the CloudSync admin dashboard and identify two usability problems. Evaluate the payment processing flow and compare monthly versus annual billing options.",
                },

                {
                  chunkIndex: 1,

                  pageNumber: 2,

                  content:
                    "Assignment brief part 2: Deliverables are a 2000-word report covering the dashboard analysis, payment evaluation, and inventory tracking report, with supporting diagrams included.",
                },
              ],
            },
          },

          include: { chunks: true },
        });

      createdDocumentIds.push(
        briefDoc.id
      );

      const rubricDoc =
        await prisma.document.create({
          data: {
            chatId: chat.id,

            name: RUBRIC_DOCUMENT_NAME,

            type: "application/pdf",

            size: 1024,

            extractedText: `
Marking rubric for the CloudSync coursework. Analysis depth carries forty percent. Implementation correctness carries thirty percent. Report structure and clarity carry twenty percent. Referencing quality carries ten percent.
          `.trim(),

            chunks: {
              create: [
                {
                  chunkIndex: 0,

                  pageNumber: 1,

                  content:
                    "Rubric criterion: Analysis depth (40 percent). Marks depend on evaluating trade-offs rather than describing features superficially.",
                },

                {
                  chunkIndex: 1,

                  pageNumber: 1,

                  content:
                    "Rubric criteria continue: Implementation correctness (30 percent), Report structure and clarity (20 percent), Referencing quality (10 percent). Higher bands require explicit justification.",
                },
              ],
            },
          },

          include: { chunks: true },
        });

      createdDocumentIds.push(
        rubricDoc.id
      );

      const unrelatedDoc =
        await prisma.document.create({
          data: {
            chatId: chat.id,

            name: UNRELATED_DOCUMENT_NAME,

            type: "application/pdf",

            size: 1024,

            extractedText: `
Python recursion study notes. A recursive function calls itself with a smaller input and must include a base case to terminate.
          `.trim(),

            chunks: {
              create: [
                {
                  chunkIndex: 0,

                  pageNumber: 1,

                  content:
                    "Recursion in Python means a function calls itself. Every recursive function needs a base case such as factorial(0) = 1 to stop the calls.",
                },
              ],
            },
          },

          include: { chunks: true },
        });

      createdDocumentIds.push(
        unrelatedDoc.id
      );

      const allChunks =
        [
          ...briefDoc.chunks,

          ...rubricDoc.chunks,

          ...unrelatedDoc.chunks,
        ];

      const embeddings =
        await embedTexts(
          allChunks.map(
            (chunk) => chunk.content
          )
        );

      await saveChunkEmbeddings(
        allChunks.map(
          (chunk, index) => ({
            id: chunk.id,

            embedding:
              embeddings[index],
          })
        )
      );

      console.log(
        `\nFixture ready: ${allChunks.length} embedded chunks across 3 documents in chat ${chat.id}`
      );

      const docNames = [
        BRIEF_DOCUMENT_NAME,

        RUBRIC_DOCUMENT_NAME,

        UNRELATED_DOCUMENT_NAME,
      ];

      type GroundingCase = {
        name: string;

        message: string;

        expectContext: boolean;

        contextMustInclude?: string[];

        maxCitations?: number;
      };

      const groundingCases: GroundingCase[] =
        [
          {
            name: "9. Brief exists + 'Help me understand this assignment.' -> assignment WITH document context",

            message:
              "Help me understand this assignment.",

            expectContext: true,

            contextMustInclude: [
              "CloudSync",
            ],
          },
          {
            name: "10. Rubric exists + 'What does this rubric require?' -> assignment WITH document context",

            message:
              "What does this rubric require?",

            expectContext: true,

            contextMustInclude: [
              "Analysis depth",
            ],
          },
          {
            name: "11. 'Help me structure a Python assignment.' -> assignment WITHOUT unrelated grounding",

            message:
              "Help me structure a Python assignment.",

            expectContext: false,
          },
          {
            name: "17. 'Break down this task using the assignment brief and the rubric.' -> uses BOTH documents",

            message:
              "Break down this task using the assignment brief and the rubric.",

            expectContext: true,

            contextMustInclude: [
              "CloudSync",

              "Analysis depth",
            ],
          },
        ];

      for (const testCase of groundingCases) {
        await runGenerationStep(
          testCase.name,
          async () => {
            const result =
              await assignmentNode(
                buildState({
                  chatId: chat.id,

                  message:
                    testCase.message,

                  documentNames:
                    docNames,
                }) as StudyMateGraphState
              );

            const contextLength =
              (
                result.assignmentContext ??
                ""
              ).length;

            const hasExpectedMarkers =
              !testCase.expectContext ||
              (testCase.contextMustInclude ??
                []).every((marker) =>
                  (
                    result.assignmentContext ??
                    ""
                  )
                    .toLowerCase()
                    .includes(
                      marker.toLowerCase()
                    )
                );

            const citationsPresent = (
              result.documentCitations ?? []
            ).length > 0;

            const citationBehavior =
              testCase.expectContext
                ? citationsPresent
                : true;

            let evidenceBackedClaims = true;

            let inventedMarkers: string[] =
              [];

            const guidance =
              result.assignmentData;

            if (
              testCase.expectContext &&
              guidance
            ) {
              const guidanceText = JSON.stringify(
                [
                  ...guidance.rubricFocus.map(
                    (criterion) => ({
                      text: criterion.criterion,
                    })
                  ),

                  ...guidance.requirements.map(
                    (requirement) => ({
                      text: requirement.requirement,
                    })
                  ),
                ]
              ).toLowerCase();

              inventedMarkers =
                FOREIGN_MARKERS.filter(
                  (marker) =>
                    guidanceText.includes(
                      marker
                    )
                );

              const referencesFixtureTopic =
                FIXTURE_TOPICS.some(
                  (topic) =>
                    guidanceText.includes(
                      topic
                    )
                );

              evidenceBackedClaims =
                  inventedMarkers.length === 0 &&
                  (referencesFixtureTopic ||
                    guidance.rubricFocus.length > 0 ||
                    guidance.requirements.length > 0);
            }

            const passed =
              (contextLength > 0) ===
                testCase.expectContext &&
              hasExpectedMarkers &&
              citationBehavior &&
              evidenceBackedClaims;

            report(
              passed,
              testCase.name,

              `Expected context: ${
                testCase.expectContext
                  ? "document-grounded (+ citations)"
                  : "none"
              } | Context length: ${contextLength} | Citations: ${
                result.documentCitations?.length ?? 0
              } | Markers ok: ${hasExpectedMarkers} | Invented: ${
                inventedMarkers.join(", ") || "none"
              }`
            );
          }
        );
      }

      /*
       * ============================================================
       * PASTED-DRAFT REGRESSION (Issue 1, cases A-E)
       * A pasted draft is the review target; an
       * old uploaded PDF must not be retrieved
       * implicitly. Explicit document references
       * override the suppression.
       * ============================================================
       */
      console.log(
        "\n=== PART B2: PASTED-DRAFT GROUNDING SUPPRESSION ==="
      );

      const cloudIntroDraft =
        "Cloud computing has become one of the most important technologies in modern software engineering, transforming how organisations provision infrastructure and deliver services to their customers.";

      type PasteCase = {
        name: string;

        message: string;

        expectContext: boolean;
      };

      const pasteCases: PasteCase[] = [
        {
          name: "1A. PDF exists + pasted introduction review -> NO document retrieval",

          message: `Review this introduction:\n\n${cloudIntroDraft}`,

          expectContext: false,
        },
        {
          name: "1A-short. PDF exists + SHORT pasted introduction review -> NO document retrieval",

          message:
            "Review this introduction: Cloud computing has transformed how organisations provision infrastructure and deliver services.",

          expectContext: false,
        },
        {
          name: "1B. PDF exists + 'Review this introduction using the uploaded rubric:' -> grounded",

          message: `Review this introduction using the uploaded rubric:\n\n${cloudIntroDraft}`,

          expectContext: true,
        },
        {
          name: "1B-short. PDF exists + explicit rubric ref with SHORT paste -> grounded",

          message:
            "Review this introduction using the uploaded rubric: Cloud computing has transformed how organisations provision infrastructure and deliver services.",

          expectContext: true,
        },
        {
          name: "1C. 'Compare this draft with the assignment brief:' -> grounded",

          message: `Compare this draft with the assignment brief:\n\n${cloudIntroDraft}`,

          expectContext: true,
        },
      ];

      // 1D runs separately with chatId null below.

      for (const testCase of pasteCases) {
        await runGenerationStep(
          testCase.name,
          async () => {
            const result =
              await assignmentNode(
                buildState({
                  chatId: chat.id,

                  message:
                    testCase.message,

                  documentNames:
                    docNames,

                  history: [
                    {
                      role: "user",

                      content:
                        "Here is my CloudSync assignment.",
                    },

                    {
                      role: "assistant",

                      content:
                        "Got it - the brief covers the dashboard analysis, payment evaluation, and inventory report tasks.",
                    },
                  ],

                  previousRoute:
                    "document",
                }) as StudyMateGraphState
              );

            const contextLength =
              (
                result.assignmentContext ?? ""
              ).length;

            const citations =
              result.documentCitations?.length ??
              0;

            const passed =
              (contextLength > 0) ===
                testCase.expectContext &&
              (testCase.expectContext ||
                citations === 0);

            report(
              passed,
              testCase.name,

              `Expected context: ${
                testCase.expectContext
                  ? "grounded"
                  : "suppressed"
              } | Context length: ${contextLength} | Citations: ${citations}`
            );
          }
        );
      }

      await runGenerationStep(
        "1D. No documents + pasted draft review -> guidance without retrieval",
        async () => {
          const noDocResult =
            await assignmentNode(
              buildState({
                chatId: null,

                message: `Give feedback on this draft:\n\n${cloudIntroDraft}`,
              }) as StudyMateGraphState
            );

          const guidance =
            noDocResult.assignmentData ??
            null;

          const passed =
            (noDocResult.assignmentContext ?? "")
              .length === 0 &&
            (noDocResult.documentCitations ?? [])
              .length === 0 &&
            guidance !== null;

          report(
            passed,
            "1D. No documents + pasted draft review -> normal guidance",

            `Context length: ${
              (
                noDocResult.assignmentContext ?? ""
              ).length
            } | Guidance produced: ${guidance !== null}`
          );
        }
      );

      await runGenerationStep(
        "1E. Follow-up after grounded assignment turn still modifies checkpointed guidance",
        async () => {
          const followupResult =
            await assignmentNode(
              buildState({
                chatId: null,

                message:
                  "Make it shorter.",

                previousRoute:
                  "assignment",

                assignmentData: {
                  title:
                    "Cloud Computing Report Outline",

                  taskType: "report outline",

                  objective:
                    "Outline for the cloud computing report.",

                  assumptions: [],

                  draftStrengths: [],

                  commonMistakes: [],

                  improvementSuggestions: [
                    "Add evaluation criteria."
                  ],

                  nextActions: [],

                  requirements: [],

                  suggestedStructure: [
                    {
                      section:
                        "Introduction",

                      purpose:
                        "Set scope.",

                      suggestedPoints: [
                        "Definitions"
                      ],
                    },

                    {
                      section:
                        "Methodology",

                      purpose:
                        "Explain approach.",

                      suggestedPoints: [
                        "Comparison framework"
                      ],
                    },
                  ],

                  taskBreakdown: [],

                  rubricFocus: [],
                } as StudyMateGraphState["assignmentData"]
              }) as StudyMateGraphState
            );

          const shortened =
            followupResult.assignmentData ??
            null;

          const passed =
            shortened !== null &&
            shortened.title.length > 0 &&
            shortened.objective.length > 0;

          report(
            passed,
            "1E. Follow-up modification reuses checkpointed assignment state",

            `Structure sections after 'make it shorter': ${
              shortened?.suggestedStructure.length ??
              "n/a"
            } (was 2)`
          );
        }
      );
    } finally {
      for (const documentId of createdDocumentIds) {
        await prisma.document
          .delete({
            where: { id: documentId },
          })
          .catch(() => undefined);
      }

      if (fixtureChatId) {
        await prisma.chat
          .delete({
            where: {
              id: fixtureChatId,
            },
          })
          .catch(() => undefined);
      }

      console.log(
        "\nFixture cleaned up (test chat, documents, and chunks removed)."
      );
    }
  }

  /*
   * ============================================================
   * PART C: DRAFT REVIEW (case 14)
   * ============================================================
   */
  if (!sectionEnabled("draft")) {
    console.log(
      "\n=== PART C: SKIPPED (section filter) ==="
    );
  } else {
    console.log(
      "\n=== PART C: DRAFT REVIEW TEST (case 14) ==="
    );

    await runGenerationStep(
      "14. 'Review this introduction: ...' -> assignment + feedback structure",
      async () => {
        const {
          renderAssignmentMarkdown,
        } = await import(
          "../lib/ai/agents/assignment-assistant-agent"
        );

        const draftResult =
          await assignmentNode(
            buildState({
              chatId: null,

              message:
                "Review this introduction:\n\nCloud computing is very important nowadays. Many companies use cloud computing. In this report I will talk about cloud computing and some problems with it. I will also discuss the dashboard.",
            }) as StudyMateGraphState
          );

        const guidance =
          draftResult.assignmentData ?? null;

        const missingKeys =
          REQUIRED_ROOT_KEYS.filter(
            (key) =>
              guidance &&
              (guidance as Record<
                string,
                unknown
              >)[key] ===
                undefined
          );

        const feedbackStructured =
          guidance !== null &&
          (guidance.improvementSuggestions
            .length > 0 ||
            guidance.draftStrengths
              .length > 0);

        const rendererMatches =
          guidance !== null &&
          draftResult.response ===
            renderAssignmentMarkdown(
              guidance
            );

        const markdownClean =
          typeof draftResult.response ===
            "string" &&
          draftResult.response.startsWith(
            "## "
          ) &&
          !draftResult.response.includes(
            "<div>"
          ) &&
          !draftResult.response.includes(
            "<br"
          );

        report(
          guidance !== null &&
            missingKeys.length === 0 &&
            feedbackStructured &&
            markdownClean &&
            rendererMatches,
          "14. Draft review returns structured feedback",

          `Missing keys: ${
            missingKeys.join(", ") ||
            "none"
          } | Strengths: ${
            guidance?.draftStrengths.length ?? 0
          } | Improvements: ${
            guidance?.improvementSuggestions.length ?? 0
          } | Clean markdown: ${markdownClean}`
        );
      }
    );
  }

  /*
   * ============================================================
   * PART D: MISSING-RUBRIC HONESTY (case 15)
   * ============================================================
   */
  if (!sectionEnabled("honesty")) {
    console.log(
      "\n=== PART D: SKIPPED (section filter) ==="
    );
  } else {
    console.log(
      "\n=== PART D: NO-RUBRIC-HALLUCINATION TEST (case 15) ==="
    );

    await runGenerationStep(
      "15. 'How can I get full marks?' with no rubric -> no invented criteria",
      async () => {
        const honestyResult =
          await assignmentNode(
            buildState({
              chatId: null,

              message:
                "How can I get full marks on my report?",
            }) as StudyMateGraphState
          );

        const guidance =
          honestyResult.assignmentData ?? null;

        const noInventedRubric =
          guidance === null ||
          (guidance.rubricFocus.length ===
            0 &&
            guidance.assumptions.some(
              (assumption) =>
                /rubric|grading|criteria|marks/i.test(
                  assumption
                )
            ));

        report(
          noInventedRubric,
          "15. Missing rubric produces no invented grading criteria",

          `rubricFocus entries: ${
            guidance?.rubricFocus.length ?? "n/a"
          } | Assumptions mention rubric/criteria: ${
            guidance?.assumptions.some((assumption) =>
              /rubric|grading|criteria|marks/i.test(
                assumption
              )
            ) ?? false
          }`
        );
      }
    );
  }

  /*
   * ============================================================
   * PART F: DOCUMENT-TYPE HONESTY REGRESSION (Issue: speech mislabeled as brief)
   * ============================================================
   */
  if (!sectionEnabled("honestydoc")) {
    console.log(
      "\n=== PART F: SKIPPED (section filter) ==="
    );
  } else {
    console.log(
      "\n=== PART F: DOCUMENT-TYPE HONESTY TESTS ==="
    );

  const {
    prisma,
  } = await import("../lib/prisma");

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

  const honestyChat =
    await prisma.chat.create({
      data: {
        userId: owner.id,

        title:
          "[routing-test] assignment honesty fixture",
      },
    });

  let speechDocId: string | null = null;

  let genuineBriefDocId: string | null =
    null;

  try {
    const speechDoc =
      await prisma.document.create({
        data: {
          chatId: honestyChat.id,

          name:
            "Saw_Lwin_Htoo_Valedictorian_Speech_2026.pdf",

          type: "application/pdf",

          size: 1024,

          extractedText: `
Good evening everyone, teachers, parents, and fellow graduates. Standing here today as valedictorian of the class of 2026 is an honour I could never have imagined when I first walked through these doors.

We spent countless nights preparing for examinations, but the friendships we built in classrooms and on the sports field taught us far more than any syllabus. I want to thank every teacher who stayed behind after class to explain a difficult concept one more time.

As we step into the future, let us remember that success is not measured by grades alone but by the kindness we show and the curiosity we keep alive.
          `.trim(),

          chunks: {
            create: [
              {
                chunkIndex: 0,

                pageNumber: 1,

                content:
                  "Valedictorian speech for the graduating class of 2026. The speaker thanks teachers and parents and reflects on friendships built during school years.",
              },

              {
                chunkIndex: 1,

                pageNumber: 1,

                content:
                  "Closing message: success is not measured by grades alone but by kindness and curiosity as graduates step into the future.",
              },
            ],
          },
        },

        include: { chunks: true },
      });

    speechDocId = speechDoc.id;

    /*
     * Only the speech exists during case A.
     * The genuine brief is added right before
     * case B so case A cannot retrieve it.
     */
    const speechEmbeddings =
      await embedTexts(
        speechDoc.chunks.map((chunk) => chunk.content)
      );

    await saveChunkEmbeddings(
      speechDoc.chunks.map(
        (chunk, index) => ({
          id: chunk.id,

          embedding: speechEmbeddings[index],
        })
      )
    );

    console.log(
      `\nHonesty fixture stage 1: ${speechDoc.chunks.length} embedded chunks (speech only)`
    );


    const guidanceSchemaKeys = [
      "title",

      "taskType",

      "objective",

      "assumptions",
    ];

    /*
     * A. Speech mislabeled as "brief" -> no
     * invented word count / citation style /
     * rubric; document type called out.
     */
    await runGenerationStep(
      "A. Valedictorian speech labeled 'uploaded brief' -> no invented requirements",
      async () => {
        const result =
          await assignmentNode(
            buildState({
              chatId: honestyChat.id,

              message:
                "Help me structure this assignment using the uploaded brief.",

              documentNames: [
                "Saw_Lwin_Htoo_Valedictorian_Speech_2026.pdf",
              ],

              previousRoute: "document",
            }) as StudyMateGraphState
          );

        const guidance =
          result.assignmentData ?? null;

        if (!guidance) {
          report(
            false,
            "A. Speech-as-brief honesty",
            "No structured guidance returned."
          );

          return;
        }

        /*
         * Assumptions are the designated place
         * for labeled guesses - fidelity checks
         * scan only fact-bearing fields.
         */
        const assumptionText = guidance.assumptions
          .join(" \n ")
          .toLowerCase();

        const factText =
          JSON.stringify({
            objective: guidance.objective,

            requirements: guidance.requirements,

            rubricFocus: guidance.rubricFocus,

            nextActions: guidance.nextActions,

            title: guidance.title,

            taskType: guidance.taskType,

            suggestedStructure:
              guidance.suggestedStructure,
          }).toLowerCase();

        const inventedWordCount =
          /\b1[0-9]{3}[\s-]*(word|wordcount)\b/.test(
            factText
          );

        const inventedHarvard =
          /\bharvard\b/.test(factText);

        const inventedPercentages =
          /\b\d{1,2}\s?%/.test(factText);

        const callsOutMismatch =
          assumptionText.includes(
            "does not appear to contain assignment brief"
          ) || /speech/.test(assumptionText);

        report(
          !inventedWordCount &&
            !inventedHarvard &&
            !inventedPercentages &&
            callsOutMismatch,
          "A. Speech-as-brief honesty",

          `inventedWordCount=${inventedWordCount} inventedHarvard=${inventedHarvard} inventedPercentages=${inventedPercentages} mismatchCalledOut=${callsOutMismatch}`

        );
      }
    );

    /*
     * Stage 2: add the genuine brief so case B
     * can verify grounded extraction.
     */
    const genuineBriefDoc =
      await prisma.document.create({
        data: {
          chatId: honestyChat.id,

          name: "CloudSync Assignment Brief.pdf",

          type: "application/pdf",

          size: 1024,

          extractedText: `
Assignment brief. Write a 1500-word report on the CloudSync platform. Use Harvard referencing for all sources. The methodology section carries a weighting of 20% of the final mark. Submit as PDF.
          `.trim(),

          chunks: {
            create: [
              {
                chunkIndex: 0,

                pageNumber: 1,

                content:
                  "Assignment brief: Write a 1500-word report analysing the CloudSync platform. All sources must use Harvard referencing.",
              },

              {
                chunkIndex: 1,

                pageNumber: 1,

                content:
                  "Marking note: the methodology section carries a weighting of 20%. Submit the report as PDF.",
              },
            ],
          },
        },

        include: { chunks: true },
      });

    genuineBriefDocId =
      genuineBriefDoc.id;

    const briefEmbeddings =
      await embedTexts(
        genuineBriefDoc.chunks.map((chunk) => chunk.content)
      );

    await saveChunkEmbeddings(
      genuineBriefDoc.chunks.map(
        (chunk, index) => ({
          id: chunk.id,

          embedding: briefEmbeddings[index],
        })
      )
    );

    console.log(
      "\nHonesty fixture stage 2: genuine brief added"
    );

    /*
     * B. Genuine brief with explicit details ->
     * grounded extraction still works.
     */
    await runGenerationStep(
      "B. Genuine brief with 1500 words / Harvard / Methodology 20% -> extracted as grounded requirements",
      async () => {
        const result =
          await assignmentNode(
            buildState({
              chatId: honestyChat.id,

              message:
                "Help me understand this assignment using the uploaded brief.",

              documentNames: [
                "CloudSync Assignment Brief.pdf",
              ],

              previousRoute: "document",
            }) as StudyMateGraphState
          );

        const guidance =
          result.assignmentData ?? null;

        if (!guidance) {
          report(
            false,
            "B. Genuine brief grounding",
            "No structured guidance returned."
          );

          return;
        }

        const fullText = JSON.stringify(
          guidance
        ).toLowerCase();

        const hasWordCount =
          fullText.includes("1500");

        const hasHarvard =
          /\bharvard\b/.test(fullText);

        const hasMethodologyWeighting =
          /methodology/.test(fullText) &&
          /20\s?%|20 percent/.test(fullText);

        report(
          hasWordCount &&
            hasHarvard &&
            hasMethodologyWeighting,
          "B. Genuine brief grounding",

          `1500 words=${hasWordCount} harvard=${hasHarvard} methodology20=${hasMethodologyWeighting}`
        );
      }
    );

    /*
     * C. No document -> general suggestions fine,
     * unknown specifics must not appear as facts.
     */
    await runGenerationStep(
      "C. No document + general request -> suggestions only, no fabricated specifics",
      async () => {
        const result =
          await assignmentNode(
            buildState({
              chatId: null,

              message:
                "Create an outline for my cloud computing assignment.",
            }) as StudyMateGraphState
          );

        const guidance =
          result.assignmentData ?? null;

        if (!guidance) {
          report(
            false,
            "C. No-document general help",
            "No structured guidance returned."
          );

          return;
        }

        const requirementsText = JSON.stringify(
          guidance.requirements
        ).toLowerCase();

        const rubricEmpty =
          guidance.rubricFocus.length === 0;

        const noFabricatedStyleOrCount =
          !/\bharvard\b|\bapa\b|\bmla\b|\b\d{3,5}\s*words?\b/.test(
            requirementsText
          );

        const assumptionsLabeled =
          guidance.assumptions.length > 0 ||
          guidance.nextActions.some((action) =>
            /rubric|brief|confirm/i.test(action)
          );

        report(
          rubricEmpty &&
            noFabricatedStyleOrCount &&
            assumptionsLabeled &&
            guidance.requirements.every((requirement) =>
              ["required", "recommended", "optional"].includes(
                requirement.importance
              )
            ),
          "C. No-document general help stays honest",

          `rubricFocus=${guidance.rubricFocus.length} fabricatedSpecifics=${!noFabricatedStyleOrCount} assumptions=${guidance.assumptions.length}`
        );
      }
    );
  } finally {
    if (speechDocId) {
      await prisma.document
        .delete({
          where: { id: speechDocId },
        })
        .catch(() => undefined);
    }

    if (genuineBriefDocId) {
      await prisma.document
        .delete({
          where: { id: genuineBriefDocId },
        })
        .catch(() => undefined);
    }

    await prisma.chat
      .delete({
        where: { id: honestyChat.id },
      })
      .catch(() => undefined);

    console.log(
      "\nHonesty fixture cleaned up."
    );
  }

  }

  /*
   * ============================================================
   * PART G: DETERMINISTIC REGRESSION (Bugs 1-3, zero quota)
   * ============================================================
   */
  if (!sectionEnabled("grounding") && !sectionEnabled("honestydoc")) {
    console.log(
      "\n=== PART G: SKIPPED (runs with grounding/honestydoc) ==="
    );
  } else {
    console.log(
      "\n=== PART G: DETERMINISTIC REGRESSION TESTS ==="
    );

    const {
      renderAssignmentMarkdown,

      enforceEvidenceFidelity,
    } = await import(
      "../lib/ai/agents/assignment-assistant-agent"
    );

    const {
      detectPastedReviewTarget,
    } = await import("../lib/ai/graph/graph");

    const fs = await import("fs");

    /*
     * G1 - Unicode integrity (Bug 1).
     */
    {
      const unicodeGuidance = {
        title:
          "Cloud Computing Ã¢â‚¬â€ Study Notes",

        taskType: "report outline",

        objective:
          "Introduction Ã¢â‚¬â€ Define cloud computing. StudentÃ¢â‚¬â„¢s report must cover Ã¢â‚¬Å“quoted textÃ¢â‚¬Â and deployment models Ã¢â‚¬â€œ IaaS, PaaS.",

        assumptions: [
          "Assumed standard depth Ã¢â‚¬â€œ not exam specific",
        ],

        draftStrengths: [],

        commonMistakes: [
          "Confusing IaaS with PaaS",
        ],

        improvementSuggestions: [
          "Benefits & Challenges Ã¢â‚¬â€ Analyze cloud adoption drivers.",
        ],

        nextActions: [
          "Draft the Introduction section first.",
        ],

        requirements: [
          {
            requirement:
              "Introduction Ã¢â‚¬â€ Define cloud computing.",

            importance: "required" as const,
          },
        ],

        suggestedStructure: [
          {
            section: "Introduction",

            purpose: "Define scope",

            suggestedPoints: [
              "Definitions & models",
            ],
          },
        ],

        taskBreakdown: [
          {
            step: 1,

            title: "Research",

            description: "Gather sources",
          },
        ],

        rubricFocus: [],
      };

      const rendered =
        renderAssignmentMarkdown(
          unicodeGuidance as never
        );

      const originals = [
        "Introduction Ã¢â‚¬â€ Define cloud computing.",

        "Benefits & Challenges Ã¢â‚¬â€ Analyze cloud adoption drivers.",

        "StudentÃ¢â‚¬â„¢s report",

        "Ã¢â‚¬Å“quoted textÃ¢â‚¬Â",

        "Ã¢â‚¬â€œ IaaS, PaaS",
      ];

      const allPreserved =
        originals.every((original) =>
          rendered.includes(original)
        );

      const noMojibake =
        !/[ÃƒÆ’Ãƒâ€š][\x80-\xFF]/.test(rendered) &&
        !rendered.includes("\uFFFD");

      /*
       * Static source guard: the renderer file
       * itself must not contain double-encoded
       * sequences.
       */
      const source = fs.readFileSync(
        "../lib/ai/agents/assignment-assistant-agent.ts",

        "utf8"
      ) as unknown as string;

      const sourceClean =
        !/[ÃƒÆ’][\x80-\xBF]{2}/.test(source) &&
        !source.includes("\uFFFD");

      report(
        allPreserved &&
          noMojibake &&
          sourceClean,
        "G1. Unicode punctuation survives rendering; no mojibake anywhere",

        `preserved=${allPreserved} noMojibake=${noMojibake} sourceClean=${sourceClean}`
      );
    }

    /*
     * G2 - User-provided constraints survive;
     * model inventions do not (Bug 2).
     */
    {
      const request1500 =
        "Help me structure a 1500-word report about cloud computing.";

        const guidance: import("../lib/ai/agents/assignment-assistant-agent").AssignmentGuidanceResult = {
          title:
            "Cloud Computing Report Structure",

        taskType: "report structure",

        objective:
          "Outline a focused report covering service models and adoption trade-offs within your stated length.",

        assumptions: [],

        draftStrengths: [],

        commonMistakes: [],

        improvementSuggestions: [
          "Include a Harvard reference list for credibility.",
        ],

        nextActions: [
          "Plan sections around the 1500-word limit.",
        ],

        requirements: [
          {
            requirement:
              "1500-word report length as specified by you.",

            importance: "required" as const,
          },
        ],

        suggestedStructure: [
          {
            section: "Introduction",

            purpose: "Scope the report.",

            suggestedPoints: [],
          },
        ],

        taskBreakdown: [],

        rubricFocus: [],
      };

      const result =
        enforceEvidenceFidelity(
          guidance,

          "",

          request1500
        );

      const wordCountPreserved =
        JSON.stringify(result).includes(
          "1500-word"
        ) &&
        !JSON.stringify(result).includes(
          "[length requirement unverified]"
        );

      const harvardMaskedOrRemoved =
        !result.improvementSuggestions.some((item) =>
          /\bharvard\b/i.test(item)
        );

      const mismatchNoteAbsent =
        !result.assumptions.some((assumption) =>
          /does not appear to contain/i.test(
            assumption
          )
        );

      const gradingNotePresent =
        result.assumptions.some((assumption) =>
          /grading|criteria|referencing style/i.test(
            assumption
          )
        );

      report(
        wordCountPreserved &&
          harvardMaskedOrRemoved &&
          mismatchNoteAbsent,
        "G2. User-provided 1500-word constraint preserved; invented Harvard masked",

        `wordCountPreserved=${wordCountPreserved} harvardMasked=${harvardMaskedOrRemoved} gradingNote=${gradingNotePresent} mismatchNoteAbsent=${mismatchNoteAbsent}`
      );
    }

    /*
     * G3 - Document mismatch still enforced when
     * user provides no specifics (speech case).
     */
    {
      const speechContext =
        "Valedictorian speech for the class of 2026 thanking teachers and parents. Success is measured by kindness and curiosity.";

      const speechRequest =
        "Help me structure this assignment using the uploaded brief.";

      const guidance: import("../lib/ai/agents/assignment-assistant-agent").AssignmentGuidanceResult = {
        title: "Structure Suggestion",

        taskType: "structure guidance",

        objective: "General structure suggestion.",

        assumptions: [],

        draftStrengths: [],

        commonMistakes: [],

        improvementSuggestions: [],

        nextActions: [],

        requirements: [
          {
            requirement: "Use Harvard referencing.",

            importance: "required" as const,
          },

          {
            requirement: "Around 2000 words long.",

            importance: "required" as const,
          },
        ],

        suggestedStructure: [],

        taskBreakdown: [],

        rubricFocus: [
          {
            criterion: "Analysis depth",

            whatItMeans: "40% of marks.",

            howToAddress: "Evaluate deeply.",
          },
        ],
      };

      const result =
        enforceEvidenceFidelity(
          guidance,

          speechContext,

          speechRequest
        );

      const fabricatedRemoved =
        result.requirements.length === 0;

      const rubricCleared =
        result.rubricFocus.length === 0;

      const mismatchPresent =
        result.assumptions.some((assumption) =>
          /does not appear to contain assignment brief/i.test(
            assumption
          )
        );

      report(
        fabricatedRemoved &&
          rubricCleared &&
          mismatchPresent,
        "G3. Speech-as-brief: fabricated specifics removed, mismatch labeled",

        `requirementsLeft=${result.requirements.length} rubricFocus=${result.rubricFocus.length} mismatchNote=${mismatchPresent}`
      );
    }

    /*
     * G4 - Pasted-review detector matrix (Bug 3).
     */
    {
      const cases: [string, string, boolean][] = [
        [
          "short inline paste",

          "Review this introduction: Cloud computing has changed education.",

          true,
        ],

        [
          "explicit rubric + paste",

          "Review this introduction using the uploaded rubric: Cloud computing has changed education.",

          true,
        ],

        [
          "long paste",

          `Check this paragraph: ${"Cloud adoption continues to accelerate across industries. ".repeat(6)}`,

          true,
        ],

        [
          "newline paste",

          "Give feedback on this draft:\n\nCloud platforms reduce operational overhead.",

          true,
        ],

        [
          "legit doc ref, no paste",

          "Review this using the uploaded rubric.",

          false,
        ],

        [
          "legit doc ref 2",

          "Compare this draft with the assignment brief.",

          false,
        ],

        [
          "ordinary conversation",

          "Make it shorter.",

          false,
        ],

        [
          "plain explanation ask",

          "Explain this to me.",

          false,
        ],
      ];

      let matrixPassed = true;

      const details: string[] = [];

      for (const [
        label,
        message,
        expected,
      ] of cases) {
        const actual =
          detectPastedReviewTarget(message);

        details.push(
          `${label}=>${actual}`
        );

        if (actual !== expected) {
          matrixPassed = false;
        }
      }

      report(
        matrixPassed,
        "G4. detectPastedReviewTarget matrix",

        details.join(" | ")
      );
    }

    /*
     * G5 - Draft review with no invented criteria (Bug A).
     * A bare "Review this introduction: ..." should
     * NOT produce "required" requirements.
     */
    {
      const bugAGuidance: import("../lib/ai/agents/assignment-assistant-agent").AssignmentGuidanceResult = {
        title: "Introduction Review",
        taskType: "draft review",
        objective: "Review the provided introduction.",
        assumptions: [],
        draftStrengths: ["Clear topic statement"],
        commonMistakes: [],
        improvementSuggestions: ["Add more context"],
        nextActions: ["Revise introduction"],
        requirements: [
          { requirement: "Identify at least two strengths", importance: "required" as const },
          { requirement: "Point out three specific weaknesses", importance: "required" as const },
          { requirement: "Provide concrete suggestions for improvement", importance: "required" as const },
        ],
        suggestedStructure: [],
        taskBreakdown: [],
        rubricFocus: [],
      };

      const result = enforceEvidenceFidelity(
        bugAGuidance,
        "",
        "Review this introduction: Cloud computing has changed how companies deploy software."
      );

      const allDowngraded = result.requirements.every(
        (r) => r.importance !== "required"
      );

      const noMarkersInRendered = (() => {
        const rendered = renderAssignmentMarkdown(result);
        return !/\bunverified\b/.test(rendered) && !/≈\[/.test(rendered);
      })();

      report(
        allDowngraded && noMarkersInRendered,
        "G5. Draft review: no invented required criteria, no fidelity markers in rendered output",
        `requirements=${result.requirements.map((r) => `${r.importance}`).join(",")} noMarkers=${noMarkersInRendered}`
      );
    }

    /*
     * G6 - Explicit user requirement preserved (Bug B).
     * "identify exactly 2 strengths" should remain
     * "required" because the user asked for it.
     */
    {
      const bugBGuidance: import("../lib/ai/agents/assignment-assistant-agent").AssignmentGuidanceResult = {
        title: "Introduction Review",
        taskType: "draft review",
        objective: "Review the provided introduction.",
        assumptions: [],
        draftStrengths: [],
        commonMistakes: [],
        improvementSuggestions: [],
        nextActions: [],
        requirements: [
          { requirement: "Identify exactly 2 strengths", importance: "required" as const },
        ],
        suggestedStructure: [],
        taskBreakdown: [],
        rubricFocus: [],
      };

      const result = enforceEvidenceFidelity(
        bugBGuidance,
        "",
        "Review this introduction and identify exactly 2 strengths."
      );

      const preserved = result.requirements.some(
        (r) => r.importance === "required" && /exactly 2 strengths/i.test(r.requirement)
      );

      report(
        preserved,
        "G6. Explicit user requirement 'identify exactly 2 strengths' preserved as required",
        `preserved=${preserved}`
      );
    }

    /*
     * G7 - Rubric-grounded requirement preserved (Bug C).
     * "Students must identify three weaknesses" from a
     * rubric should be treated as required.
     */
    {
      const bugCGuidance: import("../lib/ai/agents/assignment-assistant-agent").AssignmentGuidanceResult = {
        title: "Assignment Analysis",
        taskType: "rubric analysis",
        objective: "Analyze the assignment against the rubric.",
        assumptions: [],
        draftStrengths: [],
        commonMistakes: [],
        improvementSuggestions: [],
        nextActions: [],
        requirements: [
          { requirement: "Identify three weaknesses", importance: "required" as const },
        ],
        suggestedStructure: [],
        taskBreakdown: [],
        rubricFocus: [],
      };

      const result = enforceEvidenceFidelity(
        bugCGuidance,
        "Rubric: Students must identify three weaknesses.",
        "What does this rubric require?"
      );

      const preserved = result.requirements.some(
        (r) => r.importance === "required" && /three weaknesses/i.test(r.requirement)
      );

      report(
        preserved,
        "G7. Rubric-grounded requirement 'three weaknesses' preserved as required",
        `preserved=${preserved}`
      );
    }

    /*
     * G8 - Rendered markdown contains no internal fidelity markers (Bug E).
     * All [X unverified] and ≈[...] patterns must be
     * stripped before the markdown reaches the UI.
     */
    {
      const bugEGuidance: import("../lib/ai/agents/assignment-assistant-agent").AssignmentGuidanceResult = {
        title: "Report Review",
        taskType: "draft review",
        objective: "Review the report. The assignment expects [length requirement unverified] and [citation style unverified] referencing. The deadline is [deadline unverified].",
        assumptions: ["[weighting unverified] grading applies."],
        draftStrengths: ["Good structure"],
        commonMistakes: [],
        improvementSuggestions: ["Fix [deadline unverified] section"],
        nextActions: [],
        requirements: [],
        suggestedStructure: [],
        taskBreakdown: [],
        rubricFocus: [],
      };

      const rendered = renderAssignmentMarkdown(bugEGuidance);

      const markerPatterns = [
        /\[length requirement unverified\]/i,
        /\[citation style unverified\]/i,
        /\[deadline unverified\]/i,
        /\[weighting unverified\]/i,
        /\[percentage unverified\]/i,
        /\[referencing style unverified\]/i,
        /≈\[/,
        /\bunverified\b/,
      ];

      const foundMarkers = markerPatterns.filter((p) => p.test(rendered));

      report(
        foundMarkers.length === 0,
        "G8. Rendered markdown contains no internal fidelity markers",
        `markersFound=${foundMarkers.length === 0 ? "none" : foundMarkers.map((p) => p.source).join(", ")}`
      );
    }
  }

  /*
   * ============================================================
   * PART E: GRAPH-LEVEL TWO-TURN FOLLOW-UP (cases 12 end-to-end)
   * ============================================================
   */
  if (!sectionEnabled("followup")) {
    console.log(
      "\n=== PART E: SKIPPED (section filter) ==="
    );

    printSummary();

    return;
  }

  console.log(
    "\n=== PART E: GRAPH-LEVEL CHECKPOINTED FOLLOW-UP TEST (case 12) ==="
  );

  await runGenerationStep(
    "12-E2E. Two-turn checkpointed assignment follow-up",
    async () => {
      const {
        studyMateGraph,
      } = await import(
        "../lib/ai/graph/graph"
      );

      const thread_id = `assignment-followup-test-${Date.now()}`;

      const turn1Result =
        await studyMateGraph.invoke(
          {
            mode: "default",

            webSearchEnabled: false,

            messages: [
              new HumanMessage(
                "Create an outline for my database assignment."
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

            assignmentTopic: "",

            assignmentContext: "",

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
          "assignment" &&
        turn1Result.assignmentData !==
          null;

      report(
        turn1Passed,
        "12-T1. Graph turn 1: outline request routes assignment and stores assignmentData",

        `Expected: assignment with structured guidance | Actual: ${turn1Result.route}, title: ${
          turn1Result.assignmentData?.title ??
          "(none)"
        }`
      );

      const turn2Result =
        await studyMateGraph.invoke(
          {
            messages: [
              new AIMessage(
                "## Database Assignment Breakdown\n\n### Suggested Structure\n1. Introduction..."
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

      const modifiesPrevious =
        turn2Result.assignmentData !==
          null && true;

      report(
        turn2Result.route ===
          "assignment" && modifiesPrevious,
        "12-T2. Graph turn 2: 'Make it shorter.' stays assignment via checkpoint",

        `Expected: assignment | Actual: ${turn2Result.route}, previous guidance available through checkpoint state`
      );
    }
  );

  function printSummary() {
    console.log(
      `\n=== SUMMARY: ${
        failures === 0
          ? "ALL TESTS PASSED"
          : `${failures} FAILURE(S)`
      }${
        quotaBlocked
          ? " (some generation-heavy sections skipped due to provider quota)"
          : ""
      } ===`
      );

    if (failures > 0) {
      process.exitCode = 1;
    }
  }

  printSummary();
}

main().catch((error) => {
  console.error(error);

  process.exit(1);
});
