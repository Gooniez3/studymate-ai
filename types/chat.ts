export type Attachment = {
  name: string;
  type: string;
  size: number;
};

export type ChatDocument = {
  name: string;
  type: string;
  size: number;
  extractedText: string;
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

  answers?: Record<number, string>;

  submitted?: boolean;

  score?: number | null;
};

export type Message = {
  role: "user" | "assistant";
  content: string;
  attachment?: Attachment | null;
  quiz?: QuizData | null;
};

export type ChatMode =
  | "exam"
  | "assignment"
  | "career";

export type DefaultChatMode =
  | "default"
  | ChatMode;

export type ChatSession = {
  id: string;
  title: string;
  mode?: DefaultChatMode;
  messages: Message[];
  documents?: ChatDocument[];
  updatedAt: string;
};

export type AppTheme =
  | "dark"
  | "light"
  | "system";