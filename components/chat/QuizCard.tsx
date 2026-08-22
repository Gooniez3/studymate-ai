"use client";
import React from "react";
import {
  CheckCircle2,
  RotateCcw,
  XCircle,
} from "lucide-react";

import type {
  QuizData,
} from "@/types/chat";

type QuizCardProps = {
  quiz: QuizData;

  onChange?: (
    quiz: QuizData
  ) => void;
};

export default function QuizCard({
  quiz,
  onChange,
}: QuizCardProps) {
  const [answers, setAnswers] =
  React.useState<
    Record<number, string>
  >(
    quiz.answers ?? {}
  );

const [submitted, setSubmitted] =
  React.useState(
    quiz.submitted ?? false
  );

  const selectAnswer = (
  questionIndex: number,
  option: string
) => {
  if (submitted) {
    return;
  }

  const nextAnswers = {
    ...answers,
    [questionIndex]:
      option,
  };

  setAnswers(
    nextAnswers
  );

  onChange?.({
    ...quiz,

    answers:
      nextAnswers,

    submitted:
      false,

    score:
      null,
  });
};

  const answeredCount =
    Object.keys(
      answers
    ).length;

  const totalQuestions =
    quiz.questions.length;

  const allAnswered =
    answeredCount ===
    totalQuestions;

  const score =
    quiz.questions.reduce(
      (
        total,
        question,
        index
      ) => {
        if (
          answers[index] ===
          question.answer
        ) {
          return total + 1;
        }

        return total;
      },
      0
    );

  const percentage =
    totalQuestions > 0
      ? Math.round(
          (score /
            totalQuestions) *
            100
        )
      : 0;

  const submitQuiz = () => {
  if (!allAnswered) {
    return;
  }

  setSubmitted(true);

  onChange?.({
    ...quiz,

    answers,

    submitted: true,

    score,
  });
};

  const resetQuiz = () => {
  setAnswers({});
  setSubmitted(false);

  onChange?.({
    ...quiz,

    answers: {},

    submitted: false,

    score: null,
  });
};

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
              StudyMate Quiz
            </p>

            <h3 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
              {quiz.title}
            </h3>

            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {totalQuestions} questions
            </p>
          </div>

          {!submitted && (
            <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {answeredCount}/
              {totalQuestions} answered
            </div>
          )}
        </div>
      </div>

      <div className="space-y-7 p-5">
        {quiz.questions.map(
          (
            question,
            questionIndex
          ) => {
            const selectedAnswer =
              answers[
                questionIndex
              ];

            const isCorrect =
              selectedAnswer ===
              question.answer;

            return (
              <div
                key={
                  questionIndex
                }
                className="space-y-3"
              >
                <div className="flex gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                    {questionIndex +
                      1}
                  </div>

                  <p className="pt-0.5 font-medium leading-relaxed text-slate-900 dark:text-slate-100">
                    {
                      question.question
                    }
                  </p>
                </div>

                <div className="space-y-2 pl-10">
                  {question.options.map(
                    (
                      option,
                      optionIndex
                    ) => {
                      const selected =
                        selectedAnswer ===
                        option;

                      const correct =
                        option ===
                        question.answer;

                      let optionClass =
                        "border-slate-200 bg-white hover:border-blue-400 hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-blue-600 dark:hover:bg-blue-950/30";

                      if (
                        !submitted &&
                        selected
                      ) {
                        optionClass =
                          "border-blue-500 bg-blue-50 dark:border-blue-500 dark:bg-blue-950/40";
                      }

                      if (
                        submitted &&
                        correct
                      ) {
                        optionClass =
                          "border-emerald-500 bg-emerald-50 dark:border-emerald-600 dark:bg-emerald-950/30";
                      }

                      if (
                        submitted &&
                        selected &&
                        !correct
                      ) {
                        optionClass =
                          "border-red-500 bg-red-50 dark:border-red-600 dark:bg-red-950/30";
                      }

                      return (
                        <button
                          key={
                            optionIndex
                          }
                          type="button"
                          disabled={
                            submitted
                          }
                          onClick={() =>
                            selectAnswer(
                              questionIndex,
                              option
                            )
                          }
                          className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition ${optionClass}`}
                        >
                          <div
                            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                              selected
                                ? "border-blue-500 bg-blue-600 text-white"
                                : "border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400"
                            }`}
                          >
                            {String.fromCharCode(
                              65 +
                                optionIndex
                            )}
                          </div>

                          <span className="flex-1 text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                            {option}
                          </span>

                          {submitted &&
                            correct && (
                              <CheckCircle2
                                size={
                                  19
                                }
                                className="mt-0.5 shrink-0 text-emerald-600"
                              />
                            )}

                          {submitted &&
                            selected &&
                            !correct && (
                              <XCircle
                                size={
                                  19
                                }
                                className="mt-0.5 shrink-0 text-red-600"
                              />
                            )}
                        </button>
                      );
                    }
                  )}
                </div>

                {submitted && (
                  <div
                    className={`ml-10 rounded-xl border px-4 py-3 ${
                      isCorrect
                        ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20"
                        : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20"
                    }`}
                  >
                    {!isCorrect && (
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                        Correct answer:{" "}
                        {
                          question.answer
                        }
                      </p>
                    )}

                    <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                      {
                        question.explanation
                      }
                    </p>
                  </div>
                )}
              </div>
            );
          }
        )}
      </div>

      <div className="border-t border-slate-200 p-5 dark:border-slate-800">
        {!submitted ? (
          <div>
            <button
              type="button"
              onClick={
                submitQuiz
              }
              disabled={
                !allAnswered
              }
              className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {allAnswered
                ? "Submit Quiz"
                : `Answer all questions (${answeredCount}/${totalQuestions})`}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 p-5 text-center dark:bg-slate-800/60">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                Your score
              </p>

              <p className="mt-1 text-3xl font-bold text-slate-900 dark:text-white">
                {score}/
                {totalQuestions}
              </p>

              <p className="mt-1 text-sm font-semibold text-blue-600 dark:text-blue-400">
                {percentage}%
              </p>
            </div>

            <button
              type="button"
              onClick={
                resetQuiz
              }
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <RotateCcw
                size={17}
              />
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}