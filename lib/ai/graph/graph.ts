import {
  END,
  START,
  StateGraph,
} from "@langchain/langgraph";

import {
  StudyMateState,
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
          userMessage,
        context:
          quizContext,
        questionCount: 5,
      });

    const visibleResponse =
  quiz.questions.length > 0
    ? `I created a ${quiz.questions.length}-question quiz for you. Choose your answers below, then submit when you're ready.`
    : "I couldn't create enough reliable quiz questions for that topic.";

return {
  response:
    visibleResponse,

  quizTopic:
    userMessage,

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
async function responseNode(
  state: StudyMateGraphState
) {
  console.log(
    "LangGraph node: response"
  );

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
   * Convert LangGraph message history
   * into the provider's ChatMessage format.
   *
   * This is what allows checkpointed
   * conversation context to reach the LLM.
   */
  const conversationMessages:
    ChatMessage[] =
    (state.messages ?? [])
      .slice(-12)
      .map((message) => {
        const type =
          message._getType();

        const content =
          typeof message.content ===
          "string"
            ? message.content
            : String(
                message.content
              );

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

  try {
    const completion =
      await createAICompletion(
        messages,
        {
          temperature: 0.35,
          maxTokens: 800,
        }
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
    const result =
      await searchDocuments({
        chatId,
        query,
        limit: 4,
      });

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
    const result =
      await searchWebMultiple([
        query,
      ]);

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
      "generate_response",
      END
    )
    .compile({
      checkpointer:
        graphCheckpointer,
    });