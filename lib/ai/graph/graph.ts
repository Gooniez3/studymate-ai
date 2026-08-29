import {
  END,
  START,
  StateGraph,
} from "@langchain/langgraph";

import {
  StudyMateState,
  type DocumentCitation,
  type StudyMateGraphState,
} from "@/lib/ai/graph/state";

import {
  routerNode,
  looksLikeDocumentFollowUp,
} from "@/lib/ai/graph/router";

import {
  searchDocuments,
} from "@/lib/ai/tools/document-search";

import {
  searchWebMultiple,
} from "@/lib/ai/tools/web-search";

import {
  createAICompletion,
  type ChatMessage,
} from "@/lib/ai/provider";

import {
  verificationNode,
} from "@/lib/ai/graph/verification";

import {
  graphCheckpointer,
} from "@/lib/ai/graph/checkpointer";

import {
  AIMessage,
} from "@langchain/core/messages";

import {
  generateQuiz,
} from "@/lib/ai/agents/quiz-agent";

import {
  generateStudyPlan,
  renderStudyPlanMarkdown,
} from "@/lib/ai/agents/study-planner-agent";

import {
  generateExamRevision,
  renderExamRevisionMarkdown,
} from "@/lib/ai/agents/exam-revision-agent";

import {
  generateAssignmentGuidance,
  renderAssignmentMarkdown,
} from "@/lib/ai/agents/assignment-assistant-agent";

/*
 * Detects whether the message contains a
 * substantial pasted draft that is itself the
 * review target.
 *
 * Shape-based rather than length-only: a draft
 * label ("introduction:", "paragraph:",
 * "draft:", ...) followed by actual inline
 * content counts even when the paste is
 * short. Ordinary conversational "this" does
 * NOT trigger detection - explicit document
 * references are evaluated independently by
 * the caller.
 */
const DRAFT_LABEL_INLINE_PATTERN =
  /\b(introduction|paragraph|draft|essay|report|section|answer|response)\b[^:]*:\s*(?=\S)/i;

const REVIEW_REQUEST_VERB_PATTERN =
  /\b(review|feedback\s+on|give\s+feedback|improve|check|assess|critique|is\s+this)\b/i;

export function detectPastedReviewTarget(
  message: string
): boolean {
  const reviewRequestShape =
    REVIEW_REQUEST_VERB_PATTERN.test(
      message
    );

  if (!reviewRequestShape) {
    return false;
  }

  const hasInlineDraftContent =
    DRAFT_LABEL_INLINE_PATTERN.test(
      message
    );

  const hasLongPastedContent =
    message.trim().length >= 320 ||
    /:\s*\n/.test(message);

  return (
    hasInlineDraftContent ||
    hasLongPastedContent
  );
}

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

/*
 * Returns the human message BEFORE the
 * newest one. Used to resolve vague
 * follow-ups ("quiz me on this", "what
 * about page 2") to the topic the user is
 * still referring to.
 */
function getPreviousUserText(
  state: StudyMateGraphState
): string {
  const messages =
    state.messages ?? [];

  let foundLastHuman = false;

  for (
    let index =
      messages.length - 1;
    index >= 0;
    index -= 1
  ) {
    const message =
      messages[index];

    if (
      message._getType() !==
      "human"
    ) {
      continue;
    }

    if (!foundLastHuman) {
      foundLastHuman = true;

      continue;
    }

    return typeof message.content ===
      "string"
      ? message.content
      : "";
  }

  return "";
}

/*
 * Returns the most recent human message
 * that carries real topical content,
 * skipping short or purely referential
 * follow-ups such as "explain that more
 * simply". Used to build retrieval queries
 * for vague document-grounded requests.
 */
function getTopicalUserText(
  state: StudyMateGraphState
): string {
  const messages =
    state.messages ?? [];

  let seenLastHuman = false;

  for (
    let index =
      messages.length - 1;
    index >= 0;
    index -= 1
  ) {
    const message =
      messages[index];

    if (
      message._getType() !==
      "human"
    ) {
      continue;
    }

    const content =
      typeof message.content ===
      "string"
        ? message.content.trim()
        : "";

    if (!seenLastHuman) {
      seenLastHuman = true;

      continue;
    }

    if (!content) {
      continue;
    }

    if (
      content.length < 12 ||
      looksLikeDocumentFollowUp(content)
    ) {
      continue;
    }

    return content;
  }

  return "";
}

/*
 * Exported for testing: resolves the quiz topic
 * when the user makes a conversational reference
 * ("it", "this") to a previous agent's output.
 */
