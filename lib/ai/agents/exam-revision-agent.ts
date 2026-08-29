import { z } from "zod";

import {
  createAIStructuredCompletion,
  type ChatMessage,
} from "@/lib/ai/provider";

export const revisionImportanceSchema =
  z.enum(["high", "medium", "low"]);

export const revisionKeyConceptSchema =
  z.object({
    concept: z
      .string()
      .min(1)
      .max(120),

    explanation: z
      .string()
      .min(1)
      .max(600),

    importance:
      revisionImportanceSchema,
  });

export const revisionQuickRecallSchema =
  z.object({
    prompt: z
      .string()
      .min(1)
      .max(200),

    answer: z
      .string()
      .min(1)
      .max(300),
  });

export const revisionLikelyQuestionSchema =
  z.object({
    question: z
      .string()
      .min(1)
      .max(240),

    answerOutline: z
      .string()
      .min(1)
      .max(500),
  });

/*
 * Guided decoding sometimes drifts after
 * several object-in-array sections and emits
 * trailing string-array items as single-key
 * objects such as {"item": "..."} or
 * {"tip": "..."}. These helpers normalize
 * such items back to plain strings BEFORE
 * validation, so one drifted section cannot
 * fail the whole generation.
 */
const STRING_ITEM_KEYS = [
  "text",

  "item",

  "tip",

  "point",

  "step",

  "task",

  "description",

  "value",

  "note",

  "content",
];

function coerceToStringItems(
  input: unknown,
  maxItems: number
): unknown[] {
  const items = Array.isArray(input)
    ? input
    : [];

  return items
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (
        item &&
        typeof item === "object"
      ) {
        const record = item as Record<
          string,
          unknown
        >;

        for (const key of STRING_ITEM_KEYS) {
          const value = record[key];

          if (
            typeof value === "string" &&
            value.trim()
          ) {
            return value;
          }
        }

        const values =
          Object.values(record);

        if (
          values.length === 1 &&
          typeof values[0] === "string"
        ) {
          return values[0];
        }
      }

      return item;
    })
    .slice(0, maxItems);
}

function limitObjectItems(
  input: unknown,
  maxItems: number
): unknown[] {
  return Array.isArray(input)
    ? input.slice(0, maxItems)
    : [];
}

/*
 * Field order lessons from the Study Planner
 * and revision reliability runs:
 *
 * 1. Compact scalars come first.
 * 2. All plain-string arrays are grouped
 *    together immediately after them.
 *    Alternating between string arrays and
 *    object arrays made gpt-oss-120b emit
 *    trailing string items as objects, so
 *    type changes are now minimized.
 * 3. The larger object arrays close the
 *    object, each size-capped, so late
 *    truncation can only cost supplementary
 *    material - never a required scalar or
 *    checklist field.
 *
 * Additionally, every array passes through a
 * preprocessing guard that coerces drifted
 * single-key string objects back to plain
 * strings and slices oversized arrays to the
 * schema cap. Guided decoding on Groq is
 * validated AFTER generation, so one extra
 * item would otherwise invalidate an entire
 * otherwise-correct generation.
 */
export const examRevisionSchema = z.object({
  title: z
    .string()
    .min(1)
    .max(160),

  topic: z
    .string()
    .min(1)
    .max(160),

  objective: z
    .string()
    .min(1)
    .max(400),

  assumptions: z.preprocess(
    (input) =>
      coerceToStringItems(input, 8),

    z
      .array(z.string().min(1).max(240))
      .max(8)
  ),

  mustRemember: z.preprocess(
    (input) =>
      coerceToStringItems(input, 10),

    z
      .array(z.string().min(1).max(280))
      .max(10)
  ),

  commonMistakes: z.preprocess(
    (input) =>
      coerceToStringItems(input, 10),

    z
      .array(z.string().min(1).max(280))
      .max(10)
  ),

  revisionChecklist: z.preprocess(
    (input) =>
      coerceToStringItems(input, 10),

    z
      .array(z.string().min(1).max(240))
      .max(10)
  ),

  examTips: z.preprocess(
    (input) =>
      coerceToStringItems(input, 10),

    z
      .array(z.string().min(1).max(280))
      .max(10)
  ),

  keyConcepts: z.preprocess(
    (input) =>
      limitObjectItems(input, 10),

    z
      .array(
        revisionKeyConceptSchema
      )
      .max(10)
  ),

  quickRecall: z.preprocess(
    (input) =>
      limitObjectItems(input, 8),

    z
      .array(
        revisionQuickRecallSchema
      )
      .max(8)
  ),

  likelyQuestions: z.preprocess(
    (input) =>
      limitObjectItems(input, 8),

    z
      .array(
        revisionLikelyQuestionSchema
      )
      .max(8)
  ),
});

export type RevisionImportance =
  z.infer<
    typeof revisionImportanceSchema
  >;

