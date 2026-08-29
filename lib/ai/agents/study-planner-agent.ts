import { z } from "zod";

import {
  createAIStructuredCompletion,
  type ChatMessage,
} from "@/lib/ai/provider";

export const plannerTaskTypeSchema = z.enum([
  "learn",
  "review",
  "practice",
  "quiz",
  "break",
  "other",
]);

export const plannerDayTaskSchema = z.object({
  task: z
    .string()
    .min(1),

  minutes: z
    .number()
    .int()
    .min(0)
    .max(960)
    .nullable(),

  type: plannerTaskTypeSchema,
});

export const plannerDaySchema = z.object({
  day: z
    .number()
    .int()
    .min(1)
    .max(120),

  label: z
    .string()
    .min(1),

  focus: z
    .string()
    .min(1),

  /*
   * checkpoint is declared BEFORE tasks on
   * purpose: Groq strict guided decoding
   * emits object properties in schema order,
   * so small scalars placed before the large
   * tasks array are never dropped when the
   * model closes an object early.
   */
  checkpoint: z
    .string()
    .nullable(),

  tasks: z
    .array(plannerDayTaskSchema)
    .min(1)
    .max(12),
});

/*
 * Root property order matters: Groq strict
 * guided decoding emits keys in declaration
 * order, and a large `days` array declared
 * last previously pushed finalReview/tips
 * past the point where gpt-oss-120b stopped
 * generating. Keep compact fields first and
 * `days` last.
 */
export const studyPlanSchema = z.object({
  title: z
    .string()
    .min(1),

  goal: z
    .string()
    .min(1),

  durationDays: z
    .number()
    .int()
    .min(1)
    .max(120)
    .nullable(),

  totalStudyHours: z
    .number()
    .min(0)
    .max(400)
    .nullable(),

  assumptions: z
    .array(z.string().min(1))
    .max(8),

  finalReview: z
    .array(z.string().min(1))
    .max(8),

  tips: z
    .array(z.string().min(1))
    .max(8),

  days: z
    .array(plannerDaySchema)
    .min(1)
    .max(120),
});

export type PlannerTaskType = z.infer<
  typeof plannerTaskTypeSchema
>;

export type StudyPlanResult =
  z.infer<typeof studyPlanSchema>;

export type GenerateStudyPlanInput = {
  request: string;

  context?: string;

  previousPlan?: StudyPlanResult | null;

  conversation?: string;
};

export type GenerateStudyPlanOptions =
  {
    /*
     * Reports which provider/model actually
     * produced the plan. Used by tests to
     * detect unintended fallbacks without
     * changing the function's return shape.
     */
    onMeta?: (meta: {
      provider: string;
      model: string;
    }) => void;
  };

function formatPreviousPlan(
  previousPlan: StudyPlanResult
): string {
  return JSON.stringify(
    previousPlan,
    null,
    2
  ).slice(0, 12000);
}

/*
 * Structured plans are large JSON payloads,
 * so an explicit output ceiling prevents a
 * low provider default from truncating
 * generation mid-object.
 *
 * However, Groq validates prompt tokens +
 * max_tokens against a small per-request
 * token budget, so the ceiling must be
 * clamped against a cheap character-based
 * prompt estimate. When even a minimal
 * ceiling does not fit, max_tokens is
 * omitted entirely and the provider default
 * applies (historically reliable).
 */
const PLANNER_DESIRED_OUTPUT_TOKENS =
  6000;

const PLANNER_MIN_OUTPUT_TOKENS = 2048;

const PLANNER_TOKEN_REQUEST_BUDGET =
  7500;

function resolvePlannerMaxTokens(
  messages: ChatMessage[]
): number | undefined {
  const promptCharacters =
    messages.reduce(
      (sum, message) =>
        sum + message.content.length,
      0
    );

  const estimatedPromptTokens =
    Math.ceil(promptCharacters / 4);

  const allowance =
    PLANNER_TOKEN_REQUEST_BUDGET -
    estimatedPromptTokens;

  if (
    allowance <
    PLANNER_MIN_OUTPUT_TOKENS
  ) {
    return undefined;
  }

  return Math.min(
    PLANNER_DESIRED_OUTPUT_TOKENS,
    allowance
  );
}

