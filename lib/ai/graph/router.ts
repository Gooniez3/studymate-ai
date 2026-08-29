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
    "planner",
    "revision",
    "assignment",
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

/*
 * "Give me likely exam questions" is revision
 * material (predicted question styles to
 * study), not a request for an interactive
 * quiz. This narrow guard keeps such
 * phrasing out of the deterministic quiz
 * heuristic without weakening genuine quiz
 * requests like "quiz me" or "practice
 * questions".
 */
const EXAM_QUESTION_PREDICTION_PATTERN =
  /\b(likely|expected|possible|probable)\s+(exam\s+)?questions?\b/i;

/*
 * Narrower guard for planner heuristics:
 * "Make me a Python study plan" must stay
 * deterministic, so programming languages
 * alone must not suppress it. Only clear
 * software-product phrasing does.
 */
const PLANNER_SOFTWARE_CONTEXT_PATTERN =
  /\b(apps?|websites?|webapps?|web apps?|chrome extensions?|browser extensions?)\b/i;

const EXPLICIT_PLANNER_PATTERNS = [
  /\b(study|revision|learning|exam|prep|preparation)\s+(plan|schedule|timetable)\b/i,

  /\bplan\s+(my|the|our|a)\s+(study|studying|revision|learning|prep|preparation)\b/i,

  /\b(make|create|give|draft|prepare|build|draw up|put together)\b[^.!?\n]{0,50}\b\d+[-\s]?(day|week|month)s?\b[^.!?\n]{0,30}\bplan\b/i,

  /\b\d+[-\s]?(day|week|month)s?\s+(study|revision|learning)?\s?plan\b/i,

  /\b(prepare|create|make|draft|draw up|build|need|want)\b[^.!?\n]{0,40}\b(a |an |the |me |us )?schedule\b/i,
];

/*
 * High-precision explicit revision triggers.
 * Deliberately narrow: ambiguous study help
 * ("help me study Python") still falls
 * through to the routing LLM. "Revision
 * plan/schedule" stays planner via the
 * planner patterns checked before these.
 */
