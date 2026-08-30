import {
  Bot,
  FileText,
  User,
} from "lucide-react";

import type {
  Message,
  QuizData,
} from "@/types/chat";

import ChatMarkdown from "./ChatMarkdown";
import QuizCard from "./QuizCard";

type ChatMessagesProps = {
  messages: Message[];

  bottomRef:
    React.RefObject<
      HTMLDivElement | null
    >;

  copiedCode:
    string | null;

  isLoading:
    boolean;

  statusMessage:
    string | null;

  webSearchEnabled:
    boolean;

  onCopyCode: (
    code: string
  ) => void;

  onQuizChange: (
    messageIndex: number,
    quiz: QuizData
  ) => void;
};

export default function ChatMessages({
  messages,
  bottomRef,
  copiedCode,
  isLoading,
  statusMessage,
  webSearchEnabled,
  onCopyCode,
  onQuizChange,
}: ChatMessagesProps) {
  return (
    <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto bg-white dark:bg-slate-950">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 md:px-6">
        {messages.map(
          (
            message,
            index
          ) => (
            <div
              key={index}
              className={`flex gap-3 ${
                message.role ===
                "user"
                  ? "justify-end"
                  : "justify-start"
              }`}
            >
              {message.role ===
                "assistant" && (
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-600/10 p-1.5 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">
                  <Bot
                    size={
                      14
                    }
                  />
                </div>
              )}

              {message.role ===
              "assistant" ? (
                <div className="min-w-0 flex-1 text-[15px] leading-relaxed text-slate-800 dark:text-slate-100">
                  {message.content && (
                    <ChatMarkdown
                      content={
                        message.content
                      }
                      copiedCode={
                        copiedCode
                      }
                      onCopyCode={
                        onCopyCode
                      }
                    />
                  )}

                  {!message.content &&
                    isLoading &&
                    statusMessage && (
                      <div className="flex items-center gap-2.5 py-1">
                        <span className="text-sm text-slate-500 dark:text-slate-400">
                          {statusMessage}
                        </span>
                        <span className="flex gap-1">
                          <span
                            className="h-1.5 w-1.5 rounded-full bg-slate-400 dark:bg-slate-500"
                            style={{
                              animation:
                                "thinking-dot 1.4s infinite",
                              animationDelay:
                                "0s",
                            }}
                          />
                          <span
                            className="h-1.5 w-1.5 rounded-full bg-slate-400 dark:bg-slate-500"
                            style={{
                              animation:
                                "thinking-dot 1.4s infinite",
                              animationDelay:
                                "0.2s",
                            }}
                          />
                          <span
                            className="h-1.5 w-1.5 rounded-full bg-slate-400 dark:bg-slate-500"
                            style={{
                              animation:
                                "thinking-dot 1.4s infinite",
                              animationDelay:
                                "0.4s",
                            }}
                          />
                        </span>
                      </div>
                    )}

                  {message.quiz && (
                    <QuizCard
                      quiz={
                        message.quiz
                      }
                      onChange={(
                        quiz
                      ) =>
                        onQuizChange(
                          index,
                          quiz
                        )
                      }
                    />
                  )}
                </div>
              ) : (
                <div className="max-w-xl space-y-2">
                  {message.attachment && (
                    <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-left dark:border-blue-900/60 dark:bg-blue-950/30">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white">
                        <FileText
                          size={
                            18
                          }
                        />
                      </div>

                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                          {
                            message
                              .attachment
                              .name
                          }
                        </p>

                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {(
                            message
                              .attachment
                              .size /
                            1024 /
                            1024
                          ).toFixed(
                            2
                          )}{" "}
                          MB · PDF
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="rounded-2xl bg-blue-600 px-4 py-3 text-[15px] leading-relaxed text-white">
                    {
                      message.content
                    }
                  </div>
                </div>
              )}

              {message.role ===
                "user" && (
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-200 p-1.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  <User
                    size={
                      14
                    }
                  />
                </div>
              )}
            </div>
          )
        )}

        <style>{`
          @keyframes thinking-dot {
            0%, 60%, 100% { opacity: 0.2; transform: scale(0.8); }
            30% { opacity: 1; transform: scale(1); }
          }
        `}</style>

        <div
          ref={
            bottomRef
          }
        />
      </div>
    </div>
  );
}