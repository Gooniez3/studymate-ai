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

function getConversationTranscript(
  state: StudyMateGraphState,
  maxEntries = 8,
  maxCharsPerEntry = 280
): string {
  const messages =
    state.messages ?? [];

  const lines = messages
    .slice(-maxEntries)
    .map((message) => {
      const type =
        message._getType();

      if (
        type !== "human" &&
        type !== "ai"
      ) {
        return null;
      }

      const content =
        typeof message.content ===
        "string"
          ? message.content
          : String(message.content);

      const cleaned = content
        .replace(/\s+/g, " ")
        .trim();

      if (!cleaned) {
        return null;
      }

      const speaker =
        type === "human"
          ? "USER"
          : "ASSISTANT";

      const truncated =
        cleaned.length >
        maxCharsPerEntry
          ? `${cleaned.slice(
              0,
              maxCharsPerEntry
            )}...`
          : cleaned;

      return `${speaker}: ${truncated}`;
    })
    .filter(
      (line): line is string =>
        line !== null
    );

  return lines.join("\n");
}

/*
 * Deterministic intent heuristics.
 *
 * They run BEFORE the routing LLM so that
 * unambiguous requests never depend on an
 * extra model call, while everything else
 * falls through to the LLM with full
 * conversational context.
 */

const QUIZ_REQUEST_PATTERNS = [
  /\b(quiz me|quiz us|test me|test my)\b/i,

  /\bmcqs?\b/i,

  /\bmultiple[-\s]?choice\b/i,

  /\bpractice (questions?|tests?|problems?)\b/i,

  /\b(create|make|generate|build|give me|prepare)\b[^.!?\n]{0,40}\b(a |an |the |me |some )?(quiz|quizzes|mcqs?|multiple[-\s]?choice|(practice )?questions?)\b/i,
];

/*
 * Avoid hijacking software-development
 * questions such as "how do I create a quiz
 * app in react" - those are handled by the
 * routing LLM instead.
 */
const SOFTWARE_CONTEXT_PATTERN =
  /\b(apps?|websites?|coding|codebase|programs?|react|python|javascript|typescript|html|css)\b/i;

const EXPLICIT_DOCUMENT_PATTERNS = [
  /\b(my|our|his|her|their|your)\s+(uploaded\s+|attached\s+|provided\s+)?(pdf|pdfs|documents?|docs?|files?|notes?|slides?|lectures?|chapters?|materials?|readings?)\b/i,

  /\b(this|that|these|those)\s+(uploaded\s+|attached\s+|provided\s+)?(pdf|document|doc|file|note|slide|lecture|chapter|material|reading)s?\b/i,

  /\b(uploaded|attached|provided)\s+(pdf|document|doc|file|notes?|slides?|lectures?|chapters?|materials?|readings?)\b/i,

  /\bi\s+(just\s+)?(uploaded|attached|shared|sent)\b/i,

  /\bpages?\s+\d+\b/i,
];

const REFERENTIAL_MESSAGE_PATTERN =
  /\b(this|that|it|these|those|them|the above|the same|the attached|the upload|my upload)\b/i;

export function looksLikeDocumentFollowUp(
  message: string
): boolean {
  const text =
    message.trim();

  if (!text) {
    return false;
  }

  const patterns = [
    /^(what|how)\s+about\b/i,

    /^(can you |could you |please )?(explain|elaborate|expand|clarify|summarize|summarise|simplify|repeat|break down)\s+(that|this|it|them|those|these|everything|all)\b/i,

    /^(can you |could you |please )?(tell me)\s+(more|all|everything|again)\b/i,

    /^(say|go)\s+(that\s+)?(again|on|deeper)\b/i,

    /^what\s+(does|do|was|were|is|are)\s+(that|this|it|they|those|these)\s+/i,

    /^(continue|elaborate|expand)\b/i,

    /^(more|why|and|also|plus)\b[\s?!.]*$/i,

    /^(more)\s+(detail|details|info|information|explanations?)\b/i,
  ];

  return patterns.some(
    (pattern) => pattern.test(text)
  );
}

const CURRENT_INFO_PATTERN =
  /\b(latest|current|currently|today|tonight|right now|recent|recently|news|price|prices|pricing|cost|weather|forecast|stock|stocks|exchange rate|ranking|rankings|richest|live)\b/i;

const ABOUT_YOU_PATTERN =
  /\b(you|your)\b/i;

/*
 * High-precision time-sensitive triggers for
 * deterministic web routing. Intentionally
 * narrow - ambiguous requests still fall
 * through to the routing LLM.
 */
