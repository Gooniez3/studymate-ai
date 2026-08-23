import {
  Annotation,
  MessagesAnnotation,
} from "@langchain/langgraph";

export type StudyMateRoute =
  | "direct"
  | "document"
  | "web"
  | "quiz";

export type StudyMateMode =
  | "default"
  | "exam"
  | "assignment"
  | "career";

export type WebSource = {
  title: string;
  url: string;
};

export type DocumentCitation = {
  evidenceNumber: number;
  documentName: string;
  pageNumber: number | null;
};

export type QuizQuestion = {
  question: string;
  options: string[];
  answer: string;
  explanation: string;
};

export type QuizData = {
  title: string;
  questions: QuizQuestion[];
};

export const StudyMateState =
  Annotation.Root({
    ...MessagesAnnotation.spec,

    chatId: Annotation<string | null>({
      reducer: (_, next) => next,
      default: () => null,
    }),

    mode: Annotation<StudyMateMode>({
      reducer: (_, next) => next,
      default: () => "default",
    }),

    webSearchEnabled: Annotation<boolean>({
      reducer: (_, next) => next,
      default: () => false,
    }),

    route: Annotation<StudyMateRoute>({
      reducer: (_, next) => next,
      default: () => "direct",
    }),

    /*
     * Route chosen in the previous turn.
     * Persisted via checkpoints so the router
     * and downstream nodes can detect
     * document-focused follow-up turns.
     */
    previousRoute: Annotation<
      StudyMateRoute | null
    >({
      reducer: (_, next) => next,
      default: () => null,
    }),

    documentContext: Annotation<string>({
      reducer: (_, next) => next,
      default: () => "",
    }),

    webContext: Annotation<string>({
      reducer: (_, next) => next,
      default: () => "",
    }),

    verificationContext: Annotation<string>({
      reducer: (_, next) => next,
      default: () => "",
    }),

    webSources: Annotation<WebSource[]>({
      reducer: (_, next) => next,
      default: () => [],
    }),

    documentCitations:
      Annotation<DocumentCitation[]>({
        reducer: (_, next) => next,
        default: () => [],
      }),

    /*
     * Names of documents that actually exist
     * for this chat (including one uploaded
     * in the current request). Empty means
     * the chat has no retrievable documents.
     */
    documentNames: Annotation<string[]>({
      reducer: (_, next) => next,
      default: () => [],
    }),

    /*
     * True only when a PDF was attached and
     * saved as part of the current request.
     */
    documentAttachedThisTurn: Annotation<boolean>({
      reducer: (_, next) => next,
      default: () => false,
    }),

    response: Annotation<string>({
      reducer: (_, next) => next,
      default: () => "",
    }),

    error: Annotation<string | null>({
      reducer: (_, next) => next,
      default: () => null,
    }),

    quizTopic: Annotation<string>({
  reducer: (_, next) => next,
  default: () => "",
}),

quizContext: Annotation<string>({
  reducer: (_, next) => next,
  default: () => "",
}),

quizData: Annotation<QuizData | null>({
  reducer: (_, next) => next,
  default: () => null,
}),
  });

export type StudyMateGraphState =
  typeof StudyMateState.State;