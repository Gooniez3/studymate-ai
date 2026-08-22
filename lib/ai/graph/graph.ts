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

async function quizNode(
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

    const wantsDocumentQuiz =
      /\b(pdf|document|file|uploaded|upload|notes|slides|material|chapter)\b/.test(
        lowerMessage
      );

    if (
      wantsDocumentQuiz &&
      state.chatId
    ) {
      const documentResult =
        await searchDocuments({
          chatId:
            state.chatId,
          query:
            userMessage,
          limit: 4,
        });

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

OUTPUT:
- Return only the answer.
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
      completion.content.trim();

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