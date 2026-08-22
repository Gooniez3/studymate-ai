import { z } from "zod";

import {
  createAIStructuredCompletion,
  type ChatMessage,
} from "@/lib/ai/provider";

import type {
  StudyMateGraphState,
  StudyMateRoute,
} from "@/lib/ai/graph/state";

const routerSchema = z.object({
  route: z.enum([
    "direct",
    "document",
    "web",
    "quiz",
  ]),

  reason: z
    .string()
    .min(1)
    .max(500),
});

function getLastUserMessage(
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

export async function routerNode(
  state: StudyMateGraphState
): Promise<{
  route: StudyMateRoute;
}> {
  const userMessage =
    getLastUserMessage(state);

  if (!userMessage.trim()) {
    return {
      route: "direct",
    };
  }

  const messages:
    ChatMessage[] = [
    {
      role: "system",
      content: `
You are the routing component for StudyMate AI.

Choose exactly one route:

direct
- Stable general knowledge
- Explanation
- Writing help
- Coding help
- Casual conversation
- No external information required

document
- The user refers to an uploaded PDF, document, file, notes, slides, or other uploaded material
- The user asks to summarize, explain, extract, review, or answer questions from uploaded material
- The answer should come from document evidence

web
- The user asks for latest, current, recent, live, changing, externally verifiable, regulated, legal, visa, employment, financial, medical, price, ranking, weather, release, announcement, or similarly time-sensitive information

quiz
- The user explicitly asks for a quiz, test, MCQ, multiple-choice questions, practice questions, or asks to be tested
- The user may ask for a quiz about a normal topic
- The user may ask for a quiz based on an uploaded PDF or document
- Examples:
  - "Quiz me on recursion"
  - "Make 5 MCQs about databases"
  - "Test me on networking"
  - "Create a quiz from my uploaded PDF"
  - "Give me practice questions about Aurora Notebook"

IMPORTANT ROUTING RULES:
- Route based on the user's INTENT.

- If the user explicitly asks for a quiz, test, MCQs, practice questions, or asks to be tested, choose quiz.

- Quiz intent takes priority over direct.

- Quiz intent also takes priority over document when the user asks to create a quiz FROM an uploaded document.
  Example:
  "Create 5 quiz questions from my PDF"
  -> quiz

- If the user refers to an uploaded PDF, document, file, notes, slides, or uploaded material and is asking to summarize, explain, extract, review, or answer questions from it, choose document.

- Do NOT change a document request to direct just because chatId is missing.

- Do NOT change a document request to direct because document retrieval may fail.

- Missing chat IDs, missing documents, empty retrieval results, and retrieval errors are handled by downstream nodes.

- If current or externally verified information is required, choose web.

- Do not choose web just because Web Search is enabled.

- If neither quiz, document, nor web retrieval is necessary, choose direct.

- Keep the reason concise, ideally under 120 characters.
      `.trim(),
    },

    {
      role: "user",
      content: `
USER MESSAGE:
${userMessage}

CHAT ID:
${state.chatId ?? "none"}

WEB SEARCH ENABLED:
${state.webSearchEnabled}

STUDYMATE MODE:
${state.mode}
      `.trim(),
    },
  ];

  try {
    const result =
      await createAIStructuredCompletion(
        messages,
        routerSchema,
        "studymate_route"
      );

    console.log(
      "LangGraph router:",
      result.data
    );

    return {
      route:
        result.data.route,
    };
  } catch (error) {
    console.error(
      "LangGraph router failed:",
      error
    );

    return {
      route: "direct",
    };
  }
}