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

  const threadId =
     "checkpoint-memory-test-v2";

  console.log(
    "\n=== TURN 1 ==="
  );

  const firstResult =
    await studyMateGraph.invoke(
      {
        messages: [
          new HumanMessage(
            "Remember this for our conversation: my project codename is Nebula Finch."
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
        quizTopic: "",
quizContext: "",
quizData: null,

        response: "",
        error: null,
      },
      {
        configurable: {
          thread_id:
            threadId,
        },
      }
    );

  console.log(
    "Turn 1 response:",
    firstResult.response
  );

  console.log(
    "\n=== TURN 2 ==="
  );

  const secondResult =
    await studyMateGraph.invoke(
      {
        messages: [
          new HumanMessage(
            "What project codename did I just tell you?"
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
      },
      {
        configurable: {
          thread_id:
            threadId,
        },
      }
    );

  console.log(
    "Turn 2 response:",
    secondResult.response
  );

  console.log(
    "\nMessage count:",
    secondResult.messages.length
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});