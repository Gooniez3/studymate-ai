import dotenv from "dotenv";
import {
  HumanMessage,
  AIMessage,
} from "@langchain/core/messages";

dotenv.config({
  path: ".env.local",
});

type TurnMessage = {
  role: "user" | "assistant";
  content: string;
};

type RouterCase = {
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
    | null;

  documentNames?: string[];

  documentAttachedThisTurn?: boolean;

  webSearchEnabled?: boolean;
};

async function main() {
  const { routerNode } =
    await import("../lib/ai/graph/router");

  const cases: RouterCase[] = [
    {
      name: "1. General explanation stays direct",

      message:
        "Explain recursion simply.",

      expect: "direct",

      expectLabel: "direct",
    },
    {
      name: "2. Current-events question routes to web",

      message:
        "What is the latest iPhone?",

      expect: "web",

      expectLabel: "web",

      webSearchEnabled: true,

      documentNames: [
        "aurora-lecture.pdf",
      ],
    },
    {
      name: "3. Explicit uploaded-document reference routes to document",

      message:
        "What does my uploaded PDF say about Aurora Notebook?",

      expect: "document",

      expectLabel: "document",

      documentNames: [
        "aurora-lecture.pdf",
      ],
    },
    {
      name: "4. General quiz request routes to quiz",

      message: "Quiz me on recursion.",

      expect: "quiz",

      expectLabel: "quiz",
    },
    {
      name: "5. Document quiz request routes to quiz",

      message:
        "Quiz me on my uploaded PDF.",

      expect: "quiz",

      expectLabel: "quiz",

      documentNames: [
        "aurora-lecture.pdf",
      ],
    },
    {
      name: "6. Follow-up after document answer stays document (explain that more simply)",

      message:
        "Explain that more simply.",

      expect: "document",

      expectLabel: "document",

      history: [
        {
          role: "user",

          content:
            "Explain the Aurora Notebook section from my PDF.",
        },

        {
          role: "assistant",

          content:
            "The Aurora Notebook section covers structured note-taking workflows for lectures.",
        },
      ],

      previousRoute: "document",

      documentNames: [
        "aurora-lecture.pdf",
      ],
    },
    {
      name: "7. Follow-up after page question stays document (what about the assessment)",

      message:
        "What about the assessment?",

      expect: "document",

      expectLabel: "document",

      history: [
        {
          role: "user",

          content:
            "What does page 3 say?",
        },

        {
          role: "assistant",

          content:
            "Page 3 describes the grading rubric and project expectations.",
        },
      ],

      previousRoute: "document",

      documentNames: [
        "course-handbook.pdf",
      ],
    },
    {
      name: "8. Unrelated general question with documents present stays direct",

      message: "What is recursion?",

      expect: "direct",

      expectLabel: "direct",

      documentNames: [
        "old-notes.pdf",
      ],
    },
    {
      name: "9. Latest/current question with documents present stays web",

      message:
        "What is the latest iPhone?",

      expect: "web",

      expectLabel: "web",

      webSearchEnabled: true,

      documentNames: [
        "old-notes.pdf",
      ],
    },
    {
      name: "10. Referential message right after upload routes to document (explain this)",

      message: "Can you explain this?",

      expect: "document",

      expectLabel: "document",

      documentAttachedThisTurn: true,
    },
    {
      name: "11. Follow-up after a web answer never becomes document",

      message: "What about that?",

      expect: (route) =>
        route !== "document",

      expectLabel: "not document",

      history: [
        {
          role: "user",

          content:
            "Who won the last FIFA World Cup?",
        },

        {
          role: "assistant",

          content:
            "Argentina won the 2022 FIFA World Cup.",
        },
      ],

      previousRoute: "web",
    },
    {
      name: "12. Quiz request after document discussion still wins over document",

      message: "Quiz me on this.",

      expect: "quiz",

      expectLabel: "quiz",

      history: [
        {
          role: "user",

          content:
            "Explain the retrieval section from my PDF.",
        },

        {
          role: "assistant",

          content:
            "The retrieval section explains vector similarity search.",
        },
      ],

      previousRoute: "document",

      documentNames: [
        "aurora-lecture.pdf",
      ],
    },
  ];

  let failures = 0;

  console.log(
    "\n=== PART A: ROUTER NODE CONTEXTUAL TESTS ==="
  );

  for (const testCase of cases) {
    const historyMessages =
      testCase.history?.map(
        (turn) =>
          turn.role === "user"
            ? new HumanMessage(
                turn.content
              )
            : new AIMessage(
                turn.content
              )
      ) ?? [];

    const result =
      await routerNode({
        messages: [
          ...historyMessages,

          new HumanMessage(
            testCase.message
          ),
        ],

        chatId:
          "cmctxroutetest000000000000",

        mode: "default",

        webSearchEnabled:
          testCase.webSearchEnabled ??
          false,

        route:
          testCase.previousRoute ??
          "direct",

        previousRoute:
          testCase.previousRoute ??
          null,

        documentNames:
          testCase.documentNames ?? [],

        documentAttachedThisTurn:
          testCase.documentAttachedThisTurn ??
          false,

        documentContext: "",

        webContext: "",

        verificationContext: "",

        webSources: [],

        documentCitations: [],

        quizTopic: "",

        quizContext: "",

        quizData: null,

        response: "",

        error: null,
      });

    const passed =
      typeof testCase.expect ===
      "function"
        ? testCase.expect(
            result.route
          )
        : result.route ===
          testCase.expect;

    if (!passed) {
      failures += 1;
    }

    console.log(
      `\n${passed ? "PASS" : "FAIL"} | ${testCase.name}`
    );

    console.log(
      `  Message: "${testCase.message}"`
    );

    console.log(
      `  Expected: ${testCase.expectLabel} | Actual: ${result.route}`
    );
  }

  /*
   * PART B exercises routing through the
   * compiled graph with PostgreSQL
   * checkpointed history, mirroring how the
   * API invokes it (no manual state resets).
   */
  console.log(
    "\n=== PART B: GRAPH-LEVEL CHECKPOINTED HISTORY TESTS ==="
  );

  const {
    studyMateGraph,
  } = await import(
    "../lib/ai/graph/graph"
  );

  const threadStamp = Date.now();

  type GraphStep = {
    label: string;

    threadSuffix: string;

    input: Record<
      string,
      unknown
    >;

    expect:
      | "document"
      | "direct"
      | "web";
  };

  const baseInput = {
    mode: "default",

    webSearchEnabled: false,
  };

  const steps: GraphStep[] = [
    {
      label:
        "B1-T1 document request starts document conversation",

      threadSuffix: "a",

      input: {
        ...baseInput,

        messages: [
          new HumanMessage(
            "Explain the Aurora Notebook section from my PDF."
          ),
        ],

        chatId:
          "cmctxroutefakechat000000001",

        documentNames: [
          "aurora-lecture.pdf",
        ],

        documentAttachedThisTurn: true,
      },

      expect: "document",
    },
    {
      label:
        "B1-T2 follow-up continues document conversation",

      threadSuffix: "a",

      input: {
        ...baseInput,

        messages: [
          new HumanMessage(
            "Explain that more simply."
          ),
        ],
      },

      expect: "document",
    },
    {
      label:
        "B2-T1 page question starts document conversation",

      threadSuffix: "b",

      input: {
        ...baseInput,

        messages: [
          new HumanMessage(
            "What does page 3 say?"
          ),
        ],

        chatId:
          "cmctxroutefakechat000000002",

        documentNames: [
          "course-handbook.pdf",
        ],
      },

      expect: "document",
    },
    {
      label:
        "B2-T2 assessment follow-up continues document conversation",

      threadSuffix: "b",

      input: {
        ...baseInput,

        messages: [
          new HumanMessage(
            "What about the assessment?"
          ),
        ],
      },

      expect: "document",
    },
    {
      label:
        "B3 unrelated general question with documents stays direct",

      threadSuffix: "c",

      input: {
        ...baseInput,

        messages: [
          new HumanMessage(
            "What is recursion?"
          ),
        ],

        chatId:
          "cmctxroutefakechat000000003",

        documentNames: [
          "old-notes.pdf",
        ],
      },

      expect: "direct",
    },
    {
      label:
        "B4 current-events question stays web",

      threadSuffix: "d",

      input: {
        ...baseInput,

        webSearchEnabled: true,

        messages: [
          new HumanMessage(
            "What is the latest iPhone?"
          ),
        ],

        chatId:
          "cmctxroutefakechat000000004",

        documentNames: [
          "old-notes.pdf",
        ],
      },

      expect: "web",
    },
  ];

  /*
   * Upstream database connections can
   * occasionally fail on the first read.
   * Retry each step on a FRESH thread so a
   * partially written checkpoint never
   * pollutes the next attempt.
   */
  async function invokeStep(
    step: GraphStep,
    stampBase: number
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
          step.input as Parameters<
            typeof studyMateGraph.invoke
          >[0],

          {
            configurable: {
              thread_id: `ctx-route-test-${step.threadSuffix}-${stampBase}-a${attempt}`,
            },
          }
        );
      } catch (error) {
        lastError = error;

        console.log(
          `  Attempt ${attempt} failed to complete, retrying on a fresh checkpoint thread...`
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

  for (const step of steps) {
    try {
      const result =
        await invokeStep(
          step,
          threadStamp
        );

      const passed =
        result.route === step.expect;

      if (!passed) {
        failures += 1;
      }

      console.log(
        `\n${passed ? "PASS" : "FAIL"} | ${step.label}`
      );

      console.log(
        `  Expected: ${step.expect} | Actual: ${result.route} | Error: ${result.error ?? "none"}`
      );
    } catch (error) {
      failures += 1;

      console.log(
        `\nERROR | ${step.label}`
      );

      console.error(error);
    }
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
