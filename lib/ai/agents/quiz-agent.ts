import { z } from "zod";

import {
  createAIStructuredCompletion,
  type ChatMessage,
} from "@/lib/ai/provider";

export const quizSchema = z.object({
  title: z
    .string()
    .min(1),

  questions: z
    .array(
      z.object({
        question: z
          .string()
          .min(1),

        options: z
          .array(
            z.string().min(1)
          )
          .length(4),

        answer: z
          .string()
          .min(1),

        explanation: z
          .string()
          .min(1),
      })
    )
    .min(1)
    .max(10),
});

export type QuizResult =
  z.infer<typeof quizSchema>;

 function shuffleOptions(
  options: string[]
): string[] {
  const shuffled =
    [...options];

  for (
    let index =
      shuffled.length - 1;
    index > 0;
    index -= 1
  ) {
    const randomIndex =
      Math.floor(
        Math.random() *
          (index + 1)
      );

    [
      shuffled[index],
      shuffled[randomIndex],
    ] = [
      shuffled[randomIndex],
      shuffled[index],
    ];
  }

  return shuffled;
} 

export async function generateQuiz({
  topic,
  context = "",
  questionCount = 5,
}: {
  topic: string;
  context?: string;
  questionCount?: number;
}): Promise<QuizResult> {
  const safeQuestionCount =
    Math.min(
      Math.max(
        questionCount,
        1
      ),
      10
    );

  const messages:
    ChatMessage[] = [
    {
      role: "system",
      content: `
You are the Quiz Agent for StudyMate AI.

Create a high-quality multiple-choice quiz.

RULES:
- Generate exactly ${safeQuestionCount} questions.
- Every question must have exactly 4 options.
- Only one option should be correct.
- The answer field must contain the exact text of the correct option.
- Explanations should be short but useful.
- Avoid trick questions unless the topic genuinely requires them.
- Questions should test understanding, not only memorization.
- Vary difficulty when possible.
- Do not include markdown in individual fields.

GROUNDING:
${
  context.trim()
    ? `Use ONLY the supplied study context for factual claims.
Do not add facts that are not supported by the context.
If the context is too limited to create ${safeQuestionCount} reliable questions, create fewer questions rather than inventing content.`
    : `No document context was supplied.
Use stable general knowledge about the requested topic.`
}

STUDY CONTEXT:
${context || "None"}
      `.trim(),
    },
    {
      role: "user",
      content: `
Create a quiz about:

${topic}
      `.trim(),
    },
  ];

  const result =
    await createAIStructuredCompletion(
      messages,
      quizSchema,
      "studymate_quiz"
    );

  return {
  ...result.data,

  questions:
    result.data.questions.map(
      (question) => ({
        ...question,

        options:
          shuffleOptions(
            question.options
          ),
      })
    ),
};
}