const EXPLICIT_REVISION_PATTERNS = [
  /\bexam\s+revision\b/i,

  /\brevision\s+(notes?|sheets?|summary|summaries|checklists?|materials?|guides?|packs?)\b/i,

  /\b(help\s+(me\s+)?(to\s+)?|going\s+to\s+|let'?s\s+)revis(e|ing)\b/i,

  /\brevis(e|ing)\s+(this|that|it|them|these|those|for)\b/i,

  /\bkey\s+(things|points|concepts|ideas|formulas?|facts?|topics?)\b[^.!?\n]{0,40}\b(exam|test|revision|remember|memoriz)/i,

  /\bwhat\s+(should|do)\s+i\s+(need\s+to\s+)?(remember|memoriz|know)\b[^.!?\n]{0,40}\b(exam|test|revision)\b/i,

  /\bexam[-\s]focused\s+(summary|notes|overview|recap)\b/i,

  /\b(likely|expected|possible|probable)\s+(exam\s+)?questions?\b/i,
];

/*
 * Short modification requests that continue
 * an existing revision conversation, e.g.
 * "make it shorter", "focus more on
 * normalization", "add common mistakes",
 * "turn this into a one-page cheat sheet".
 */
const REVISION_FOLLOWUP_PATTERNS = [
  /^(please\s+)?(make|change|adjust|reduce|extend|shrink|shorten|lengthen|compress|expand|trim|cut|keep|drop|remove|delete|replace|rewrite|reformat|turn)\b/i,

  /^focus\s+more(\s+on)?\b/i,

  /^(also\s+)?add\b/i,

  /^(give|tell)\s+me\s+more\b/i,

  /^(can\s+you\s+)?simplif/i,

  /\beasier\s+to\s+(memoriz|remember|learn)\b/i,

  /\bcheat\s+sheet\b/i,

  /\b(low|high)[-\s]priority\b/i,

  /\bmore\s+(likely\s+)?(exam\s+)?questions\b/i,
];

/*
 * High-precision explicit assignment-help
 * triggers. Checked AFTER quiz/planner/revision
 * so scheduled plans, quizzes, and revision
 * notes keep priority. Ambiguous study help
 * ("explain normalization") still falls through
 * to the routing LLM.
 */
const EXPLICIT_ASSIGNMENT_PATTERNS = [
  /\bhelp\s+(me\s+)?(with|understand(ing)?|breaking\s+down)\b[^.!?\n]{0,30}\b(this|my|the|us)\b[^.!?\n]{0,40}\b(assignments?|tasks?|rubrics?|briefs?|essays?|reports?)\b/i,

  /\b(this|the|my)\s+assignment\s+(question|requirements?|brief|tasks?)\b/i,

  /\bassignments?\s+(outline|breakdown|structure|help|guidance)\b/i,

  /\b(report|essay|paper)s?\s+outline\b/i,

  /\b(outline|structure|organize|organise)\b[^.!?\n]{0,40}\b(my|this|the)\b[^.!?\n]{0,60}\b(reports?|essays?|assignments?|papers?)\b/i,

  /\bunderstand\s+(this|the)\s+rubric\b/i,

  /\bwhat\s+does\s+(this|the|my)\s+rubric\b/i,

  /\brubric\s+(require|criteria|says?|ask)/i,

  /\breview\s+(my|this|the)\s+(assignment|report|draft|introduction|conclusion|essay|paragraph|work)\b/i,

  /\bcompare\b[^.!?\n]{0,30}\b(this|my|the)\b[^.!?\n]{0,40}\b(draft|introduction|report|essay|paragraph|work)\b/i,

  /\b(improve|strengthen)\s+(my|this|the)\s+(introduction|conclusion|paragraph|draft|report|essay|writing)\b/i,

  /\bcheck\s+my\s+(draft|work|report|essay)\b/i,

  /\bbreak\s+down\s+(this|the|my)\s+(task|assignment|question|brief)\b/i,

  /\bstructure\s+(it|this)\s+(for|to)\s+\d+\s*words?\b/i,
];

/*
 * Short modification requests that continue an
 * existing assignment-guidance conversation,
 * e.g. "make it shorter", "focus more on
 * methodology", "what should I write first",
 * "what am I missing?", "2000 words".
 */
const ASSIGNMENT_FOLLOWUP_PATTERNS = [
  /^(please\s+)?(make|shorten|trim|shrink|compress|expand|lengthen|reduce|adjust|change|keep|drop|remove|delete)\b/i,

  /^focus\s+more(\s+on)?\b/i,

  /^(also\s+)?add\b/i,

  /^what\s+(should\s+i|am\s+i|do\s+i)\b/i,

  /^how\s+should\s+i\b/i,

  /\b(against|per|in)\s+the\s+rubric\b/i,

  /\bwhat\s+am\s+i\s+missing\b/i,

  /\bwrite\s+first\b/i,

  /\bword\s+(count|limit)\b/i,

  /\b\d+\s*words?\b/i,
];

/*
 * Short modification requests that continue
 * an existing planner conversation, e.g.
 * "make it 5 days instead", "I only have 2
 * hours per day", "add quizzes".
 */
const PLANNER_FOLLOWUP_PATTERNS = [
  /^(please\s+)?(make|change|adjust|reduce|extend|shrink|shorten|lengthen|compress|stretch|shift|move|keep|drop|remove|swap)\b/i,

  /^focus\s+more\b/i,

  /^(also\s+)?add\b/i,

  /\b(only|just)\s+have\s+\d+\b/i,

  /\b\d+\s*(hours?|hrs?|minutes?|mins?)\s+(a|per)\s+day\b/i,

  /\bper day\b/i,

  /\bweekends?\b/i,

  /\bday\s*\d+\b/i,

  /\binstead\b/i,
];

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

  if (state.webSearchEnabled) {
    console.log(
      "LangGraph router heuristic:",
      {
        route: "web",
        matched: "web search enabled",
      }
    );

    return {
      route: "web",
      previousRoute:
        incomingPreviousRoute,
    };
  }

  // 1. Explicit quiz request -> quiz
  if (
    !SOFTWARE_CONTEXT_PATTERN.test(
      userMessage
    ) &&
    !EXAM_QUESTION_PREDICTION_PATTERN.test(
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

  // 2. Explicit study-plan request -> planner
  if (
    !PLANNER_SOFTWARE_CONTEXT_PATTERN.test(
      userMessage
    ) &&
    EXPLICIT_PLANNER_PATTERNS.some(
      (pattern) =>
        pattern.test(userMessage)
    )
  ) {
    console.log(
      "LangGraph router heuristic:",
      {
        route: "planner",
        userMessage:
          userMessage.slice(0, 80),
      }
    );

    return {
      route: "planner",

      previousRoute:
        incomingPreviousRoute,
    };
  }

  // 3. Explicit exam-revision request -> revision
  if (
    EXPLICIT_REVISION_PATTERNS.some(
      (pattern) =>
        pattern.test(userMessage)
    )
  ) {
    console.log(
      "LangGraph router heuristic:",
      {
        route: "revision",
        userMessage:
          userMessage.slice(0, 80),
      }
    );

    return {
      route: "revision",

      previousRoute:
        incomingPreviousRoute,
    };
  }

  // 4. Explicit assignment-help request -> assignment
  if (
    EXPLICIT_ASSIGNMENT_PATTERNS.some(
      (pattern) =>
        pattern.test(userMessage)
    )
  ) {
    console.log(
      "LangGraph router heuristic:",
      {
        route: "assignment",
        userMessage:
          userMessage.slice(0, 80),
      }
    );

    return {
      route: "assignment",

      previousRoute:
        incomingPreviousRoute,
    };
  }

  // 5. Explicit uploaded-document reference -> document
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

  // 6. Referential message right after attaching a PDF -> document
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

  // 7. Clear time-sensitive request -> web (skips the routing LLM)
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

  // 8. Strong follow-up to the previous document-grounded answer -> document
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

  // 9. Trivial greetings/acknowledgements -> direct (skips the routing LLM)
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

  // 10. Modification follow-up to a previous revision -> revision (skips the routing LLM)
  if (
    incomingPreviousRoute ===
      "revision" &&
    !CURRENT_INFO_PATTERN.test(
      userMessage
    ) &&
    userMessage.trim().length <=
      120 &&
    REVISION_FOLLOWUP_PATTERNS.some(
      (pattern) =>
        pattern.test(userMessage)
    )
  ) {
    console.log(
      "LangGraph router heuristic:",
      {
        route: "revision",
        matched:
          "revision modification follow-up",
      }
    );

    return {
      route: "revision",

      previousRoute:
        incomingPreviousRoute,
    };
  }

  // 11. Modification follow-up to previous assignment guidance -> assignment (skips the routing LLM)
  if (
    incomingPreviousRoute ===
      "assignment" &&
    !CURRENT_INFO_PATTERN.test(
      userMessage
    ) &&
    userMessage.trim().length <=
      120 &&
    ASSIGNMENT_FOLLOWUP_PATTERNS.some(
      (pattern) =>
        pattern.test(userMessage)
    )
  ) {
    console.log(
      "LangGraph router heuristic:",
      {
        route: "assignment",
        matched:
          "assignment modification follow-up",
      }
    );

    return {
      route: "assignment",

      previousRoute:
        incomingPreviousRoute,
    };
  }

  // 12. Modification follow-up to a previous plan -> planner (skips the routing LLM)
  if (
    incomingPreviousRoute ===
      "planner" &&
    !CURRENT_INFO_PATTERN.test(
      userMessage
    ) &&
    userMessage.trim().length <=
      100 &&
    PLANNER_FOLLOWUP_PATTERNS.some(
      (pattern) =>
        pattern.test(userMessage)
    )
  ) {
    console.log(
      "LangGraph router heuristic:",
      {
        route: "planner",
        matched:
          "planner modification follow-up",
      }
    );

    return {
      route: "planner",

      previousRoute:
        incomingPreviousRoute,
    };
  }

  // 13. Context-enriched routing LLM for everything else
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

planner
- The user asks for a study plan, revision plan, learning plan, study schedule, or timetable
- The user asks to plan their studying or revision for an exam, subject, or deadline
- The user modifies a plan that was created earlier in this conversation ("make it 5 days instead", "I only have 2 hours per day", "add quizzes")
- The plan may be general or built from an uploaded document
- Examples:
  - "Make me a 7-day study plan for data structures"
  - "I have my database exam next Friday. Make me a revision plan."
  - "Create a 2-week revision schedule from these notes"
  - "Make it 5 days instead" (after a plan was produced)
- Do NOT choose planner for vague requests such as "help me study Python" when no plan or schedule is requested

revision
- The user asks for exam revision help: revision notes, revision sheets, revision summaries, revision checklists, or to revise a topic for an exam
- The user asks what to remember, memorize, or focus on for an exam
- The user asks for likely or expected exam questions as study material (NOT an interactive quiz)
- The user modifies revision material created earlier in this conversation ("make it shorter", "add common mistakes", "turn this into a cheat sheet")
- The material may be general or built from an uploaded document
- Examples:
  - "Help me revise recursion for my exam"
  - "Give me exam revision notes for database normalization"
  - "Summarize this PDF for exam revision"
  - "What are the key things I need to remember from this PDF for the exam?"
  - "Give me likely exam questions from these notes"
  - "Make it shorter" (after revision material was produced)
- Do NOT choose revision for plain explanations ("explain recursion") without revision/exam intent

assignment
- The user asks for help understanding, breaking down, structuring, planning the writing of, or reviewing an ASSIGNMENT, report, essay, task sheet, or rubric
- The user asks about assignment requirements, deliverables, outlines, rubric criteria, or what they are missing
- The user pastes draft text (introduction, paragraph, section) and asks for review or improvement
- The user modifies assignment guidance created earlier in this conversation ("make it shorter", "focus more on methodology", "what should I write first?")
- Examples:
  - "Help me understand this assignment"
  - "Break down this assignment question for me"
  - "Create an outline for my cloud computing report"
  - "What does this rubric require?"
  - "Review my introduction and tell me how to improve it"
  - "How should I structure my database assignment?"
  - "Focus more on methodology" (after assignment guidance was produced)
- Do NOT choose assignment for pure subject explanations ("explain normalization") with no task/rubric/draft intent

IMPORTANT ROUTING RULES:
- Route based on the user's INTENT.

- If the user explicitly asks for a quiz, test, MCQs, practice questions, or asks to be tested, choose quiz.

- Quiz intent takes priority over direct.

- If the user asks for a study plan, revision plan, learning plan, study schedule, or to plan their studying, choose planner.

- Planner intent takes priority over direct and document when the user asks to create a plan FROM an uploaded document.
  Example:
  "Create a study plan from my PDF"
  -> planner

- Ambiguous study help such as "help me study Python" or "teach me databases" without a plan or schedule request is NOT planner.

- Explicit exam-revision requests ("revision notes", "revision sheet", "help me revise", "key things to remember for the exam", "likely exam questions") take priority over direct and document.
  Example:
  "Summarize this PDF for exam revision"
  -> revision (with document grounding handled downstream)

- A scheduled plan is planner even when the word "revision" appears; revision material without a schedule is revision.
  Example:
  "Make me a 7-day revision plan"
  -> planner

- Interactive quizzing stays quiz even after revision material was produced.
  Example:
  "Quiz me on this"
  -> quiz

- Explicit assignment-help requests (understanding/breaking down an assignment, outlines, structuring reports/essays, rubric interpretation, reviewing drafts) take priority over document and direct.
  Example:
  "What does this rubric require?"
  -> assignment (with document grounding handled downstream)

- Scheduled plans stay planner even for assignments; quizzes stay quiz; exam revision stays revision.
  Example:
  "Make me a 7-day plan for this assignment"
  -> planner

- Quiz intent also takes priority over document when the user asks to create a quiz FROM an uploaded document.
  Example:
  "Create 5 quiz questions from my PDF"
  -> quiz

- If the user refers to an uploaded PDF, document, file, notes, slides, or uploaded material and is asking to summarize, explain, extract, review, or answer questions from it, choose document.

CONVERSATION FOLLOW-UP RULES:
- Short follow-up messages such as "explain that more simply", "what about page 2", "what does that mean", "tell me all", or "summarize that section" usually continue the PREVIOUS exchange.
- If the recent conversation shows the assistant just answered from the uploaded document(s), route these follow-ups as document.
- If the recent conversation shows the assistant just produced a study plan, route modification follow-ups such as "make it shorter", "make day 3 easier", or "focus more on weak topics" as planner.
- If the recent conversation shows the assistant just produced revision material, route modification follow-ups such as "make it shorter", "add common mistakes", or "turn this into a cheat sheet" as revision.
- If the recent conversation was ordinary chat or a general knowledge explanation, route these follow-ups as direct.
- Do NOT choose document merely because documents exist in the chat or because the message is short. Only choose document when the message explicitly references uploaded material OR clearly continues prior document-focused discussion.
- General knowledge questions remain direct even when documents exist in the chat.
- Current or time-sensitive questions remain web even when documents exist or were discussed earlier.
- Quiz requests remain quiz regardless of conversation context.
- Study-plan requests and plan modification follow-ups remain planner regardless of conversation context.
- Exam-revision requests and revision modification follow-ups remain revision regardless of conversation context.

- Do NOT change a document request to direct just because chatId is missing.

- Do NOT change a document request to direct because document retrieval may fail.

- Missing chat IDs, missing documents, empty retrieval results, and retrieval errors are handled by downstream nodes.

- If current or externally verified information is required, choose web.

- Do not choose web just because Web Search is enabled.

- If neither planner, revision, assignment, quiz, document, nor web retrieval is necessary, choose direct.

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