export type ExamRevisionResult =
  z.infer<typeof examRevisionSchema>;

export type GenerateExamRevisionInput =
  {
    request: string;

    context?: string;

    previousRevision?:
      | ExamRevisionResult
      | null;

    conversation?: string;
  };

export type GenerateExamRevisionOptions =
  {
    /*
     * Reports which provider/model actually
     * produced the revision material. Used
     * by tests to detect unintended fallbacks
     * without changing the return shape.
     */
    onMeta?: (meta: {
      provider: string;
      model: string;
    }) => void;
  };

function formatPreviousRevision(
  previousRevision: ExamRevisionResult
): string {
  return JSON.stringify(
    previousRevision,
    null,
    2
  ).slice(0, 10000);
}

/*
 * Structured revision material is a large
 * JSON payload, so an explicit output
 * ceiling prevents a low provider default
 * from truncating generation mid-object.
 *
 * As with the planner, Groq validates
 * prompt tokens + max_tokens against a
 * per-request budget, so the ceiling is
 * clamped against a cheap character-based
 * prompt estimate. When even a minimal
 * ceiling does not fit, max_tokens is
 * omitted entirely and the provider
 * default applies.
 */
const REVISION_DESIRED_OUTPUT_TOKENS =
  4500;

const REVISION_MIN_OUTPUT_TOKENS = 2048;

const REVISION_TOKEN_REQUEST_BUDGET =
  7500;

function resolveRevisionMaxTokens(
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
    REVISION_TOKEN_REQUEST_BUDGET -
    estimatedPromptTokens;

  if (
    allowance <
    REVISION_MIN_OUTPUT_TOKENS
  ) {
    return undefined;
  }

  return Math.min(
    REVISION_DESIRED_OUTPUT_TOKENS,
    allowance
  );
}

