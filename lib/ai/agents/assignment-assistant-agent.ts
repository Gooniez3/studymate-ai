import { z } from "zod";

import {
  createAIStructuredCompletion,
  type ChatMessage,
} from "@/lib/ai/provider";

export const assignmentRequirementImportanceSchema =
  z.enum([
    "required",

    "recommended",

    "optional",
  ]);

export const assignmentRequirementSchema =
  z.object({
    requirement: z
      .string()
      .min(1)
      .max(240),

    importance:
      assignmentRequirementImportanceSchema,
  });

export const assignmentStructureSectionSchema =
  z.object({
    section: z
      .string()
      .min(1)
      .max(120),

    purpose: z
      .string()
      .min(1)
      .max(300),

    suggestedPoints: z
      .array(z.string().min(1).max(200))
      .max(6),
  });

export const assignmentTaskStepSchema =
  z.object({
    step: z
      .number()
      .int()
      .min(1)
      .max(50),

    title: z
      .string()
      .min(1)
      .max(160),

    description: z
      .string()
      .min(1)
      .max(400),
  });

export const assignmentRubricCriterionSchema =
  z.object({
    criterion: z
      .string()
      .min(1)
      .max(160),

    whatItMeans: z
      .string()
      .min(1)
      .max(300),

    howToAddress: z
      .string()
      .min(1)
      .max(300),
  });

/*
 * Guided-decoding-friendly field order,
 * applying the Planner/Revision lessons:
 *
 * 1. Compact scalars first.
 * 2. All plain-string arrays grouped together
 *    immediately after (avoids string/object
 *    alternation that made models emit drifted
 *    single-key objects).
 * 3. Object arrays close the object, each
 *    size-capped. rubricFocus sits last: it is
 *    legitimately empty whenever no rubric was
 *    supplied, so late truncation costs the
 *    least-critical content first.
 *
 * Every array passes a preprocessing guard:
 * single-key object drift is coerced back to
 * plain strings, and oversized arrays are
 * sliced to the schema cap so one extra item
 * cannot invalidate an entire generation.
 */
