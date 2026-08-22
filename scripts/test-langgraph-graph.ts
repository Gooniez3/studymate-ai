import dotenv from "dotenv";
import { HumanMessage } from "@langchain/core/messages";

dotenv.config({
  path: ".env.local",
});

async function main() {
  const {
    studyMateGraph,
  } = await import(
    "../lib/ai/graph/graph"
  );

  const tests = [
    {
      name: "Direct",
      message:
        "Explain recursion simply.",
      webSearchEnabled: false,
    },
    {
      name: "Document",
      message:
        "What does my uploaded PDF say about Aurora Notebook?",
      webSearchEnabled: false,
    },
    {
      name: "Web",
      message:
        "What is the latest iPhone?",
      webSearchEnabled: true,
    },
    {
      name: "Quiz",
      message:
        "Quiz me on recursion.",
      webSearchEnabled: false,
    },
    {
  name: "Document Quiz",
  message:
    "Create 5 quiz questions from my uploaded PDF about Aurora Notebook.",
  webSearchEnabled: false,
},
  ];

  for (const test of tests) {
    console.log(
      `\n=== ${test.name} TEST ===`
    );

    const result =
      await studyMateGraph.invoke(
        {
          messages: [
            new HumanMessage(
              test.message
            ),
          ],

          chatId:
            "cmsyehzt70000o47k6yen33j2",

          mode: "default",

          webSearchEnabled:
            test.webSearchEnabled,

          route: "direct",

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
        },
        {
          configurable: {
            // Fresh checkpoint thread for
            // every test execution.
            thread_id:
              `test-${test.name.toLowerCase()}-${Date.now()}`,
          },
        }
      );

    console.log(
      "Final route:",
      result.route
    );

    console.log(
      "Response:",
      result.response
    );

    console.log(
      "Web sources:",
      result.webSources
    );

    console.log(
      "Document citations:",
      result.documentCitations
    );

    console.log(
      "Quiz topic:",
      result.quizTopic
    );

    console.log(
      "Quiz context length:",
      result.quizContext?.length ?? 0
    );

    console.log(
      "Error:",
      result.error
    );
  }
}

main().catch((error) => {
  console.error(
    "LangGraph graph test failed:",
    error
  );

  process.exit(1);
});