export function resolveQuizTopic(
  userMessage: string,
  previousRoute:
    | "direct"
    | "document"
    | "web"
    | "quiz"
    | "revision"
    | "planner"
    | "assignment"
    | null,
  stateTopics: {
    revisionTopic?: string;
    plannerTopic?: string;
    assignmentTopic?: string;
  }
): string {
  const lower =
    userMessage.toLowerCase();

  const unquoted = lower.replace(
    /["'`][^"'`]*["'`]/g,
    " "
  );

  const hasRef =
    /\b(this|that|it|those|these|them|everything|all of this|all of that|all of it|the same|the above)\b/.test(
      unquoted
    ) ||
    /\bwhat\s+we\s+(just\s+)?(discussed|covered|talked about|went through|read)\b/.test(
      lower
    ) ||
    /\bjust\s+discussed\b/.test(
      lower
    );

  if (!hasRef) {
    return userMessage;
  }

  /*
   * If the message also contains an explicit
   * topic (e.g. "Quiz me on JavaScript, it is
   * hard"), do not resolve — the user already
   * named the topic.
   */
  const explicitTopicAfterPrep =
    /\b(?:on|about|over|regarding)\s+([a-z][a-z\s]{1,40})\b/.exec(
      unquoted
    );

  if (explicitTopicAfterPrep) {
    const after =
      explicitTopicAfterPrep[1].trim();

    const isOnlyRef =
      /^(this|that|it|those|these|them|everything|all of this|all of that|all of it|the same|the above|the same topic|what\s+we|just\s+discussed|what\s+we\s+(just\s+)?(discussed|covered|talked about|went through|read))$/.test(
        after
      );

    if (!isOnlyRef) {
      return userMessage;
    }
  }

  if (
    previousRoute === "revision" &&
    stateTopics.revisionTopic
  ) {
    return stateTopics.revisionTopic;
  }

  if (
    previousRoute === "planner" &&
    stateTopics.plannerTopic
  ) {
    return stateTopics.plannerTopic;
  }

  if (
    previousRoute === "assignment" &&
    stateTopics.assignmentTopic
  ) {
    return stateTopics.assignmentTopic;
  }

  return userMessage;
}

/*
 * Exported for testing: extracts the explicit
 * question count the user requested, returning
 * undefined when no number is present.
 */
export function extractRequestedQuestionCount(
  message: string
): number | undefined {
  const lower =
    message.toLowerCase();

  const match =
    lower.match(
      /\b(?:give|make|create|generate|write|do)\s+(?:me\s+|us\s+)?(\d+)\b/
    ) ||
    lower.match(
      /\b(\d+)\s+(?:questions?|quiz|quizzes|mcqs?)\b/
    ) ||
    lower.match(
      /\bquiz\s+(?:me\s+)?(?:with\s+)?(\d+)\b/
    );

  return match
    ? parseInt(match[1], 10)
    : undefined;
}

/*
 * Exported for testing: scripts exercise
 * document-grounded quiz detection directly
 * against crafted states.
 */
export async function quizNode(
  state: StudyMateGraphState
) {
  console.log(
    "LangGraph node: quiz"
  );

  const userMessage =
    getLastUserText(state);

  if (!userMessage.trim()) {
    return {
      response:
        "Tell me what topic you'd like to be quizzed on.",
      error:
        "Quiz topic is missing.",
    };
  }

  try {
    let quizContext = "";

    const lowerMessage =
      userMessage.toLowerCase();

    /*
     * Document grounding is decided from a
     * combination of signals rather than a
     * single rule:
     *
     * 1. Explicit uploaded-material words
     *    ("pdf", "document", "uploaded", ...)
     * 2. Page references ("page 1",
     *    "pages 2-4", "page number 3")
     * 3. Conversational references ("this",
     *    "that", "what we just discussed")
     *    combined with actual document
     *    presence or a document-grounded
     *    previous turn.
     */
    const hasDocumentMaterial =
      state.documentNames.length > 0 ||
      state.documentAttachedThisTurn ||
      state.previousRoute ===
        "document";

    const mentionsUploadedMaterial =
      /\b(pdf|documents?|docs?|files?|uploads?|uploaded|attachments?|notes?|slides?|lectures?|materials?|readings?|chapters?)\b/.test(
        lowerMessage
      ) ||
      /\bpages?\s*(?:numbers?\s*)?\d+\b/.test(
        lowerMessage
      );

    /*
     * Quoted segments are stripped first so
     * programming questions like "quiz me on
     * the 'this' keyword" are not mistaken
     * for document references.
     */
    const unquotedMessage = lowerMessage.replace(
      /["'`][^"'`]*["'`]/g,
      " "
    );

    const mentionsConversationReference =
      /\b(this|that|it|those|these|them|everything|all of this|all of that|all of it|the same|the above)\b/.test(
        unquotedMessage
      ) ||
      /\bwhat\s+we\s+(just\s+)?(discussed|covered|talked about|went through|read)\b/.test(
        lowerMessage
      ) ||
      /\bjust\s+discussed\b/.test(
        lowerMessage
      );

    const wantsDocumentQuiz =
      mentionsUploadedMaterial ||
      (mentionsConversationReference &&
        hasDocumentMaterial);

    /*
     * FIX: When the user makes a conversational
     * reference ("it", "this") and the previous
     * route was revision/planner/assignment,
     * resolve the reference to the actual topic
     * from the previous agent's state instead of
     * passing the raw message (e.g. "quiz me on
     * it") as the topic.
     */
    const resolvedTopic =
      resolveQuizTopic(
        userMessage,
        state.previousRoute,
        {
          revisionTopic:
            state.revisionTopic,
          plannerTopic:
            state.plannerTopic,
          assignmentTopic:
            state.assignmentTopic,
        }
      );

    const resolvedFromPrevious =
      resolvedTopic !== userMessage;

    if (
      resolvedFromPrevious &&
      !quizContext
    ) {
      if (
        state.previousRoute ===
          "revision" &&
        state.revisionContext
      ) {
        quizContext =
          state.revisionContext;
      } else if (
        state.previousRoute ===
          "planner" &&
        state.plannerContext
      ) {
        quizContext =
          state.plannerContext;
      } else if (
        state.previousRoute ===
          "assignment" &&
        state.assignmentContext
      ) {
        quizContext =
          state.assignmentContext;
      }
    }

    /*
     * FIX: Extract explicit question count from
     * the user message so "give me 3 quiz
     * questions" produces exactly 3, not the
     * default 5.
     */
    const requestedCount =
      extractRequestedQuestionCount(
        userMessage
      );

    const quizRetrievalStartedAt =
      performance.now();

    if (
      wantsDocumentQuiz &&
      state.chatId
    ) {
      let documentResult =
        await searchDocuments({
          chatId:
            state.chatId,
          query:
            userMessage,
          limit: 4,
        });

      if (
        !documentResult.success
      ) {
        /*
         * Vague document quizzes ("quiz me on
         * this") embed poorly on their own, so
         * retry against the most topical user
         * message earlier in the conversation,
         * skipping purely referential turns.
         */
        const topicalUserMessage =
          getTopicalUserText(state);

        if (
          topicalUserMessage.trim()
        ) {
          documentResult =
            await searchDocuments({
              chatId:
                state.chatId,
              query: `${topicalUserMessage}\n${userMessage}`,
              limit: 4,
            });
        }
      }

      if (
        !documentResult.success &&
        state.documentNames.length > 0
      ) {
        /*
         * Last resort for fully referential
         * quizzes with no usable conversation
         * topic: the document name usually
         * embeds close to title and intro
         * chunks, which keeps the quiz grounded
         * instead of inventing generic content.
         */
        documentResult =
          await searchDocuments({
            chatId:
              state.chatId,

            query: state.documentNames.join(
              ", "
            ),

            limit: 4,
          });
      }

      if (
        documentResult.success
      ) {
        quizContext =
          documentResult.context;
      }

      console.log(
        `[perf] quiz document retrieval: ${Math.round(
          performance.now() -
            quizRetrievalStartedAt
        )}ms`
      );
    }

    console.log(
      "Quiz context selection:",
      {
        wantsDocumentQuiz,
        mentionsUploadedMaterial,
        mentionsConversationReference,
        continuesDocumentDiscussion:
          mentionsConversationReference &&
          hasDocumentMaterial,
        hasContext:
          quizContext.length > 0,
        contextLength:
          quizContext.length,
      }
    );

    const quiz =
      await generateQuiz({
        topic:
          resolvedTopic,
        context:
          quizContext,
        questionCount:
          requestedCount ?? 5,
      });

    const visibleResponse =
  quiz.questions.length > 0
    ? `I created a ${quiz.questions.length}-question quiz for you. Choose your answers below, then submit when you're ready.`
    : "I couldn't create enough reliable quiz questions for that topic.";

return {
  response:
    visibleResponse,

  quizTopic:
    resolvedTopic,

  quizContext,

  quizData:
    quiz,

  error: null,
};

  } catch (error) {
    console.error(
      "Quiz agent failed:",
      error
    );

    return {
      response:
        "I couldn't generate the quiz right now. Please try again.",
      error:
        "Quiz generation failed.",
    };
  }
}
/*
 * Exported for testing: scripts exercise
 * document-grounded planner detection
 * directly against crafted states.
 */