export async function generateExamRevision(
  {
    request,
    context = "",
    previousRevision = null,
    conversation = "",
  }: GenerateExamRevisionInput,

  options?: GenerateExamRevisionOptions
): Promise<ExamRevisionResult> {
  const hasContext =
    context.trim().length > 0;

  const hasPreviousRevision =
    previousRevision !== null &&
    previousRevision !== undefined;

  const wantsDetail =
    /\b(detail|detailed|comprehensive|in[- ]depth|thorough|extensive|full|elaborate|complete)\b/i.test(
      request
    );

  const wantsConcise =
    /\b(concise|short|brief|simple|quick|compact|minimal|one[- ]page|cheat\s?sheet)\b/i.test(
      request
    );

  const detailRule = wantsDetail
    ? "- The user asked for detailed revision notes. Cover more concepts and give fuller explanations."
    : wantsConcise
      ? "- The user asked for concise material. Keep it tight: fewer concepts, shorter explanations, compact lists."
      : "- Default to focused, moderately sized revision material. Avoid padding.";

  const messages:
    ChatMessage[] = [
    {
      role: "system",
      content: `
You are the Exam Revision Agent for StudyMate AI.

Transform the user's topic, syllabus, notes, or uploaded documents into focused EXAM REVISION MATERIAL.

This is NOT a quiz. Do not produce an interactive multiple-choice quiz. Likely questions and quick recall are lightweight revision content only.

PRIORITIZATION RULES:
- Prioritize exam-relevant information over background detail.
- Mark each key concept's importance as "high" (core, very likely to be examined), "medium", or "low" (nice to know).
- Keep explanations short and memorable. Prefer one crisp sentence over a paragraph.
- Include common mistakes students make with this material when you can do so honestly.
- quickRecall items are tiny prompt/answer pairs for self-testing (retrieval practice beats passive rereading).
- likelyQuestions describes QUESTION STYLES or practice directions, NOT real exam leaks. Never claim a question will definitely appear. Use hedged phrasing such as "commonly asked" or "typical".
- Prefer retrieval-practice framing in tips and checklist items ("explain X from memory", "solve past-style problems") over passive rereading advice.

HONESTY RULES:
- Never invent an exam format, exam board, marking scheme, syllabus, deadline, or date that was not supplied.
- When important information is missing (exam scope, format, depth), make a sensible choice and state it clearly in assumptions, e.g. "Assumed standard university-level depth; no specific syllabus provided".
- Every assumption must be plainly labeled as an assumption.
- Do not claim any question "will definitely appear" in the exam.

MODIFICATION RULES:
${
  hasPreviousRevision
    ? `- A previous version of this revision material is supplied below. Apply ONLY the change(s) requested in the new message while keeping everything else consistent.
- If the request clearly asks for brand-new material about a different subject, create fresh material instead of modifying.
- Preserve earlier content unless the change requires adjusting it.
- If asked to remove something (e.g. low-priority topics), actually remove it from the output.`
    : `- No previous revision material exists; create fresh material.`
}

DETAIL:
${detailRule}

GROUNDING:
${
  hasContext
    ? `Use ONLY the supplied study context as the source for document-specific facts, terms, definitions, and scope.
Do NOT add course content that is absent from the context.
If the context does not cover part of the request, say so inside assumptions instead of inventing content.`
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
The JSON object MUST always include ALL eleven top-level keys, in this order: title, topic, objective, assumptions, mustRemember, commonMistakes, revisionChecklist, examTips, keyConcepts, quickRecall, likelyQuestions.
Never omit any root key. Use [] when an array field does not apply.
assumptions, mustRemember, commonMistakes, revisionChecklist, and examTips are arrays of PLAIN STRINGS - never arrays of objects.
Every keyConcept needs concept, explanation, and importance ("high" | "medium" | "low").
Every quickRecall item needs prompt and answer. Every likelyQuestion needs question and answerOutline.
Keep individual strings short so all eleven keys are emitted completely.
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

  if (hasPreviousRevision) {
    messages.push({
      role: "user",

      content: `
PREVIOUS REVISION MATERIAL TO MODIFY:
${formatPreviousRevision(previousRevision)}
      `.trim(),
    });
  }

  messages.push({
    role: "user",

    content: `
STUDY CONTEXT:
${context || "None"}

REQUEST:
Create or update the exam revision material for this request:

${request}

FINAL REMINDER:
The JSON output MUST contain all eleven top-level keys: title, topic, objective, assumptions, mustRemember, commonMistakes, revisionChecklist, examTips, keyConcepts, quickRecall, likelyQuestions. assumptions/mustRemember/commonMistakes/revisionChecklist/examTips contain plain strings only - never objects. Use [] if a list does not apply. Keep strings short so nothing is truncated.
    `.trim(),
  });

  const generationStartedAt =
    performance.now();

  try {
    const result =
      await createAIStructuredCompletion(
        messages,
        examRevisionSchema,
        "studymate_exam_revision",

        {
          modelRole: "balanced",

          maxTokens:
            resolveRevisionMaxTokens(
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
      `[perf] revision generation: ${Math.round(
        performance.now() -
          generationStartedAt
      )}ms`
    );

    return result.data;
  } catch (error) {
    console.error(
      `[perf] revision generation failed after ${Math.round(
        performance.now() -
          generationStartedAt
      )}ms`,
      error
    );

    throw error;
  }
}

/*
 * Renders structured revision data as clean
 * Markdown for the existing chat UI. A
 * future interactive revision card can read
 * revisionData from graph state instead.
 */
export function renderExamRevisionMarkdown(
  revision: ExamRevisionResult
): string {
  const lines: string[] = [];

  lines.push(`## ${revision.title}`);

  lines.push("");

  lines.push(revision.objective);

  if (
    revision.assumptions.length > 0
  ) {
    lines.push("");

    lines.push("**Assumptions**");

    for (const assumption of revision.assumptions) {
      lines.push(`- ${assumption}`);
    }
  }

  if (
    revision.keyConcepts.length > 0
  ) {
    lines.push("");

    lines.push("### Key Concepts");

    for (const concept of revision.keyConcepts) {
      lines.push(
        `- **${concept.concept}** _(${concept.importance})_ — ${concept.explanation}`
      );
    }
  }

  if (
    revision.mustRemember.length > 0
  ) {
    lines.push("");

    lines.push("### Must Know");

    for (const item of revision.mustRemember) {
      lines.push(`- ${item}`);
    }
  }

  if (
    revision.commonMistakes.length > 0
  ) {
    lines.push("");

    lines.push(
      "### Common Mistakes"
    );

    for (const mistake of revision.commonMistakes) {
      lines.push(`- ${mistake}`);
    }
  }

  if (
    revision.quickRecall.length > 0
  ) {
    lines.push("");

    lines.push("### Quick Recall");

    for (const item of revision.quickRecall) {
      lines.push("");
      lines.push(
        `**Q:** ${item.prompt}`
      );
      lines.push(
        `**A:** ${item.answer}`
      );
    }
  }

  if (
    revision.likelyQuestions.length >
    0
  ) {
    lines.push("");
    lines.push("");
    lines.push(
      "### Likely Question Types"
    );

    revision.likelyQuestions.forEach(
      (item, index) => {
        lines.push("");
        lines.push(
          `${index + 1}. ${item.question}`
        );
        lines.push(
          `   - ${item.answerOutline}`
        );
      }
    );
  }

  if (
    revision.revisionChecklist.length >
    0
  ) {
    lines.push("");
    lines.push("");
    lines.push(
      "### Final Checklist"
    );

    for (const item of revision.revisionChecklist) {
      lines.push(`- [ ] ${item}`);
    }
  }

  if (revision.examTips.length > 0) {
    lines.push("");
    lines.push("");
    lines.push("### Exam Tips");

    for (const tip of revision.examTips) {
      lines.push(`- ${tip}`);
    }
  }

  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
