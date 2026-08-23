import {
  createAICompletion,
  type ChatMessage,
} from "@/lib/ai/provider";

import {
  webVerificationPrompt,
} from "@/lib/ai/prompts";

import type {
  StudyMateGraphState,
} from "@/lib/ai/graph/state";

function getLastUserText(
  state: StudyMateGraphState
): string {
  const messages =
    state.messages ?? [];

  for (
    let index =
      messages.length - 1;
    index >= 0;
    index -= 1
  ) {
    const message =
      messages[index];

    if (
      message._getType() ===
      "human"
    ) {
      return typeof message.content ===
        "string"
        ? message.content
        : "";
    }
  }

  return "";
}

export async function verificationNode(
  state: StudyMateGraphState
) {
  console.log(
    "LangGraph node: verification"
  );

  // Only web-grounded answers need
  // this verification step for now.
  if (state.route !== "web") {
    return {
      verificationContext: "",
    };
  }

  const userQuestion =
    getLastUserText(state);

  if (!userQuestion.trim()) {
    return {
      verificationContext: "",
      error:
        "Web verification requires a user question.",
    };
  }

  if (!state.webContext.trim()) {
    return {
      verificationContext: "",
      error:
        state.error ??
        "Web verification requires search evidence.",
    };
  }

  const verificationStartedAt =
    performance.now();

  try {
    const formattedPrompt =
      await webVerificationPrompt.formatMessages(
        {
          userQuestion,

          // The current LangGraph web node
          // searches using the user's query.
          searchQuery:
            userQuestion,

          searchContext:
            state.webContext,
        }
      );

    const messages:
      ChatMessage[] =
      formattedPrompt.map(
        (message) => {
          const type =
            message._getType();

          const role:
            ChatMessage["role"] =
            type === "human"
              ? "user"
              : type === "ai"
                ? "assistant"
                : "system";

          return {
            role,

            content:
              typeof message.content ===
              "string"
                ? message.content
                : String(
                    message.content
                  ),
          };
        }
      );

    const completion =
      await createAICompletion(
        messages,
        {
          temperature: 0,
          maxTokens: 500,

          /*
           * Verification is a classification-style
           * control-plane task - the small fast
           * model handles VERIFIED/NOT VERIFIED
           * extraction reliably and keeps the web
           * path well under the latency budget.
           */
          preferFastModel: true,
        }
      );

    console.log(
      `[perf] verification: ${Math.round(
        performance.now() -
          verificationStartedAt
      )}ms`
      );

    const verificationContext =
      completion.content.trim();

    if (!verificationContext) {
      throw new Error(
        "Verifier returned an empty response."
      );
    }

    console.log(
      "LangGraph web verification:",
      verificationContext
    );

    return {
      verificationContext,
      error: null,
    };
  } catch (error) {
    console.error(
      "LangGraph verification failed:",
      error
    );

    return {
      verificationContext: "",
      error:
        "Web evidence verification failed.",
    };
  }
}