export async function plannerNode(
  state: StudyMateGraphState
) {
  console.log(
    "LangGraph node: planner"
  );

  const userMessage =
    getLastUserText(state);

  if (!userMessage.trim()) {
    return {
      response:
        "Tell me what subject you'd like a study plan for.",
      error:
        "Planner topic is missing.",
    };
  }

  try {
    let plannerContext = "";

    const lowerMessage =
      userMessage.toLowerCase();

    /*
     * Document grounding mirrors the quiz
     * node: only explicit uploaded-material
     * words, page references, or conversational
     * references combined with real document
     * presence trigger retrieval. A general
     * request like "Make me a Python study
     * plan" stays general even when an
     * unrelated PDF exists in the chat.
     */
    const hasDocumentMaterial =
      state.documentNames.length > 0 ||
      state.documentAttachedThisTurn ||
      state.previousRoute ===
        "document";

    const mentionsUploadedMaterial =
      /\b(pdf|documents?|docs?|files?|uploads?|uploaded|attachments?|notes?|slides?|lectures?|materials?|readings?|chapters?)\b/.test(
        lowerMessage
      ) ||
      /\bpages?\s*(?:numbers?\s*)?\d+\b/.test(
        lowerMessage
      );

    const unquotedMessage = lowerMessage.replace(
      /["'`][^"'`]*["'`]/g,
      " "
    );

    const mentionsConversationReference =
      /\b(this|that|it|those|these|them|everything|all of this|all of that|all of it|the same|the above)\b/.test(
        unquotedMessage
      ) ||
      /\bwhat\s+we\s+(just\s+)?(discussed|covered|talked about|went through|read)\b/.test(
        lowerMessage
      ) ||
      /\bjust\s+discussed\b/.test(
        lowerMessage
      );

    const wantsDocumentPlan =
      mentionsUploadedMaterial ||
      (mentionsConversationReference &&
        hasDocumentMaterial);

    const retrievalStartedAt =
      performance.now();

    if (
      wantsDocumentPlan &&
      state.chatId
    ) {
      let documentResult =
        await searchDocuments({
          chatId:
            state.chatId,
          query:
            userMessage,
          limit: 6,
        });

      if (
        !documentResult.success
      ) {
        /*
          * Referential plan requests ("make a
          * plan from what we just discussed")
          * embed poorly on their own, so retry
          * against the most topical earlier
          * user message.
          */
        const topicalUserMessage =
          getTopicalUserText(state);

        if (
          topicalUserMessage.trim()
        ) {
          documentResult =
            await searchDocuments({
              chatId:
                state.chatId,
              query: `${topicalUserMessage}\n${userMessage}`,
              limit: 6,
            });
        }
      }

      if (
        !documentResult.success &&
        state.documentNames.length > 0
      ) {
        documentResult =
          await searchDocuments({
            chatId:
              state.chatId,

            query: state.documentNames.join(
              ", "
            ),

            limit: 6,
          });
      }

      if (
        documentResult.success
      ) {
        plannerContext =
          documentResult.context;
      }

      console.log(
        `[perf] planner document retrieval: ${Math.round(
          performance.now() -
            retrievalStartedAt
        )}ms`
      );
    }

    console.log(
      "Planner context selection:",
      {
        wantsDocumentPlan,
        mentionsUploadedMaterial,
        mentionsConversationReference,
        continuesDocumentDiscussion:
          mentionsConversationReference &&
          hasDocumentMaterial,
        hasContext:
          plannerContext.length > 0,
        contextLength:
          plannerContext.length,
        modifiesPreviousPlan:
          state.plannerData !== null,
      }
    );

    /*
     * Follow-up modifications reuse the
     * checkpointed previous plan so changes
     * such as "make it 5 days instead" stay
     * connected to the existing conversation.
     * No separate memory system is involved.
     */
    const previousPlan =
      state.plannerData;

    const recentMessages = (
      state.messages ?? []
    ).slice(-4);

    const conversation =
      recentMessages
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
              : String(
                  message.content
                );

          const speaker =
            type === "human"
              ? "USER"
              : "ASSISTANT";

          return `${speaker}: ${content
            .replace(/\s+/g, " ")
            .slice(0, 400)}`;
        })
        .filter(
          (line): line is string =>
            line !== null
        )
        .join("\n");

    const plan =
      await generateStudyPlan({
        request:
          userMessage,

        context:
          plannerContext,

        previousPlan,

        conversation,
      });

    const visibleResponse =
      renderStudyPlanMarkdown(
        plan
      );

    return {
      response:
        visibleResponse,

      plannerTopic:
        userMessage,

      plannerContext,

      plannerData:
        plan,

      error: null,
    };
  } catch (error) {
    console.error(
      "Planner agent failed:",
      error
    );

    return {
      response:
        "I couldn't create the study plan right now. Please try again.",
      error:
        "Study plan generation failed.",
    };
  }
}

/*
 * Exported for testing: scripts exercise
 * document-grounded revision detection
 * directly against crafted states.
 */
export async function revisionNode(
  state: StudyMateGraphState
) {
  console.log(
    "LangGraph node: revision"
  );

  const userMessage =
    getLastUserText(state);

  if (!userMessage.trim()) {
    return {
      response:
        "Tell me what topic you'd like to revise for your exam.",
      error:
        "Revision topic is missing.",
    };
  }

  try {
    let revisionContext = "";

    let revisionCitations: DocumentCitation[] =
      [];

    const lowerMessage =
      userMessage.toLowerCase();

    /*
     * "Revision notes", "revision sheet",
     * and similar compound phrases name the
     * OUTPUT, not an uploaded file. They are
     * stripped before the material scan so a
     * request like "Give me revision notes
     * for Python" stays general even when an
     * unrelated PDF exists in the chat.
     */
    const materialScanText =
      lowerMessage.replace(
        /\b(revision|study)\s+(notes?|sheets?|summaries?|summary|checklists?|materials?|guides?|packs?)\b/g,
        " "
      );

    /*
     * Document grounding mirrors the quiz and
     * planner nodes: only explicit
     * uploaded-material words, page
     * references, or conversational references
     * combined with real document presence
     * trigger retrieval.
     */
    const hasDocumentMaterial =
      state.documentNames.length > 0 ||
      state.documentAttachedThisTurn ||
      state.previousRoute ===
        "document";

    const mentionsUploadedMaterial =
      /\b(pdf|documents?|docs?|files?|uploads?|uploaded|attachments?|notes?|slides?|lectures?|materials?|readings?|chapters?)\b/.test(
        materialScanText
      ) ||
      /\bpages?\s*(?:numbers?\s*)?\d+\b/.test(
        materialScanText
      );

    const unquotedMessage = lowerMessage.replace(
      /["'`][^"'`]*["'`]/g,
      " "
    );

    const mentionsConversationReference =
      /\b(this|that|it|those|these|them|everything|all of this|all of that|all of it|the same|the above)\b/.test(
        unquotedMessage
      ) ||
      /\bwhat\s+we\s+(just\s+)?(discussed|covered|talked about|went through|read)\b/.test(
        lowerMessage
      ) ||
      /\bjust\s+discussed\b/.test(
        lowerMessage
      );

    const wantsDocumentRevision =
      mentionsUploadedMaterial ||
      (mentionsConversationReference &&
        hasDocumentMaterial);

    const retrievalStartedAt =
      performance.now();

    if (
      wantsDocumentRevision &&
      state.chatId
    ) {
      let documentResult =
        await searchDocuments({
          chatId:
            state.chatId,
          query:
            userMessage,
          limit: 6,
        });

      if (
        !documentResult.success
      ) {
        /*
         * Referential revision requests
         * ("revise what we just discussed")
         * embed poorly on their own, so retry
         * against the most topical earlier
         * user message.
         */
        const topicalUserMessage =
          getTopicalUserText(state);

        if (
          topicalUserMessage.trim()
        ) {
          documentResult =
            await searchDocuments({
              chatId:
                state.chatId,
              query: `${topicalUserMessage}\n${userMessage}`,
              limit: 6,
            });
        }
      }

      if (
        !documentResult.success &&
        state.documentNames.length > 0
      ) {
        documentResult =
          await searchDocuments({
            chatId:
              state.chatId,

            query: state.documentNames.join(
              ", "
            ),

            limit: 6,
          });
      }

      if (
        documentResult.success
      ) {
        revisionContext =
          documentResult.context;

        revisionCitations =
          documentResult.chunks.map(
            (chunk) => ({
              evidenceNumber:
                chunk.evidenceNumber,

              documentName:
                chunk.documentName,

              pageNumber:
                chunk.pageNumber,
            })
          );
      }

      console.log(
        `[perf] revision document retrieval: ${Math.round(
          performance.now() -
            retrievalStartedAt
        )}ms`
      );
    }

    console.log(
      "Revision context selection:",
      {
        wantsDocumentRevision,
        mentionsUploadedMaterial,
        mentionsConversationReference,
        continuesDocumentDiscussion:
          mentionsConversationReference &&
          hasDocumentMaterial,
        hasContext:
          revisionContext.length > 0,
        contextLength:
          revisionContext.length,
        modifiesPreviousRevision:
          state.revisionData !== null,
      }
    );

    /*
     * Follow-up modifications reuse the
     * checkpointed previous revision output
     * so changes such as "make it shorter"
     * stay connected to the existing
     * material. No separate memory system is
     * involved.
     */
    const previousRevision =
      state.revisionData;

    const recentMessages = (
      state.messages ?? []
    ).slice(-4);

    const conversation =
      recentMessages
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
              : String(
                  message.content
                );

          const speaker =
            type === "human"
              ? "USER"
              : "ASSISTANT";

          return `${speaker}: ${content
            .replace(/\s+/g, " ")
            .slice(0, 400)}`;
        })
        .filter(
          (line): line is string =>
            line !== null
        )
        .join("\n");

    const revision =
      await generateExamRevision({
        request:
          userMessage,

        context:
          revisionContext,

        previousRevision,

        conversation,
      });

    const visibleResponse =
      renderExamRevisionMarkdown(
        revision
      );

    return {
      response:
        visibleResponse,

      revisionTopic:
        userMessage,

      revisionContext,

      revisionData:
        revision,

      documentCitations:
        revisionCitations,

      error: null,
    };
  } catch (error) {
    console.error(
      "Revision agent failed:",
      error
    );

    return {
      response:
        "I couldn't create the revision material right now. Please try again.",
      error:
        "Revision generation failed.",
    };
  }
}