const WEB_REQUEST_PATTERNS = [
  /\blatest\b/i,

  /\bbreaking\b/i,

  /\bweather\b/i,

  /\bforecast\b/i,

  /\bstock prices?\b/i,

  /\bexchange rates?\b/i,

  /\bwho won\b/i,

  /\blive scores?\b/i,

  /\bprice of\b/i,

  /\brelease date\b/i,

  /\btoday'?s\s+(news|headlines|scores?|prices?)\b/i,
];

/*
 * Pure greetings/acknowledgements never
 * need retrieval or a routing LLM call.
 */
const TRIVIAL_DIRECT_PATTERN =
  /^(hi+|hello+|hey+|yo|thanks|thank you|thx|ok(ay)?|cool|nice|great|got it|alright)[\s!,.?]*$/i;

/*
 * First-person upload phrasing implies a
 * document request on its own - missing
 * documents are handled downstream, so these
 * route deterministically even when the chat
 * currently has no retrievable document.
 */
const STRONG_UPLOAD_PATTERNS = [
  /\b(my|our|his|her|their|your)\s+(uploaded\s+|attached\s+|provided\s+)?(pdf|pdfs|documents?|docs?|files?|notes?|slides?|lectures?|chapters?|materials?|readings?)\b/i,

  /\b(uploaded|attached|provided)\s+(pdf|document|doc|file|notes?|slides?|lectures?|chapters?|materials?|readings?)\b/i,
];

function mentionsUploadedDocument(
  userMessage: string,
  documentNames: string[]
): boolean {
  if (
    STRONG_UPLOAD_PATTERNS.some(
      (pattern) =>
        pattern.test(userMessage)
    )
  ) {
    return true;
  }

  if (
    EXPLICIT_DOCUMENT_PATTERNS.some(
      (pattern) =>
        pattern.test(userMessage)
    )
  ) {
    return true;
  }

  return documentNames.some(
    (name) => {
      const stem = name
        .trim()
        .replace(/\.pdf$/i, "");

      if (stem.length < 3) {
        return false;
      }

      const escaped = stem.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

      return new RegExp(
        `\\b${escaped}\\b`,
        "i"
      ).test(userMessage);
    }
  );
}