export async function generateStudyPlan(
  {
    request,
    context = "",
    previousPlan = null,
    conversation = "",
  }: GenerateStudyPlanInput,
  options?: GenerateStudyPlanOptions
): Promise<StudyPlanResult> {
  const hasContext =
    context.trim().length > 0;

  const hasPreviousPlan =
    previousPlan !== null &&
    previousPlan !== undefined;

  const wantsDetail =
    /\b(detail|detailed|comprehensive|in[- ]depth|thorough|extensive|full|elaborate|complete)\b/i.test(
      request
    );

  const wantsConcise =
    /\b(concise|short|brief|simple|quick|compact|minimal)\b/i.test(
      request
    );

  const detailRule = wantsDetail
    ? "- The user asked for a detailed plan. Include specific topics, concrete tasks, and per-task minutes."
    : wantsConcise
      ? "- The user asked for a concise plan. Keep it compact: fewer, shorter tasks per day."
      : "- Default to a clear, moderately detailed plan.";

  const messages:
    ChatMessage[] = [
    {
      role: "system",
      content: `
You are the Study Planner Agent for StudyMate AI.

Create a realistic, structured study plan.

REALISM RULES:
- Plans must be realistic for a student.
- Never schedule more than about 4 focused hours per day unless the user explicitly asks for more.
- Include 3 to 6 tasks per day, not more.
- Include short breaks inside heavy study days (type: "break").
- Alternate learning with retrieval practice: new material (learn) should be followed by practice or self-quizzing on later days.
- Use spaced review: revisit earlier topics again near the end of the plan (type: "review").
- Give every day a clear focus, and end days with a checkpoint describing what the student should be able to do.
- Prefer tasks like "solve 5 problems", "recall key rules from memory", "review mistakes" over vague tasks like "study topic".
- Keep task text short: under about 80 characters per task.

HONESTY RULES:
- Do not invent an exam date if none was supplied.
- Do not invent available study hours if none were supplied.
- When important information is missing (duration, deadline, daily availability), make a sensible choice and state it clearly in the assumptions array, e.g. "Assumed 2 hours of study per day".
- When no duration is supplied, prefer 5 to 7 days unless the subject clearly needs more.
- durationDays must match the number of entries in days when a duration is known; otherwise use your stated assumption.
- totalStudyHours is your estimate of total planned study time; use null only if it cannot be estimated.
- Every task's minutes must fit inside a sane daily budget.

MODIFICATION RULES:
${
  hasPreviousPlan
    ? `- A previous version of this plan is supplied below. Apply ONLY the change(s) requested in the new message while keeping everything else consistent.
- If the request clearly asks for a brand-new plan about a different subject, create a fresh plan instead of modifying.
- Keep earlier day numbering continuous and renumber cleanly after structural changes.
- Preserve topics, checkpoints, and review spacing unless the change requires adjusting them.
- If the change conflicts with realism (for example far too little time), keep it realistic and say so in assumptions.`
    : `- No previous plan exists; create a fresh plan.`
}

DETAIL:
${detailRule}

GROUNDING:
${
  hasContext
    ? `Use ONLY the supplied study context as the source of topics, terms, and scope.
Every day's focus and tasks must come from the context.
Do NOT invent chapters, sections, or topics that are absent from the context.
If the context is narrow, cover it more slowly instead of adding outside topics.`
    : `No document context was supplied.
Use stable general knowledge about the requested subject.
Do not reference any uploaded files.`
}
${
  conversation.trim()
    ? `
RECENT CONVERSATION:
You may use it to resolve references such as "it", "that", or subject names mentioned earlier.`
    : ""
}

OUTPUT:
Return structured data only, matching the schema exactly.
The JSON object MUST always include ALL eight top-level keys: title, goal, durationDays, totalStudyHours, assumptions, finalReview, tips, days.
Never omit finalReview or tips; emit them right after assumptions and BEFORE days. Use [] when a field does not apply.
Every entry in days must include day, label, focus, checkpoint (use null if no checkpoint), and tasks. Every task must include task, minutes, and type.
Do not include markdown formatting inside individual fields.
      `.trim(),
    },
  ];

  if (conversation.trim()) {
    messages.push({
      role: "user",

      content: `
RECENT CONVERSATION:
${conversation.slice(-2400)}
      `.trim(),
    });
  }

  if (hasPreviousPlan) {
    messages.push({
      role: "user",

      content: `
PREVIOUS PLAN TO MODIFY:
${formatPreviousPlan(previousPlan)}
      `.trim(),
    });
  }

  messages.push({
    role: "user",

    content: `
STUDY CONTEXT:
${context || "None"}

REQUEST:
Create or update the study plan for this request:

${request}

FINAL REMINDER:
The JSON output MUST contain all eight top-level keys: title, goal, durationDays, totalStudyHours, assumptions, finalReview, tips, days. Emit finalReview and tips BEFORE days; use [] if empty. Every day needs day, label, focus, checkpoint, tasks.
    `.trim(),
  });

  const generationStartedAt =
    performance.now();

  try {
    const result =
      await createAIStructuredCompletion(
        messages,
        studyPlanSchema,
        "studymate_study_plan",

        {
          modelRole: "balanced",

          maxTokens:
            resolvePlannerMaxTokens(
              messages
            ),
        }
      );

    if (result.model) {
      options?.onMeta?.({
        provider: result.provider,

        model: result.model,
      });
    }

    console.log(
      `[perf] planner generation: ${Math.round(
        performance.now() -
          generationStartedAt
      )}ms`
    );

    return result.data;
  } catch (error) {
    console.error(
      `[perf] planner generation failed after ${Math.round(
        performance.now() -
          generationStartedAt
      )}ms`,
      error
    );

    throw error;
  }
}