const ASSIGNMENT_STRING_ITEM_KEYS = [
  "text",

  "item",

  "point",

  "step",

  "tip",

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

        for (const key of ASSIGNMENT_STRING_ITEM_KEYS) {
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

export const assignmentGuidanceSchema =
  z.object({
    title: z
      .string()
      .min(1)
      .max(160),

    taskType: z
      .string()
      .min(1)
      .max(80),

    objective: z
      .string()
      .min(1)
      .max(500),

    assumptions: z.preprocess(
      (input) =>
        coerceToStringItems(input, 6),

      z
        .array(z.string().min(1).max(240))
        .max(6)
    ),

    draftStrengths: z.preprocess(
      (input) =>
        coerceToStringItems(input, 6),

      z
        .array(z.string().min(1).max(280))
        .max(6)
    ),

    commonMistakes: z.preprocess(
      (input) =>
        coerceToStringItems(input, 8),

      z
        .array(z.string().min(1).max(280))
        .max(8)
    ),

    improvementSuggestions: z.preprocess(
      (input) =>
        coerceToStringItems(input, 10),

      z
        .array(z.string().min(1).max(300))
        .max(10)
    ),

    nextActions: z.preprocess(
      (input) =>
        coerceToStringItems(input, 8),

      z
        .array(z.string().min(1).max(240))
        .max(8)
    ),

    requirements: z.preprocess(
      (input) =>
        limitObjectItems(input, 12),

      z
        .array(
          assignmentRequirementSchema
        )
        .max(12)
    ),

    suggestedStructure: z.preprocess(
      (input) =>
        limitObjectItems(input, 10),

      z
        .array(
          assignmentStructureSectionSchema
        )
        .max(10)
    ),

    taskBreakdown: z.preprocess(
      (input) =>
        limitObjectItems(input, 10),

      z
        .array(
          assignmentTaskStepSchema
        )
        .max(10)
    ),

    rubricFocus: z.preprocess(
      (input) =>
        limitObjectItems(input, 8),

      z
        .array(
          assignmentRubricCriterionSchema
        )
        .max(8)
    ),
  });

export type AssignmentRequirementImportance =
  z.infer<
    typeof assignmentRequirementImportanceSchema
  >;

export type AssignmentGuidanceResult =
  z.infer<
    typeof assignmentGuidanceSchema
  >;

export type GenerateAssignmentGuidanceInput =
  {
    request: string;

    context?: string;

    previousAssignment?:
      | AssignmentGuidanceResult
      | null;

    conversation?: string;
  };

export type GenerateAssignmentGuidanceOptions =
  {
    onMeta?: (meta: {
      provider: string;
      model: string;
    }) => void;
  };

function formatPreviousAssignment(
  previousAssignment: AssignmentGuidanceResult
): string {
  return JSON.stringify(
    previousAssignment,
    null,
    2
  ).slice(0, 10000);
}

/*
 * ============================================================
 * Evidence-fidelity enforcement (deterministic).
 *
 * Prompt instructions alone did not stop smaller
 * fallback models from inventing assignment
 * specifics (observed: 8 fabricated rubric
 * criteria generated against a valedictorian
 * speech). This pass mechanically guarantees
 * the honesty contract AFTER generation:
 *
 * 1. Specifics that require document evidence
 *    (citation styles, word counts, marking
 *    percentages, rubric criteria) are removed
 *    unless the retrieved context actually
 *    contains them.
 * 2. Conversely, specifics that ARE present in
 *    the context are reinforced as required
 *    deliverables if the model failed to carry
 *    them through.
 * 3. When the user references a brief/rubric
 *    but the context shows no such content, an
 *    explicit mismatch note is added to
 *    assumptions.
 *
 * All twelve root keys remain present; nothing
 * optional is introduced.
 * ============================================================
 */
type FidelityContext = {
  hasCtxRubric: boolean;

  hasCtxPercentages: boolean;

  hasCtxCitationStyle: boolean;

  hasCtxWordCount: boolean;

  /*
   * USER-PROVIDED provenance. Specifics the
   * student states in their own current
   * message ("1500-word report", "use
   * Harvard referencing", "due Friday") are
   * first-class facts and must survive the
   * fidelity pass even without document
   * evidence - they are neither model
   * inventions nor document claims.
   */
  hasUserCitationStyle: boolean;

  hasUserWordCount: boolean;

  hasUserPercentage: boolean;

  citationStyleMatch: string | null;

  wordCountMatch: string | null;

  percentageMatch: string | null;

  briefishContext: boolean;
};

function assessFidelity(
  context: string,

  request: string
): FidelityContext {
  const ctx =
    context.toLowerCase();

  const user =
    request.toLowerCase();

  const citationStyleMatch =
    ctx.match(
      /\b(harvard|apa(?:\s*v?\d+)?|mla|ieee|chicago)\b/
    )?.[0] ?? null;

  const wordCountMatch =
    ctx.match(WORD_COUNT_PATTERN)?.[0] ?? null;

  const percentageMatch =
    ctx.match(
      /\d{1,3}(?:\.\d)?\s?%(?:\s*(?:of|weighting|weight))?/
    )?.[0] ?? null;

  return {
    hasCtxRubric:
      /\b(rubrics?|criteria|criterion|marking\s+schemes?|weighting|weighted)\b/.test(
        ctx
      ),

    hasCtxPercentages:
      /\d{1,3}(?:\.\d)?\s?%/.test(ctx),

    hasCtxCitationStyle:
      citationStyleMatch !== null,

    hasCtxWordCount:
      wordCountMatch !== null,

    /*
     * User-provided constraints use kind-level
     * support (any number/style in the user's
     * message authorizes that category) so
     * paraphrases like "1500-word" vs "1500
     * words" both survive.
     */
    hasUserCitationStyle:
      CITATION_STYLE_PATTERN.test(user),

    hasUserWordCount:
      WORD_COUNT_PATTERN.test(user),

    hasUserPercentage:
      PERCENTAGE_PATTERN.test(user),

    citationStyleMatch,

    wordCountMatch,

    percentageMatch,

    briefishContext:
      /\b(assignment|task|deliverables?|submit|submission|deadline|referenc\w*|word(?:\s*count)?|criteri\w*|rubics?|rubrics?|marking|outcomes?)\b/.test(
        ctx
      ),
  };
}

const CITATION_STYLE_PATTERN =
  /\b(harvard|apa(\s*v?\d+)?|mla|ieee|chicago)(\s+(referencing|style|citation))?/i;

/*
 * Matches "1500 words", "1500-word",
 * "1000 to 1500 words" etc.
 */
const WORD_COUNT_PATTERN =
  /(\b\d{2,5}\s*words?\b)|(\b\d{3,5}\s*[-\u2011]\s*word\b)|(\b\d{2,5}\s*(?:to|[-\u2011])\s*\d{2,5}\s*words?\b)/i;

const PERCENTAGE_PATTERN =
  /\d{1,3}(?:\.\d)?\s?%/;

function isUnsupportedSpecific(
  text: string,

  fidelity: FidelityContext
): boolean {
  return (
    (CITATION_STYLE_PATTERN.test(
      text
    ) &&
      !fidelity.hasCtxCitationStyle &&
      !fidelity.hasUserCitationStyle) ||
    (WORD_COUNT_PATTERN.test(text) &&
      !fidelity.hasCtxWordCount &&
      !fidelity.hasUserWordCount) ||
    (PERCENTAGE_PATTERN.test(text) &&
      !fidelity.hasCtxPercentages &&
      !fidelity.hasUserPercentage)
  );
}

/*
 * Removes sentences asserting specifics the
 * context does not support. If every sentence
 * would be removed, falls back to masking the
 * claims so the field stays present but honest.
 */
function scrubUnsupportedSentences(
  text: string,

  fidelity: FidelityContext
): string {
  const hasUnsupported =
    isUnsupportedSpecific(
      text,

      fidelity
    );

  if (!hasUnsupported) {
    return text;
  }

  const sentences =
    text.split(
      /(?<=[.!?])\s+(?=["'(]?[A-Z])/
    );

  const kept = sentences.filter(
    (sentence) =>
      !isUnsupportedSpecific(
        sentence,

        fidelity
      )
  );

  if (
    kept.join(" ").trim().length >
    20
  ) {
    return kept.join(" ").trim();
  }

  return text
    .replace(
      CITATION_STYLE_PATTERN,
      "[referencing style unverified]"
    )
    .replace(
      WORD_COUNT_PATTERN,
      "[length requirement unverified]"
    )
    .replace(
      PERCENTAGE_PATTERN,
      "[weighting unverified]"
    );
}

const ENFORCE_NOTE_GRADING =
  "Exact grading criteria, word count, and referencing style were not found in the retrieved document(s); treat related details as unknown rather than stated.";

const INVENTED_NUMERIC_REQUIREMENT_PATTERN =
  /\b(at\s+least\s+(\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)|(\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(specific|concrete|detailed|clear|distinct))\b/i;

const SPECULATIVE_ASSUMPTION_PATTERN =
  /\b(will\s+submit|lecturer\s+expects?|target\s+audience|deadline|citation\s+style|grading\s+condition|word\s+count|formatting\s+requirement|professor\s+expects?|marker\s+expects?|tutor\s+expects?|assessor\s+expects?)\b/i;

export function enforceEvidenceFidelity(
  guidance: AssignmentGuidanceResult,

  context: string,

  request: string
): AssignmentGuidanceResult {
  const fidelity =
    assessFidelity(context, request);

  let changed = false;

  /*
   * 1. Rubric criteria without rubric evidence
   *    are pure fabrication.
   */
  if (
    !fidelity.hasCtxRubric &&
    !fidelity.hasCtxPercentages &&
    guidance.rubricFocus.length > 0
  ) {
    guidance.rubricFocus = [];

    changed = true;
  }

/*
   * 2. Requirements citing unsupported
   *    specifics are removed.
   */
  guidance.requirements =
    guidance.requirements.filter(
      (requirement) => {
        const keep =
          !isUnsupportedSpecific(
            requirement.requirement,

            fidelity
          );

        if (!keep) {
          changed = true;
        }

        return keep;
      }
    );

  /*
   * 2a. Draft reviews without explicit user
   *     criteria or rubric evidence produce
   *     model-invented requirements.  A bare
   *     "Review this introduction: ..." should
   *     NOT force mandatory review criteria.
   */
  const looksLikeDraftReview =
    /\b(review|feedback|improve|check)\b/i.test(
      request
    );

  const hasExplicitUserCriteria =
    /\b(exactly|specifically|at least|at most|minimum|maximum|must include|must cover|must have|must contain)\b/i.test(
      request
    ) ||
    /\b\d+\s*(strengths?|weaknesses?|points?|suggestions?|areas?|criteria|requirements?)\b/i.test(
      request
    );

  if (
    looksLikeDraftReview &&
    !fidelity.hasCtxRubric &&
    !fidelity.briefishContext &&
    !hasExplicitUserCriteria
  ) {
    for (const requirement of guidance.requirements) {
      if (
        requirement.importance === "required"
      ) {
        requirement.importance = "recommended";
        changed = true;
      }
    }
  }

  /*
   * 2b. Downgrade invented numeric "required"
   *     criteria (e.g. "at least two strengths",
   *     "three specific weaknesses") that have no
   *     user or document provenance.
   */
  for (const requirement of guidance.requirements) {
    if (
      requirement.importance === "required" &&
      INVENTED_NUMERIC_REQUIREMENT_PATTERN.test(
        requirement.requirement
      ) &&
      !fidelity.hasUserWordCount &&
      !fidelity.hasCtxPercentages
    ) {
      requirement.importance = "recommended";
      changed = true;
    }
  }

  /*
   * 3. Sentence-level scrubbing of remaining
   *    fact-bearing fields.
   */
  const scrubbedTitle =
    scrubUnsupportedSentences(
      guidance.title,

      fidelity
    );

  if (scrubbedTitle !== guidance.title) {
    changed = true;

    guidance.title = scrubbedTitle;
  }

  const scrubbedTaskType =
    scrubUnsupportedSentences(
      guidance.taskType,

      fidelity
    );

  if (
    scrubbedTaskType !== guidance.taskType
  ) {
    changed = true;

    guidance.taskType =
      scrubbedTaskType;
  }

  const scrubbedObjective =
    scrubUnsupportedSentences(
      guidance.objective,

      fidelity
    );

  if (
    scrubbedObjective !==
    guidance.objective
  ) {
    changed = true;

    guidance.objective =
      scrubbedObjective;
  }

  const scrubStringArray = (
    items: string[]
  ) =>
    items
      .map((item) =>
        scrubUnsupportedSentences(
          item,

          fidelity
        )
      )
      .filter((item) => item.trim().length > 0);

  const arraysToScrub = [
    "commonMistakes" as const,

    "improvementSuggestions" as const,

    "draftStrengths" as const,

    "nextActions" as const,

    "assumptions" as const,
  ];

for (const key of arraysToScrub) {
    const cleaned =
      scrubStringArray(guidance[key]);

    if (
      cleaned.length !==
        guidance[key].length ||
      cleaned.some(
        (item, index) =>
          item !== guidance[key][index]
      )
    ) {
      changed = true;
    }

    guidance[key] = cleaned;
  }

  /*
   * 3b. Filter out speculative assumptions that
   *     manufacture submission behavior, lecturer
   *     expectations, target audience, deadlines,
   *     citation styles, grading conditions, word
   *     counts, or formatting requirements without
   *     provenance.
   */
  const originalAssumptionsLength =
    guidance.assumptions.length;
  guidance.assumptions = guidance.assumptions.filter(
    (assumption) => {
      const isSpeculative =
        SPECULATIVE_ASSUMPTION_PATTERN.test(
          assumption
        ) &&
        !fidelity.hasUserCitationStyle &&
        !fidelity.hasUserWordCount &&
        !fidelity.hasUserPercentage &&
        !fidelity.hasCtxCitationStyle &&
        !fidelity.hasCtxWordCount &&
        !fidelity.hasCtxPercentages;

      if (isSpeculative) {
        changed = true;
      }

      return !isSpeculative;
    }
  );

  for (const section of guidance.suggestedStructure) {
    const sectionName =
      scrubUnsupportedSentences(
        section.section,

        fidelity
      );

    const purpose =
      scrubUnsupportedSentences(
        section.purpose,

        fidelity
      );

    const points =
      scrubStringArray(
        section.suggestedPoints
      );

    if (
      sectionName !== section.section ||
      purpose !== section.purpose ||
      points.join("|") !==
        section.suggestedPoints.join("|")
    ) {
      changed = true;

      section.section = sectionName;

      section.purpose = purpose;

      section.suggestedPoints = points;
    }
  }

  for (const step of guidance.taskBreakdown) {
    const description =
      scrubUnsupportedSentences(
        step.description,

        fidelity
      );

    const title =
      scrubUnsupportedSentences(
        step.title,

        fidelity
      );

    if (
      description !== step.description ||
      title !== step.title
    ) {
      changed = true;

      step.description = description;

      step.title = title;
    }
  }

  /*
   * 4. Reinforce specifics the context DOES
   *    contain when the model failed to carry
   *    them into requirements.
   */
  const requirementText = guidance.requirements
    .map((requirement) =>
      requirement.requirement.toLowerCase()
    )
    .join(" \n ");

  if (
    fidelity.hasCtxWordCount &&
    fidelity.wordCountMatch &&
    !WORD_COUNT_PATTERN.test(requirementText)
  ) {
    guidance.requirements.push({
      requirement: `Word count: ${fidelity.wordCountMatch} (stated in the uploaded brief)`,

      importance: "required",
    });

    changed = true;
  }

  if (
    fidelity.hasCtxCitationStyle &&
    fidelity.citationStyleMatch &&
    !CITATION_STYLE_PATTERN.test(
      requirementText
    )
  ) {
    guidance.requirements.push({
      requirement: `Referencing style: ${fidelity.citationStyleMatch.replace(
        /^\w/,

        (char) => char.toUpperCase()
      )} (stated in the uploaded brief)`,

      importance: "required",
    });

    changed = true;
  }

  void changed;

  /*
   * 5. Mismatch note when the user expects a
   *    brief/rubric but the context shows none.
   */
  const userExpectsBriefOrRubric =
    /\b(brief|rubric|marking\s+schemes?|assignment\s+(sheet|requirements))\b/i.test(
      request
    );

  if (
    userExpectsBriefOrRubric &&
    context.trim() &&
    !fidelity.briefishContext &&
    !guidance.assumptions.some((assumption) =>
      /does not appear to contain/i.test(
        assumption
      )
    )
  ) {
    guidance.assumptions.unshift(
      "The uploaded document does not appear to contain assignment brief or rubric content - it looks like a different kind of document. Word count, citation style, and marking criteria cannot be determined from it."
    );
  }

  /*
   * 6. Unknown-grading note whenever specifics
   *    were stripped or grading info is absent.
   */
  if (
    (!fidelity.hasCtxRubric &&
      !fidelity.hasCtxPercentages) ||
    changed
  ) {
    const alreadyNoted = guidance.assumptions.some(
      (assumption) =>
        /grading|rubric|criteria|marking/i.test(
          assumption
        )
    );

    if (
      !alreadyNoted &&
      userExpectsBriefOrRubric
    ) {
      guidance.assumptions.push(
        ENFORCE_NOTE_GRADING
      );
    }
  }

  return guidance;
}


/*
 * Structured guidance is a large JSON payload.
 * The ceiling is clamped against a cheap
 * character-based prompt estimate because Groq
 * validates prompt tokens + max_tokens against
 * a per-request budget; when even the minimal
 * ceiling does not fit, max_tokens is omitted
 * and the provider default applies.
 */
/*
 * Measured assignment responses land around
 * 2,000-3,300 characters (~700-1,000 tokens),
 * so the previous 4,500-token ceiling only
 * invited longer generations (and longer
 * latency) without improving quality. 3,000
 * tokens still leaves generous headroom above
 * the observed output size while cutting the
 * model's tendency to pad. All twelve root
 * fields remain required.
 */
const ASSIGNMENT_DESIRED_OUTPUT_TOKENS =
  3000;

const ASSIGNMENT_MIN_OUTPUT_TOKENS = 2048;

const ASSIGNMENT_TOKEN_REQUEST_BUDGET =
  7500;

function resolveAssignmentMaxTokens(
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
    ASSIGNMENT_TOKEN_REQUEST_BUDGET -
    estimatedPromptTokens;

  if (
    allowance <
    ASSIGNMENT_MIN_OUTPUT_TOKENS
  ) {
    return undefined;
  }

  return Math.min(
    ASSIGNMENT_DESIRED_OUTPUT_TOKENS,
    allowance
  );
}

export async function generateAssignmentGuidance(
  {
    request,
    context = "",
    previousAssignment = null,
    conversation = "",
  }: GenerateAssignmentGuidanceInput,

  options?: GenerateAssignmentGuidanceOptions
): Promise<AssignmentGuidanceResult> {
  const hasContext =
    context.trim().length > 0;

  const hasPreviousAssignment =
    previousAssignment !== null &&
    previousAssignment !== undefined;

  const looksLikeDraftReview =
    /\b(review|feedback|improve|check)\b/i.test(
      request
    );

  const wantsDetail =
    /\b(detail|detailed|comprehensive|in[- ]depth|thorough|extensive|full|elaborate|complete)\b/i.test(
      request
    );

  const wantsConcise =
    /\b(concise|short|brief|simple|quick|compact|minimal|shorter)\b/i.test(
      request
    );

  const detailRule = wantsDetail
    ? "- The user asked for detailed guidance. Cover more requirements, fuller breakdown steps, and richer structure points."
    : wantsConcise
      ? "- The user asked for concise guidance. Keep lists tight and descriptions short."
      : "- Default to focused, moderately sized guidance. Avoid padding.";

  const draftRule = looksLikeDraftReview
    ? `- The user supplied or referenced their own draft text. Structure feedback as:
  * draftStrengths: specific things done well
  * improvementSuggestions: concrete, actionable fixes (clarity, relevance, structure, academic tone, alignment to the task)
  * Distinguish critique from optional rewrites - do NOT silently rewrite whole sections unless explicitly asked.`
    : `- This is primarily interpretation/planning help rather than draft review. Keep draftStrengths empty ([]).`;

  const messages:
    ChatMessage[] = [
    {
      role: "system",
      content: `
You are the Assignment Assistant for StudyMate AI.

Help the student UNDERSTAND and IMPROVE their assignment work: interpret the task, break it down, plan structure, interpret rubrics, review drafts, and guide next steps.

INTEGRITY RULES:
- Support learning. Do not silently produce a complete finished submission the student could submit as-is.
- Extract requirements ONLY from supplied context (assignment brief, rubric, task sheet). Never invent deliverables, deadlines, word counts, or grading criteria.
- If no rubric/brief evidence is supplied for grading questions, leave rubricFocus as [] and say in assumptions that exact grading criteria require the official rubric or brief.
- For draft reviews (reviewing pasted text), do not invent mandatory review criteria such as "identify exactly 2 strengths", "provide 3 weaknesses", or "concrete suggestions required". Only include requirements the user explicitly stated or that are grounded in a supplied rubric.
- Do not fabricate assumptions about submission behavior ("will submit"), lecturer expectations, target audience, deadlines, citation styles, word counts, or formatting requirements unless supported by user input or grounded evidence. An empty assumptions array is acceptable.

INTERPRETATION RULES:
- Pay attention to directive verbs (analyze, evaluate, compare, design, discuss, explain) and reflect what they demand.
- requirements should capture deliverables, constraints, scope, and format expectations with importance tags ("required", "recommended", "optional").
- suggestedStructure sections must each have a clear purpose plus concrete points to cover.
- taskBreakdown gives an ordered way to start and finish the work.
- If the user mentions a word count, scale structure advice to it; otherwise make a sensible assumption and label it in assumptions.

DRAFT REVIEW RULES:
${draftRule}

MODIFICATION RULES:
${
  hasPreviousAssignment
    ? `- A previous version of this guidance is supplied below. Apply ONLY the requested change(s) while keeping everything else consistent.
- If the request clearly concerns a different assignment, produce fresh guidance instead.
- If asked to remove or add sections/steps, actually change the output.`
    : `- No previous guidance exists; create fresh guidance.`
}

DETAIL:
${detailRule}

GROUNDING:
${
  hasContext
    ? `Use ONLY the supplied study context for document-specific claims: task requirements, deliverables, rubric criteria, deadlines, and scope.

DOCUMENT-TYPE HONESTY (critical):
- The user may CALL an uploaded document an assignment brief or rubric, but the retrieved evidence is authoritative. First determine from the context what the document ACTUALLY is.
- If the context is not an assignment brief, task sheet, or rubric (for example it is a speech, story, article, or unrelated notes), say so plainly in objective or assumptions - e.g. "The uploaded document appears to be X rather than an assignment brief" - and do NOT extract any requirements from it. Instead offer general help clearly labeled as suggestion.

EVIDENCE FIDELITY:
- Treat word counts, citation/reference styles, deadlines, required sections, marking percentages, rubric criteria, learning outcomes, and formatting rules as REQUIREMENTS only when they are explicitly stated in the context itself.
- If the user asserts such a detail but the context does not contain it, move it to assumptions with explicit wording such as "Assumed ... - not stated in the uploaded document".
- Never invent these details to fill gaps. Never present general suggestions as document-backed facts.
Every rubricFocus criterion MUST be supported by the context; if no criteria exist in the context, leave rubricFocus as [].
You may use general subject knowledge only to explain concepts, never to invent course-specific requirements.`
    : `No document context was supplied.
Use stable general knowledge about the stated task type.
Do not reference any uploaded files.
Do NOT invent: word counts, citation/reference styles, deadlines, required sections, marking percentages, rubric criteria, learning outcomes, or formatting rules. Unknown specifics belong in assumptions as clearly labeled assumptions.`
}
${
  conversation.trim()
    ? `
RECENT CONVERSATION:
You may use it to resolve references such as "it", "that", the assignment topic, or earlier feedback.`
    : ""
}

OUTPUT:
Return structured data only, matching the schema exactly.
The JSON object MUST always include ALL twelve top-level keys, in this order: title, taskType, objective, assumptions, draftStrengths, commonMistakes, improvementSuggestions, nextActions, requirements, suggestedStructure, taskBreakdown, rubricFocus.
Never omit any root key. Use [] when a list does not apply.
assumptions/draftStrengths/commonMistakes/improvementSuggestions/nextActions are arrays of PLAIN STRINGS - never arrays of objects.
Every requirement needs requirement and importance ("required" | "recommended" | "optional").
Every suggestedStructure entry needs section, purpose, suggestedPoints. Every taskBreakdown entry needs step, title, description. Every rubricFocus entry needs criterion, whatItMeans, howToAddress.
Keep individual strings short so all twelve keys are emitted completely.
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

  if (hasPreviousAssignment) {
    messages.push({
      role: "user",

      content: `
PREVIOUS GUIDANCE TO MODIFY:
${formatPreviousAssignment(previousAssignment)}
      `.trim(),
    });
  }

  messages.push({
    role: "user",

    content: `
ASSIGNMENT CONTEXT:
${context || "None"}

REQUEST:
Create or update the assignment guidance for this request:

${request}

FINAL REMINDER:
The JSON output MUST contain all twelve top-level keys: title, taskType, objective, assumptions, draftStrengths, commonMistakes, improvementSuggestions, nextActions, requirements, suggestedStructure, taskBreakdown, rubricFocus. assumptions/draftStrengths/commonMistakes/improvementSuggestions/nextActions contain plain strings only - never objects. Use [] if a list does not apply. Keep strings short so nothing is truncated.
    `.trim(),
  });

  const generationStartedAt =
    performance.now();

  try {
    const result =
      await createAIStructuredCompletion(
        messages,
        assignmentGuidanceSchema,
        "studymate_assignment_guidance",

        {
          modelRole: "balanced",

          maxTokens:
            resolveAssignmentMaxTokens(
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
      `[perf] assignment generation: ${Math.round(
        performance.now() -
          generationStartedAt
      )}ms`
    );

    /*
     * Deterministic honesty enforcement runs on
     * every provider's output before it is
     * returned - the schema guarantees shape,
     * this pass guarantees evidence fidelity.
     */
    return enforceEvidenceFidelity(
      result.data,
      context,
      request
    );
  } catch (error) {
    console.error(
      `[perf] assignment generation failed after ${Math.round(
        performance.now() -
          generationStartedAt
      )}ms`,
      error
    );

    throw error;
  }
}

/*
 * Renders structured guidance as clean
 * Markdown for the existing chat UI. A future
 * interactive assignment card can read
 * assignmentData from graph state instead.
 */
const INTERNAL_FIDELITY_MARKER_PATTERN =
  /(?:≈)?\[(?:length|citation|referencing|deadline|weighting|percentage)\s+(?:requirement\s+)?unverified\]|(?:≈)?\[(?:citation|referencing)\s+style\s+unverified\]|≈\[[^\]]*\]/gi;

function sanitizeInternalMarkers(text: string): string {
  return text
    .replace(INTERNAL_FIDELITY_MARKER_PATTERN, "")
    .replace(/\[[^\]]*\bunverified\b[^\]]*\]/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function renderAssignmentMarkdown(
  guidance: AssignmentGuidanceResult
): string {
  const lines: string[] = [];

  const isDraftReview =
    /draft\s*review|review\s*draft|feedback/i.test(guidance.taskType);

  const isStructureHelp =
    /structure|outline|breakdown|organi[sz]e/i.test(guidance.taskType);

const isRubricAnalysis =
    /rubric/i.test(guidance.taskType);

  lines.push(`## ${sanitizeInternalMarkers(guidance.title)}`);

  lines.push("");

  lines.push(sanitizeInternalMarkers(guidance.objective));

  if (
    guidance.assumptions.length > 0
  ) {
    lines.push("");

    lines.push("**Assumptions**");

    for (const assumption of guidance.assumptions) {
      lines.push(`- ${sanitizeInternalMarkers(assumption)}`);
    }
  }

  if (isDraftReview) {
    if (
      guidance.draftStrengths.length > 0
    ) {
      lines.push("");
      lines.push("### Strengths");

      for (const strength of guidance.draftStrengths) {
        lines.push(`- ${sanitizeInternalMarkers(strength)}`);
      }
    }

    if (
      guidance.improvementSuggestions.length >
      0
    ) {
      lines.push("");
      lines.push("### Areas to Improve");

      for (const suggestion of guidance.improvementSuggestions) {
        lines.push(`- ${sanitizeInternalMarkers(suggestion)}`);
      }
    }

    if (
      guidance.commonMistakes.length > 0
    ) {
      lines.push("");
      lines.push("### Common Mistakes");

      for (const mistake of guidance.commonMistakes) {
        lines.push(`- ${sanitizeInternalMarkers(mistake)}`);
      }
    }

    if (
      guidance.nextActions.length > 0
    ) {
      lines.push("");
      lines.push("### Next Steps");

      guidance.nextActions.forEach(
        (action, index) => {
          lines.push(
            `${index + 1}. ${sanitizeInternalMarkers(action)}`
          );
        }
      );
    }
  } else if (isStructureHelp) {
    if (
      guidance.requirements.length > 0
    ) {
      lines.push("");

      lines.push("### Requirements");

      for (const requirement of guidance.requirements) {
        lines.push(
          `- **${sanitizeInternalMarkers(requirement.requirement)}** _(${requirement.importance})_`
        );
      }
    }

    if (
      guidance.suggestedStructure.length >
      0
    ) {
      lines.push("");

      lines.push("### Suggested Structure");

      guidance.suggestedStructure.forEach(
        (section, index) => {
          lines.push("");
          lines.push(
            `${index + 1}. **${sanitizeInternalMarkers(section.section)}**  —  ${sanitizeInternalMarkers(section.purpose)}`
          );

          for (const point of section.suggestedPoints) {
            lines.push(
              `   - ${sanitizeInternalMarkers(point)}`
            );
          }
        }
      );
    }

    if (
      guidance.taskBreakdown.length > 0
    ) {
      lines.push("");
      lines.push("");
      lines.push(
        "### Task Breakdown"
      );

      for (const step of guidance.taskBreakdown) {
        lines.push("");
        lines.push(
          `${step.step}. **${sanitizeInternalMarkers(step.title)}**  —  ${sanitizeInternalMarkers(step.description)}`
        );
      }
    }

    if (
      guidance.nextActions.length > 0
    ) {
      lines.push("");
      lines.push("### Next Steps");

      guidance.nextActions.forEach(
        (action, index) => {
          lines.push(
            `${index + 1}. ${sanitizeInternalMarkers(action)}`
          );
        }
      );
    }
  } else if (isRubricAnalysis) {
    if (
      guidance.rubricFocus.length > 0
    ) {
      lines.push("");
      lines.push("");
      lines.push(
        "### Rubric Focus"
      );

      for (const criterion of guidance.rubricFocus) {
        lines.push("");
        lines.push(
          `- **${sanitizeInternalMarkers(criterion.criterion)}**  —  ${sanitizeInternalMarkers(criterion.whatItMeans)}`
        );
        lines.push(
          `  _How to address:_ ${sanitizeInternalMarkers(criterion.howToAddress)}`
        );
      }
    }

    if (
      guidance.requirements.length > 0
    ) {
      lines.push("");

      lines.push("### Requirements");

      for (const requirement of guidance.requirements) {
        lines.push(
          `- **${sanitizeInternalMarkers(requirement.requirement)}** _(${requirement.importance})_`
        );
      }
    }

    if (
      guidance.nextActions.length > 0
    ) {
      lines.push("");
      lines.push("### Next Steps");

      guidance.nextActions.forEach(
        (action, index) => {
          lines.push(
            `${index + 1}. ${sanitizeInternalMarkers(action)}`
          );
        }
      );
    }
  } else {
    if (
      guidance.requirements.length > 0
    ) {
      lines.push("");

      lines.push("### Requirements");

      for (const requirement of guidance.requirements) {
        lines.push(
          `- **${sanitizeInternalMarkers(requirement.requirement)}** _(${requirement.importance})_`
        );
      }
    }

    if (
      guidance.suggestedStructure.length >
      0
    ) {
      lines.push("");

      lines.push("### Suggested Structure");

      guidance.suggestedStructure.forEach(
        (section, index) => {
          lines.push("");
          lines.push(
            `${index + 1}. **${sanitizeInternalMarkers(section.section)}**  —  ${sanitizeInternalMarkers(section.purpose)}`
          );

          for (const point of section.suggestedPoints) {
            lines.push(
              `   - ${sanitizeInternalMarkers(point)}`
            );
          }
        }
      );
    }

    if (
      guidance.taskBreakdown.length > 0
    ) {
      lines.push("");
      lines.push("");
      lines.push(
        "### Task Breakdown"
      );

      for (const step of guidance.taskBreakdown) {
        lines.push("");
        lines.push(
          `${step.step}. **${sanitizeInternalMarkers(step.title)}**  —  ${sanitizeInternalMarkers(step.description)}`
        );
      }
    }

    if (
      guidance.rubricFocus.length > 0
    ) {
      lines.push("");
      lines.push("");
      lines.push(
        "### Rubric Focus"
      );

      for (const criterion of guidance.rubricFocus) {
        lines.push("");
        lines.push(
          `- **${sanitizeInternalMarkers(criterion.criterion)}**  —  ${sanitizeInternalMarkers(criterion.whatItMeans)}`
        );
        lines.push(
          `  _How to address:_ ${sanitizeInternalMarkers(criterion.howToAddress)}`
        );
      }
    }

    if (
      guidance.commonMistakes.length > 0
    ) {
      lines.push("");
      lines.push("");
      lines.push(
        "### Common Mistakes"
      );

      for (const mistake of guidance.commonMistakes) {
        lines.push(`- ${sanitizeInternalMarkers(mistake)}`);
      }
    }

    if (
      guidance.draftStrengths.length > 0
    ) {
      lines.push("");
      lines.push("");
      lines.push(
        "### Draft Strengths"
      );

      for (const strength of guidance.draftStrengths) {
        lines.push(`- ${sanitizeInternalMarkers(strength)}`);
      }
    }

    if (
      guidance.improvementSuggestions.length >
      0
    ) {
      lines.push("");
      lines.push("");
      lines.push(
        "### Improvements"
      );

      for (const suggestion of guidance.improvementSuggestions) {
        lines.push(`- ${sanitizeInternalMarkers(suggestion)}`);
      }
    }

    if (
      guidance.nextActions.length > 0
    ) {
      lines.push("");
      lines.push("");
      lines.push("### Next Steps");

      guidance.nextActions.forEach(
        (action, index) => {
          lines.push(
            `${index + 1}. ${sanitizeInternalMarkers(action)}`
          );
        }
      );
    }
  }

  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
