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

  const threadId = `perf-stream-test-${Date.now()}`;

  const deltas: {
    text: string;

    atMs: number;
  }[] = [];

  const invokeStartedAt =
    performance.now();

  const result =
    await studyMateGraph.invoke(
      {
        messages: [
          new HumanMessage(
            "Explain Python variables briefly."
          ),
        ],

        chatId: null,

        mode: "default",

        webSearchEnabled: false,

        documentNames: [],

        documentAttachedThisTurn:
          false,

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
          thread_id: threadId,

          onToken: (delta: string) => {
            deltas.push({
              text: delta,

              atMs:
                performance.now() -
                invokeStartedAt,
            });
          },
        },
      }
    );

  const totalInvokeMs =
    Math.round(
      performance.now() -
        invokeStartedAt
    );

  console.log(
    "\n=== PERF / STREAMING TEST: direct question ==="
  );

  console.log(
    `Route: ${result.route}`
  );

  console.log(
    `Streamed deltas received: ${deltas.length}`
  );

  if (deltas.length > 0) {
    console.log(
      `First token at: ${Math.round(deltas[0].atMs)}ms`
    );

    console.log(
      `Last token at: ${Math.round(deltas.at(-1)!.atMs)}ms`
    );
  }

  console.log(
    `[perf] total request: ${totalInvokeMs}ms`
  );

  const streamedText = deltas
    .map((delta) => delta.text)
    .join("");

  const normalize = (
    text: string
  ) =>
    text
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

  const contentMatches =
    normalize(streamedText) ===
    normalize(result.response);

  let failures = 0;

  if (result.route !== "direct") {
    failures += 1;

    console.log(
      "FAIL | expected direct route"
    );
  } else {
    console.log("PASS | direct route");
  }

  if (deltas.length < 2) {
    failures += 1;

    console.log(
      "FAIL | expected multiple streamed deltas (true streaming)"
    );
  } else {
    console.log(
      `PASS | true streaming (${deltas.length} deltas)`
    );
  }

  if (!contentMatches) {
    failures += 1;

    console.log(
      "FAIL | streamed content does not match final response"
    );

    console.log(
      `\nSTREAMED:\n${streamedText.slice(0, 300)}`
    );

    console.log(
      `\nFINAL:\n${result.response.slice(0, 300)}`
    );
  } else {
    console.log(
      "PASS | streamed content matches final response"
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
