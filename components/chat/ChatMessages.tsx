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
  webSearchEnabled,
  onCopyCode,
  onQuizChange,
}: ChatMessagesProps) {
  return (
    <div className="flex-1 overflow-y-auto bg-white dark:bg-slate-950">
      <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
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
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 p-2 text-white">
                  <Bot
                    size={
                      16
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
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-300 p-2 text-slate-700 dark:bg-slate-700 dark:text-white">
                  <User
                    size={
                      16
                    }
                  />
                </div>
              )}
            </div>
          )
        )}

        {isLoading &&
          webSearchEnabled && (
            <div className="flex justify-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 p-2 text-white">
                <Bot
                  size={16}
                />
              </div>

              <div className="mt-1 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                <span className="animate-pulse">
                  Searching the web...
                </span>
              </div>
            </div>
          )}

        <div
          ref={
            bottomRef
          }
        />
      </div>
    </div>
  );
}