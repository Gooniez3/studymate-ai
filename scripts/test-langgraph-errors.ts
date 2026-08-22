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

  console.log(
    "\n=== DOCUMENT ERROR TEST ==="
  );

  const documentResult =
    await studyMateGraph.invoke({
      messages: [
        new HumanMessage(
          "What does my uploaded PDF say about Aurora Notebook?"
        ),
      ],

      // Intentionally missing
      // to test document failure.
      chatId: null,

      mode: "default",
      webSearchEnabled: false,

      // Force the graph to begin with
      // normal state defaults.
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
    });

  console.log(
    "Route:",
    documentResult.route
  );

  console.log(
    "Response:",
    documentResult.response
  );

  console.log(
    "Error:",
    documentResult.error
  );

  console.log(
    "\n=== DIRECT TEST AFTER ERROR HANDLING ==="
  );

  const directResult =
    await studyMateGraph.invoke({
      messages: [
        new HumanMessage(
          "Explain what an API is in one paragraph."
        ),
      ],

      chatId: null,

      mode: "default",
      webSearchEnabled: false,
      route: "direct",

      documentContext: "",
      webContext: "",
      verificationContext: "",

      webSources: [],
      documentCitations: [],

      response: "",
      error: null,
    });

  console.log(
    "Route:",
    directResult.route
  );

  console.log(
    "Response:",
    directResult.response
  );

  console.log(
    "Error:",
    directResult.error
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});