import dotenv from "dotenv";
import { HumanMessage } from "@langchain/core/messages";

dotenv.config({
  path: ".env.local",
});

async function main() {
  const {
    routerNode,
  } = await import(
    "../lib/ai/graph/router"
  );

  const tests = [
    {
      name: "Direct",
      message:
        "Explain recursion simply.",
      webSearchEnabled: false,
      documentNames: [] as string[],
      attachedThisTurn: false,
    },
    {
      name: "Document",
      message:
        "What does my uploaded PDF say about Aurora Notebook?",
      webSearchEnabled: false,
      documentNames: [
        "aurora-lecture.pdf",
      ] as string[],
      attachedThisTurn: false,
    },
    {
      name: "Web",
      message:
        "What is the latest iPhone?",
      webSearchEnabled: true,
      documentNames: [
        "aurora-lecture.pdf",
      ] as string[],
      attachedThisTurn: false,
    },
    {
      name: "Quiz",
      message:
        "Quiz me on recursion.",
      webSearchEnabled: false,
      documentNames: [] as string[],
      attachedThisTurn: false,
    },
  ];

  for (const test of tests) {
    const result =
      await routerNode({
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

        previousRoute: null,

        documentNames:
          test.documentNames,

        documentAttachedThisTurn:
          test.attachedThisTurn,

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

    console.log(
      `\n${test.name}:`,
      test.message
    );

    console.log(
      "Route:",
      result.route
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});