/*
 * Exported for testing: scripts exercise
 * document-grounded assignment detection
 * directly against crafted states.
 */
export async function assignmentNode(
  state: StudyMateGraphState
) {
  console.log(
    "LangGraph node: assignment"
  );

  const userMessage =
    getLastUserText(state);

  if (!userMessage.trim()) {
    return {
      response:
        "Tell me which assignment you'd like help with.",
      error:
        "Assignment request is missing.",
    };
  }

  try {
    let assignmentContext = "";

    let assignmentCitations: DocumentCitation[] =
      [];

    const lowerMessage =
      userMessage.toLowerCase();

    /*
     * Output-noun compounds ("assignment
     * outline", "report outline", "draft
     * review") name the GUIDANCE, not an
     * uploaded file, and are stripped before
     * the material scan so a general request
     * like "Help me structure a Python
     * assignment" stays ungrounded even when
     * unrelated PDFs exist in the chat.
     */
    const materialScanText =
      lowerMessage.replace(
        /\b(assignment|report|essay|task)\s+(outline|breakdown|structure|feedback|review|guidance|help|plan)\b/g,
        " "
      );

    /*
     * Document grounding mirrors the quiz,
     * planner, and revision nodes:
     * explicit uploaded-material words, page
     * references, assignment-document nouns
     * (brief/rubric/task sheet), or conversational
     * references combined with real document
     * presence trigger retrieval.
     */
    const hasDocumentMaterial =
      state.documentNames.length > 0 ||
      state.documentAttachedThisTurn ||
      state.previousRoute ===
        "document";

    const mentionsUploadedMaterial =
      /\b(pdf|documents?|docs?|files?|uploads?|uploaded|attachments?|notes?|slides?|lectures?|materials?|readings?|chapters?)\b/.test(
        materialScanText
      ) ||
      /\bpages?\s*(?:numbers?\s*)?\d+\b/.test(
        materialScanText
      ) ||
      /\b(rubrics?|marking\s+schemes?|assignment\s+briefs?|assignment\s+sheets?|task\s+sheets?)\b/.test(
        materialScanText
      );

    const unquotedMessage = lowerMessage.replace(
      /["'`][^"'`]*["'`]/g,
      " "
    );

    const mentionsConversationReference =
      /\b(this|that|it|those|these|them|everything|all of this|all of that|all of it|the same|the above)\b/.test(
        unquotedMessage
      ) ||
      /\bwhat\s+we\s+(just\s+)?(discussed|covered|talked about|went through|read)\b/.test(
        lowerMessage
      ) ||
      /\bjust\s+discussed\b/.test(
        lowerMessage
      );

    /*
     * Pasted-draft review detection.
     *
     * When the message itself contains a
     * substantial draft (introduction,
     * paragraph, section) as the review
     * target, that pasted text is the primary
     * source. A previously uploaded PDF must
     * NOT be retrieved merely because the
     * message says "this", documents exist in
     * the chat, or an earlier turn was
     * document-focused.
     *
     * Explicit document references ("using
     * the uploaded rubric", "compare with the
     * assignment brief", page references)
     * independently override this suppression.
     */
    /*
     * Shape + inline-content based detection
     * (shared exported helper - unit tested).
     * Catches short pastes like
     * "Review this introduction: Cloud
     * computing has changed..." via the draft
     * label followed by real content, while
     * ordinary conversational "this" never
     * triggers it.
     */
    const hasPastedReviewTarget =
      detectPastedReviewTarget(
        userMessage
      );

    const wantsDocumentAssignment =
      mentionsUploadedMaterial ||
      (mentionsConversationReference &&
        hasDocumentMaterial &&
        !hasPastedReviewTarget);

    const retrievalStartedAt =
      performance.now();

    if (
      wantsDocumentAssignment &&
      state.chatId
    ) {
      let documentResult =
        await searchDocuments({
          chatId:
            state.chatId,
          query:
            userMessage,
          limit: 6,
        });

      if (
        !documentResult.success
      ) {
        /*
         * Referential requests ("review what we
         * just discussed against the rubric")
         * embed poorly on their own, so retry
         * against the most topical earlier user
         * message.
         */
        const topicalUserMessage =
          getTopicalUserText(state);

        if (
          topicalUserMessage.trim()
        ) {
          documentResult =
            await searchDocuments({
              chatId:
                state.chatId,
              query: `${topicalUserMessage}\n${userMessage}`,
              limit: 6,
            });
        }
      }

      if (
        !documentResult.success &&
        state.documentNames.length > 0
      ) {
        documentResult =
          await searchDocuments({
            chatId:
              state.chatId,

            query: state.documentNames.join(
              ", "
            ),

            limit: 6,
          });
      }

      if (
        documentResult.success
      ) {
        assignmentContext =
          documentResult.context;

        assignmentCitations =
          documentResult.chunks.map(
            (chunk) => ({
              evidenceNumber:
                chunk.evidenceNumber,

              documentName:
                chunk.documentName,

              pageNumber:
                chunk.pageNumber,
            })
          );
      }

      console.log(
        `[perf] assignment document retrieval: ${Math.round(
          performance.now() -
            retrievalStartedAt
        )}ms`
      );
    }

    console.log(
      "Assignment context selection:",
      {
        wantsDocumentAssignment,
        mentionsUploadedMaterial,
        mentionsConversationReference,
        continuesDocumentDiscussion:
          mentionsConversationReference &&
          hasDocumentMaterial,
        hasPastedReviewTarget,
        explicitOverride:
          hasPastedReviewTarget &&
          mentionsUploadedMaterial,
        hasContext:
          assignmentContext.length > 0,
        contextLength:
          assignmentContext.length,
        modifiesPreviousGuidance:
          state.assignmentData !== null,
      }
    );

    /*
     * Follow-up modifications reuse the
     * checkpointed previous guidance so changes
     * such as "make it shorter" stay connected
     * to the existing conversation. No separate
     * memory system is involved.
     */
    const previousAssignment =
      state.assignmentData;

    const recentMessages = (
      state.messages ?? []
    ).slice(-4);

    const conversation =
      recentMessages
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
              : String(
                  message.content
                );

          const speaker =
            type === "human"
              ? "USER"
              : "ASSISTANT";

          return `${speaker}: ${content
            .replace(/\s+/g, " ")
            .slice(0, 400)}`;
        })
        .filter(
          (line): line is string =>
            line !== null
        )
        .join("\n");

    const guidance =
      await generateAssignmentGuidance({
        request:
          userMessage,

        context:
          assignmentContext,

        previousAssignment,

        conversation,
      });

    const visibleResponse =
      renderAssignmentMarkdown(
        guidance
      );

    return {
      response:
        visibleResponse,

      assignmentTopic:
        userMessage,

      assignmentContext,

      assignmentData:
        guidance,

      documentCitations:
        assignmentCitations,

      error: null,
    };
  } catch (error) {
    console.error(
      "Assignment assistant failed:",
      error
    );

    return {
      response:
        "I couldn't work through the assignment right now. Please try again.",
      error:
        "Assignment guidance generation failed.",
    };
  }
}

/*
 * Simple dynamic output budget: concise
 * requests get fewer tokens, explicit
 * requests for detail get more. Never
 * unbounded.
 */
function estimateResponseBudget(
  userMessage: string
): number {
  const text =
    userMessage.toLowerCase();

  const wantsDetail =
    /\b(detail|detailed|comprehensive|in[- ]depth|thoroughly|extensive|everything|full story|long answer)\b/.test(
      text
    ) ||
    userMessage.trim().length > 220;

  if (wantsDetail) {
    return 1300;
  }

  if (
    userMessage.trim().length < 60
  ) {
    return 600;
  }

  return 900;
}

type ResponseNodeConfig = {
  configurable?: {
    /*
     * Set by app/api/chat/route.ts to stream
     * answer tokens to the browser while
     * generation is still running.
     */
    onToken?: (delta: string) => void;
  };
};

async function responseNode(
  state: StudyMateGraphState,
  config?: ResponseNodeConfig
) {
  console.log(
    "LangGraph node: response"
  );

  const onToken =
    config?.configurable?.onToken;

  const userMessage =
    getLastUserText(state);

  if (state.error) {
    console.warn(
      "LangGraph responding to upstream error:",
      state.error
    );

    if (
      state.route === "document"
    ) {
      return {
        response:
          "I couldn't retrieve enough information from the uploaded document to answer that reliably.",

        messages: [
          new AIMessage(
            "I couldn't retrieve enough information from the uploaded document to answer that reliably."
          ),
        ],

        error:
          state.error,
      };
    }

    if (
      state.route === "web"
    ) {
      return {
        response:
          "I couldn't retrieve reliable web information for that request. Please try again.",

        messages: [
          new AIMessage(
            "I couldn't retrieve reliable web information for that request. Please try again."
          ),
        ],

        error:
          state.error,
      };
    }

    return {
      response:
        "I couldn't complete that request. Please try again.",

      messages: [
        new AIMessage(
          "I couldn't complete that request. Please try again."
        ),
      ],

      error:
        state.error,
    };
  }

  if (!userMessage.trim()) {
    const response =
      "I couldn't find a user message to answer.";

    return {
      response,

      messages: [
        new AIMessage(
          response
        ),
      ],

      error:
        "Missing user message.",
    };
  }

  /*
   * Convert LangGraph message history into
   * the provider's ChatMessage format.
   *
   * Bounded for latency and cost: only the
   * last 6 messages are sent, older ones are
   * truncated, and the most recent exchange
   * stays intact so references and follow-ups
   * keep working. Checkpoint memory itself is
   * untouched - this only trims what goes
   * into the prompt.
   */
  const recentMessages = (
    state.messages ?? []
  ).slice(-6);

  const conversationMessages:
    ChatMessage[] =
    recentMessages.map((message, index) => {
      const type =
        message._getType();

      let content =
        typeof message.content ===
        "string"
          ? message.content
          : String(
              message.content
            );

      const isPartOfCurrentExchange =
        index >=
        recentMessages.length - 2;

      if (
        !isPartOfCurrentExchange &&
        content.length > 480
      ) {
        content = `${content.slice(
          0,
          480
        )}...`;
      }

      if (type === "human") {
        return {
          role:
            "user" as const,
          content,
        };
      }

      if (type === "ai") {
        return {
          role:
            "assistant" as const,
          content,
        };
      }

      return {
        role:
          "system" as const,
        content,
      };
    });

  const messages:
    ChatMessage[] = [
    {
      role: "system",
      content: `
You are StudyMate AI.

Answer the user's question using the conversation history and routing context provided below.

ROUTE:
${state.route}

DOCUMENT CONTEXT:
${state.documentContext || "None"}

WEB CONTEXT:
${state.webContext || "None"}

WEB EVIDENCE VERIFICATION:
${state.verificationContext || "None"}

GENERAL RULES:
- Be clear, accurate, and focused.
- Use the conversation history when the user refers to something said earlier.
- Do not invent facts.
- Do not invent sources.
- Do not create a Sources section.
- Do not create a Document Sources section.
- Do not generate citation markers such as:
  [1]
  [2]
  【1†L1-L4】
  [EVIDENCE_1]
  【EVIDENCE_1】
- Citation and source rendering is handled separately by StudyMate AI.

DIRECT ROUTE:
- If the route is "direct", answer normally using stable general knowledge and the conversation history.
- If the user asks about something they said earlier, use the prior conversation messages.
- Do not claim current or changing facts unless they were provided in context.
- Match answer length to the user's request.
- For simple or broad questions, start with a concise answer instead of an exhaustive report.
- Do not introduce current politics, current officeholders, current conflicts, current prices, current rankings, recent releases, or other time-sensitive facts unless they were supplied in context.
- If the user explicitly asks for current, latest, recent, today, or otherwise time-sensitive information, that request should be handled by the web route.
- For broad country questions, prefer stable background such as geography, language, culture, and established historical context.
- Do not add unrelated sections just to make the answer longer.

DOCUMENT ROUTE:
- If the route is "document", use ONLY the supplied DOCUMENT CONTEXT for document-specific factual claims.
- You may use the conversation history to understand what the user is referring to.
- Do not use outside knowledge to fill gaps in the document.
- If the document context does not clearly contain the answer, say that the uploaded document does not clearly provide enough information.
- You may mention the filename or page naturally only if that information is explicitly present in the supplied context.
- Do not write evidence identifiers in the answer.

WEB ROUTE:
- If the route is "web", answer using only the supplied web context for current or externally verified factual claims.
- Use the conversation history to resolve references from earlier turns.
- Obey the web evidence verification report.
- Treat VERIFIED facts as supported.
- Do not present NOT VERIFIED claims as facts.
- If the verification verdict is PARTIAL, clearly communicate uncertainty where relevant.
- If the verification verdict is INSUFFICIENT, do not guess the answer.
- If sources conflict, mention the conflict when it matters to the user's question.

PRESENTATION:
- Match the structure and length to the user's question.
- Answer the user's actual question first.
- For simple questions, prefer a concise answer.
- Expand when the user asks for an explanation, detailed answer, comparison, study notes, or comprehensive overview.
- Do not force information into a table when normal headings and bullets are clearer.
- Use a table only for genuinely tabular comparisons or compact structured facts.
- For broad questions such as "Tell me about a country", give a concise overview first, then include only the most useful points.
- Avoid unnecessary sections and excessive detail.

OUTPUT FORMATTING:
- Return only the answer.
- Use standard Markdown only.
- NEVER output raw HTML tags.
- NEVER output <br>, <br/>, <br />, <div>, <span>, <p>, or other HTML.
- For lists, use normal Markdown bullets with "- ".
- For numbered steps, use Markdown numbered lists.
- For tables, keep each table cell concise and on a single line.
- Do not try to create multiple lines inside a Markdown table cell using HTML.
- If a table cell would require several bullet points or long paragraphs, do NOT use a table for that section. Use headings and Markdown bullet lists instead.
- Prefer readable paragraphs and lists over overly large tables.
- Do not append source metadata.
      `.trim(),
    },

    ...conversationMessages,
  ];

  /*
   * Token forwarding for true streaming.
   *
   * The final response is cleaned of raw
   * <br> tags after generation today; when
   * streaming, the same cleaning must happen
   * per delta. A tiny carry buffer holds back
   * a trailing partial tag (e.g. "<br") so
   * tags split across chunks never leak into
   * the browser.
   */
  let carryBuffer = "";

  const sanitizeDelta = (
    text: string
  ) =>
    text.replace(
      /<br\s*\/?>/gi,
      " "
    );

  const forwardCleanDelta = (
    delta: string
  ) => {
    if (!onToken) {
      return;
    }

    let text =
      carryBuffer + delta;

    carryBuffer = "";

    const lastOpenIndex =
      text.lastIndexOf("<");

    if (
      lastOpenIndex !== -1 &&
      !text
        .slice(lastOpenIndex)
        .includes(">") &&
      text.length - lastOpenIndex <=
        8
    ) {
      carryBuffer = text.slice(
        lastOpenIndex
      );

      text = text.slice(
        0,
        lastOpenIndex
      );
    }

    text = sanitizeDelta(text);

    if (text) {
      onToken(text);
    }
  };

  const flushCleanCarry = () => {
    if (!carryBuffer || !onToken) {
      carryBuffer = "";

      return;
    }

    const text = sanitizeDelta(
      carryBuffer
    );

    carryBuffer = "";

    if (text) {
      onToken(text);
    }
  };

  const generationStartedAt =
    performance.now();

  let firstTokenAt: number | null =
    null;

  try {
    const completion =
      await createAICompletion(
        messages,
        {
          temperature: 0.35,

          maxTokens:
            estimateResponseBudget(
              userMessage
            ),

          onToken: (delta) => {
            if (
              firstTokenAt === null
            ) {
              firstTokenAt =
                performance.now();

              console.log(
                `[perf] final generation first token: ${Math.round(
                  firstTokenAt -
                    generationStartedAt
                )}ms`
              );
            }

            forwardCleanDelta(delta);
          },
        }
      );

    flushCleanCarry();

    console.log(
      `[perf] final generation total: ${Math.round(
        performance.now() -
          generationStartedAt
      )}ms`
    );

    const response =
  completion.content
    .replace(
      /<br\s*\/?>/gi,
      " "
    )
    .trim();

    console.log(
      "LangGraph response generated:",
      {
        route:
          state.route,
        characters:
          response.length,
      }
    );

    return {
      response,

      /*
       * MessagesAnnotation uses an append reducer,
       * so returning this AIMessage adds the
       * assistant turn to checkpointed history.
       */
      messages: [
        new AIMessage(
          response
        ),
      ],

      error: null,
    };
  } catch (error) {
    console.error(
      "LangGraph response node failed:",
      error
    );

    const response =
      "StudyMate AI could not generate a response.";

    return {
      response,

      messages: [
        new AIMessage(
          response
        ),
      ],

      error:
        "Response generation failed.",
    };
  }
}


function routeAfterRouter(
  state: StudyMateGraphState
) {
  return state.route;
}

async function directNode() {
  console.log(
    "LangGraph node: direct"
  );

  return {};
}

async function documentNode(
  state: StudyMateGraphState
) {
  console.log(
    "LangGraph node: document"
  );

  const chatId =
    state.chatId;

  if (!chatId) {
    return {
      documentContext: "",
      error:
        "Document search requires a chat ID.",
    };
  }

  const messages =
    state.messages ?? [];

  let query = "";

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
      query =
        typeof message.content ===
        "string"
          ? message.content
          : "";

      break;
    }
  }

  if (!query.trim()) {
    return {
      documentContext: "",
      error:
        "No user query was available for document retrieval.",
    };
  }

  /*
   * Follow-ups such as "What about page 2?"
   * carry no retrievable content on their
   * own, so blend in what the conversation
   * was discussing before retrieval.
   */
  const previousUserMessage =
    getPreviousUserText(state);

  if (
    previousUserMessage.trim() &&
    query.length <= 120 &&
    looksLikeDocumentFollowUp(query)
  ) {
    console.log(
      "LangGraph document retrieval query enriched from prior turn"
    );

    query = `${previousUserMessage}\n${query}`;
  }

  try {
    const retrievalStartedAt =
      performance.now();

    const result =
      await searchDocuments({
        chatId,
        query,
        limit: 4,
      });

    console.log(
      `[perf] document retrieval: ${Math.round(
        performance.now() -
          retrievalStartedAt
      )}ms`
    );

    console.log(
  "LangGraph document retrieval:",
  {
    success:
      result.success,
    evidenceCount:
      result.chunks.length,
  }
);

return {
  documentContext:
    result.context,

  documentCitations:
    result.chunks.map(
      (chunk) => ({
        evidenceNumber:
          chunk.evidenceNumber,
        documentName:
          chunk.documentName,
        pageNumber:
          chunk.pageNumber,
      })
    ),

  error:
    result.success
      ? null
      : "No relevant document evidence was found.",
};
} catch (error) {
  console.error(
    "LangGraph document node failed:",
    error
  );

  return {
    documentContext: "",
    documentCitations: [],
    error:
      "Document retrieval failed.",
  };
}
}

async function webNode(
  state: StudyMateGraphState
) {
  console.log(
    "LangGraph node: web"
  );

  const messages =
    state.messages ?? [];

  let query = "";

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
      query =
        typeof message.content ===
        "string"
          ? message.content
          : "";

      break;
    }
  }

  if (!query.trim()) {
    return {
      webContext: "",
      webSources: [],
      error:
        "No user query was available for web search.",
    };
  }

  try {
    const searchStartedAt =
      performance.now();

    const result =
      await searchWebMultiple([
        query,
      ]);

    console.log(
      `[perf] web search: ${Math.round(
        performance.now() -
          searchStartedAt
      )}ms`
    );

    if (!result) {
      return {
        webContext: "",
        webSources: [],
        error:
          "No sufficiently relevant web results were found.",
      };
    }

    console.log(
      "LangGraph web search:",
      {
        success: true,
        sourceCount:
          result.sources.length,
      }
    );

    return {
      webContext:
        result.context,

      webSources:
        result.sources,

      error: null,
    };
  } catch (error) {
    console.error(
      "LangGraph web node failed:",
      error
    );

    return {
      webContext: "",
      webSources: [],
      error:
        "Web search failed.",
    };
  }
}

export const studyMateGraph =
  new StateGraph(StudyMateState)
    .addNode(
      "router",
      routerNode
    )
    .addNode(
      "direct",
      directNode
    )
    .addNode(
      "document",
      documentNode
    )
    .addNode(
      "web",
      webNode
    )
    .addNode(
      "quiz",
      quizNode
    )
    .addNode(
      "planner",
      plannerNode
    )
    .addNode(
      "revision",
      revisionNode
    )
    .addNode(
      "assignment",
      assignmentNode
    )
    .addNode(
      "verify_web",
      verificationNode
    )
    .addNode(
      "generate_response",
      responseNode
    )
    .addEdge(
      START,
      "router"
    )
    .addConditionalEdges(
      "router",
      routeAfterRouter,
      {
        direct: "direct",
        document: "document",
        web: "web",
        quiz: "quiz",
        planner: "planner",
        revision: "revision",
        assignment: "assignment",
      }
    )
    .addEdge(
      "direct",
      "generate_response"
    )
    .addEdge(
      "document",
      "generate_response"
    )
    .addEdge(
      "web",
      "verify_web"
    )
    .addEdge(
      "verify_web",
      "generate_response"
    )
    .addEdge(
      "quiz",
      END
    )
    .addEdge(
      "planner",
      END
    )
    .addEdge(
      "revision",
      END
    )
    .addEdge(
      "assignment",
      END
    )
    .addEdge(
      "generate_response",
      END
    )
    .compile({
      checkpointer:
        graphCheckpointer,
    });