/*
 * Renders the structured plan as clean
 * Markdown for the existing chat UI. A
 * future interactive planner card can read
 * plannerData from graph state instead.
 */
export function renderStudyPlanMarkdown(
  plan: StudyPlanResult
): string {
  const lines: string[] = [];

  lines.push(`## ${plan.title}`);

  lines.push("");

  lines.push(plan.goal);

  if (
    plan.durationDays !== null
  ) {
    lines.push("");

    lines.push(
      `**Duration:** ${plan.durationDays} day${plan.durationDays === 1 ? "" : "s"}`
    );
  }

  if (
    plan.totalStudyHours !== null
  ) {
    const hours =
      Math.round(
        plan.totalStudyHours * 10
      ) / 10;

    lines.push(
      `**Total study time:** about ${hours} hour${hours === 1 ? "" : "s"}`
    );
  }

  if (
    plan.assumptions.length > 0
  ) {
    lines.push("");

    lines.push(
      "**Assumptions**"
    );

    for (const assumption of plan.assumptions) {
      lines.push(
        `- ${assumption}`
      );
    }
  }

  for (const day of plan.days) {
    lines.push("");

    lines.push(
      `### Day ${day.day} — ${day.label}`
    );

    lines.push("");

    lines.push(day.focus);

    lines.push("");

    for (const task of day.tasks) {
      const minutesPrefix =
        task.minutes !== null &&
        task.minutes > 0
          ? `${task.minutes} min: `
          : "";

      const typeSuffix =
        task.type === "other"
          ? ""
          : ` _(${task.type})_`;

      lines.push(
        `- ${minutesPrefix}${task.task}${typeSuffix}`
      );
    }

    if (day.checkpoint) {
      lines.push("");
      lines.push("");
      lines.push(
        `**Checkpoint:** ${day.checkpoint}`
      );
    }
  }

  if (
    plan.finalReview.length > 0
  ) {
    lines.push("");
    lines.push("");
    lines.push(
      "### Final Review"
    );

    for (const item of plan.finalReview) {
      lines.push(`- ${item}`);
    }
  }

  if (plan.tips.length > 0) {
    lines.push("");
    lines.push("");
    lines.push("### Tips");

    for (const tip of plan.tips) {
      lines.push(`- ${tip}`);
    }
  }

  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