export async function routerNode(
  state: StudyMateGraphState
): Promise<{
  route: StudyMateRoute;
  previousRoute: StudyMateRoute | null;
}> {
  /*
   * `route` still holds the previous turn's
   * final route at this point because the
   * API no longer resets it on invoke, so it
   * is the authoritative "previous route"
   * signal. It is re-published through the
   * previousRoute channel so downstream
   * nodes (quiz/document) can still read it
   * after the router overwrites `route`.
   */
  const previousRouteAtEntry: StudyMateRoute =
    state.route;

  const incomingPreviousRoute: StudyMateRoute | null =
    previousRouteAtEntry;

  const userMessage =
    getLastUserMessage(state);

  if (!userMessage.trim()) {
    return {
      route: "direct",

      previousRoute:
        incomingPreviousRoute,
    };
  }

  const documentNames =
    state.documentNames ?? [];

  const hasDocumentContext =
    documentNames.length > 0 ||
    state.documentAttachedThisTurn ||
    incomingPreviousRoute ===
      "document";

  // 1. Explicit quiz request -> quiz
  if (
    !SOFTWARE_CONTEXT_PATTERN.test(
      userMessage
    ) &&
    QUIZ_REQUEST_PATTERNS.some(
      (pattern) =>
        pattern.test(userMessage)
    )
  ) {
    console.log(
      "LangGraph router heuristic:",
      {
        route: "quiz",
        userMessage:
          userMessage.slice(0, 80),
      }
    );

    return {
      route: "quiz",

      previousRoute:
        incomingPreviousRoute,
    };
  }

  // 2. Explicit uploaded-document reference -> document
  const strongUploadReference =
    STRONG_UPLOAD_PATTERNS.some(
      (pattern) =>
        pattern.test(userMessage)
    );

  /*
   * When the chat has no known documents,
   * only first-person upload phrasing in a
   * clear content-request shape bypasses the
   * presence gate - missing documents are
   * then handled gracefully downstream.
   */
  const contentRequestShape =
    /\b(what|which|where|who|when|how|why|explain|summarize|summarise|tell|show|read|extract|find|list|review|analyze|analyse|describe|discuss)\b/i.test(
      userMessage
    );

  if (
    mentionsUploadedDocument(
      userMessage,
      documentNames
    ) &&
    (hasDocumentContext ||
      (strongUploadReference &&
        contentRequestShape))
  ) {
    console.log(
      "LangGraph router heuristic:",
      {
        route: "document",
        matched:
          "explicit document reference",
      }
    );

    return {
      route: "document",

      previousRoute:
        incomingPreviousRoute,
    };
  }

  // 3. Referential message right after attaching a PDF -> document
  const shortDocumentImperative =
    /^(please\s+)?(explain|summarize|summarise|review|analyze|analyse|read)\b/i.test(
      userMessage.trim()
    ) && userMessage.trim().length <= 40;

  if (
    state.documentAttachedThisTurn &&
    !CURRENT_INFO_PATTERN.test(
      userMessage
    ) &&
    (REFERENTIAL_MESSAGE_PATTERN.test(
      userMessage
    ) ||
      shortDocumentImperative)
  ) {
    console.log(
      "LangGraph router heuristic:",
      {
        route: "document",
        matched:
          "reference to newly attached upload",
      }
    );

    return {
      route: "document",

      previousRoute:
        incomingPreviousRoute,
    };
  }

  // 4. Clear time-sensitive request -> web (skips the routing LLM)
  const isDocumentFollowUpShape =
    incomingPreviousRoute ===
      "document" &&
    looksLikeDocumentFollowUp(
      userMessage
    );

  if (
    !isDocumentFollowUpShape &&
    WEB_REQUEST_PATTERNS.some(
      (pattern) =>
        pattern.test(userMessage)
    )
  ) {
    console.log(
      "LangGraph router heuristic:",
      {
        route: "web",
        matched:
          "time-sensitive request",
      }
    );

    return {
      route: "web",

      previousRoute:
        incomingPreviousRoute,
    };
  }

  // 5. Strong follow-up to the previous document-grounded answer -> document
  if (
    incomingPreviousRoute ===
      "document" &&
    !CURRENT_INFO_PATTERN.test(
      userMessage
    ) &&
    !ABOUT_YOU_PATTERN.test(
      userMessage
    ) &&
    looksLikeDocumentFollowUp(
      userMessage
    )
  ) {
    console.log(
      "LangGraph router heuristic:",
      {
        route: "document",
        matched:
          "document-focused follow-up",
      }
    );

    return {
      route: "document",

      previousRoute:
        incomingPreviousRoute,
    };
  }

  // 6. Trivial greetings/acknowledgements -> direct (skips the routing LLM)
  if (
    TRIVIAL_DIRECT_PATTERN.test(
      userMessage.trim()
    )
  ) {
    console.log(
      "LangGraph router heuristic:",
      {
        route: "direct",
        matched:
          "trivial message",
      }
    );

    return {
      route: "direct",

      previousRoute:
        incomingPreviousRoute,
    };
  }

  // 7. Context-enriched routing LLM for everything else
  const transcript =
    getConversationTranscript(state);

  const documentsSection =
    documentNames.length > 0
      ? documentNames.join(", ")
      : "None";

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

CONVERSATION FOLLOW-UP RULES:
- Short follow-up messages such as "explain that more simply", "what about page 2", "what does that mean", "tell me all", or "summarize that section" usually continue the PREVIOUS exchange.
- If the recent conversation shows the assistant just answered from the uploaded document(s), route these follow-ups as document.
- If the recent conversation was ordinary chat or a general knowledge explanation, route these follow-ups as direct.
- Do NOT choose document merely because documents exist in the chat or because the message is short. Only choose document when the message explicitly references uploaded material OR clearly continues prior document-focused discussion.
- General knowledge questions remain direct even when documents exist in the chat.
- Current or time-sensitive questions remain web even when documents exist or were discussed earlier.
- Quiz requests remain quiz regardless of conversation context.

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
RECENT CONVERSATION:
${transcript || "(no earlier messages)"}

UPLOADED DOCUMENTS IN THIS CHAT:
${documentsSection}

FILE ATTACHED TO THIS MESSAGE:
${state.documentAttachedThisTurn ? "yes" : "no"}

PREVIOUS TURN ROUTE:
${incomingPreviousRoute ?? "none"}

WEB SEARCH ENABLED:
${state.webSearchEnabled}

STUDYMATE MODE:
${state.mode}

USER MESSAGE:
${userMessage}
      `.trim(),
    },
  ];

  const routerLlmStartedAt =
    performance.now();

  try {
    const result =
      await createAIStructuredCompletion(
        messages,
        routerSchema,
        "studymate_route",
        {
          /*
           * Routing is a lightweight
           * control-plane decision - the small
           * fast model handles it reliably while
           * final answers keep the strong model.
           */
          preferFastModel: true,
        }
      );

    console.log(
      `[perf] router llm: ${Math.round(
        performance.now() -
          routerLlmStartedAt
      )}ms`
    );

    console.log(
      "LangGraph router:",
      result.data
    );

    return {
      route:
        result.data.route,

      previousRoute:
        incomingPreviousRoute,
    };
  } catch (error) {
    console.error(
      "LangGraph router failed:",
      error
    );

    return {
      route: "direct",

      previousRoute:
        incomingPreviousRoute,
    };
  }
}
