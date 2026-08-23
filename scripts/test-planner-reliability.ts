import dotenv from "dotenv";

dotenv.config({
  path: ".env.local",
});

type StudyPlanResult = {
  title: string;

  goal: string;

  durationDays: number | null;

  totalStudyHours: number | null;

  assumptions: string[];

  finalReview: string[];

  tips: string[];

  days: {
    day: number;

    label: string;

    focus: string;

    checkpoint: string | null;

    tasks: {
      task: string;

      minutes: number | null;

      type: string;
    }[];
  }[];
};

const VALID_TASK_TYPES =
  new Set([
    "learn",
    "review",
    "practice",
    "quiz",
    "break",
    "other",
  ]);

type Scenario = {
  name: string;

  request: string;

  expectedDays: number;
};

/*
 * The first scenario is the exact manual
 * reproduction that previously forced the
 * gpt-oss-20b fallback.
 */
const scenarios: Scenario[] = [
  {
    name: "7-day Data Structures",

    request:
      "Make me a 7-day study plan for data structures.",

    expectedDays: 7,
  },
  {
    name: "14-day Python",

    request:
      "Create a detailed 14-day study plan for learning Python from scratch.",

    expectedDays: 14,
  },
  {
    name: "7-day exam revision (algorithms)",

    request:
      "I have an exam next Friday. Make me a 7-day revision plan for algorithms.",

    expectedDays: 7,
  },
];

const ROUNDS = 2;

/*
 * Free-tier Groq TPM budget is small;
 * pacing keeps consecutive plan
 * generations out of each other's
 * rate-limit window.
 */
const PACING_DELAY_MS = 30000;

function sleep(ms: number) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

function validatePlan(
  plan: StudyPlanResult,
  scenario: Scenario
): string[] {
  const problems: string[] = [];

  if (
    !plan.title ||
    typeof plan.title !== "string"
  ) {
    problems.push("title missing");
  }

  if (
    !plan.goal ||
    typeof plan.goal !== "string"
  ) {
    problems.push("goal missing");
  }

  if (
    !Array.isArray(plan.finalReview)
  ) {
    problems.push(
      "finalReview missing (root field omitted)"
    );
  }

  if (!Array.isArray(plan.tips)) {
    problems.push(
      "tips missing (root field omitted)"
    );
  }

  if (
    plan.durationDays !==
    scenario.expectedDays
  ) {
    problems.push(
      `durationDays ${plan.durationDays} !== ${scenario.expectedDays}`
    );
  }

  if (
    !Array.isArray(plan.days) ||
    plan.days.length !==
      scenario.expectedDays
  ) {
    problems.push(
      `days.length ${
        plan.days?.length ?? 0
      } !== ${scenario.expectedDays}`
    );

    return problems;
  }

  plan.days.forEach(
    (day, index) => {
      if (day.day !== index + 1) {
        problems.push(
          `day ${index + 1} numbering broken (got ${day.day})`
        );
      }

      if (!day.label?.trim()) {
        problems.push(
          `day ${index + 1} label empty`
        );
      }

      if (!day.focus?.trim()) {
        problems.push(
          `day ${index + 1} focus empty`
        );
      }

      if (
        day.checkpoint === null ||
        day.checkpoint === undefined ||
        !day.checkpoint.trim()
      ) {
        problems.push(
          `day ${index + 1} checkpoint missing`
        );
      }

      if (
        !Array.isArray(day.tasks) ||
        day.tasks.length < 1
      ) {
        problems.push(
          `day ${index + 1} has no tasks`
        );

        return;
      }

      for (const task of day.tasks) {
        if (
          !VALID_TASK_TYPES.has(
            task.type
          )
        ) {
          problems.push(
            `day ${index + 1} invalid task type "${task.type}"`
          );
        }

        if (
          task.minutes !== null &&
          task.minutes !== undefined &&
          (typeof task.minutes !==
            "number" ||
            task.minutes < 0)
        ) {
          problems.push(
            `day ${index + 1} invalid minutes "${task.minutes}"`
          );
        }
      }
    }
  );

  return problems;
}

async function main() {
  const { generateStudyPlan } =
    await import(
      "../lib/ai/agents/study-planner-agent"
    );

  let failures = 0;

  let fallbackCount = 0;

  let generationCount = 0;

  let totalGenerationMs = 0;

  console.log(
    `\n=== PLANNER STRUCTURED-OUTPUT RELIABILITY TEST (${scenarios.length} scenarios x ${ROUNDS} rounds) ===`
  );

  for (
    let round = 1;
    round <= ROUNDS;
    round += 1
  ) {
    for (const scenario of scenarios) {
      if (generationCount > 0) {
        await sleep(PACING_DELAY_MS);
      }

      generationCount += 1;

      console.log(
        `\n--- Round ${round} | ${scenario.name} ---`
      );

      const metaHolder: {
        value: {
          provider: string;
          model: string;
        } | null;
      } = {
        value: null,
      };

      const startedAt =
        performance.now();

      try {
        const plan =
          await generateStudyPlan(
            {
              request:
                scenario.request,
            },

            {
              onMeta: (value) => {
                metaHolder.value = {
                  provider:
                    value.provider,

                  model: value.model,
                };
              },
            }
          );

        const usedModel =
          metaHolder.value?.model ??
          "unknown";

        const elapsedMs = Math.round(
          performance.now() -
            startedAt
        );

        totalGenerationMs +=
          elapsedMs;

        const problems = validatePlan(
          plan as StudyPlanResult,
          scenario
        );

        const usedFallback =
          !usedModel.includes("120b");

        if (usedFallback) {
          fallbackCount += 1;
        }

        const passed =
          problems.length === 0;

        if (!passed) {
          failures += 1;
        }

        console.log(
          `${passed ? "PASS" : "FAIL"} | ${scenario.name} | model: ${usedModel}${usedFallback ? " (FALLBACK)" : ""} | ${elapsedMs}ms | days: ${plan.days.length} | finalReview: ${plan.finalReview.length} items | tips: ${plan.tips.length} items`
        );

        for (const problem of problems) {
          console.log(
            `     PROBLEM: ${problem}`
          );
        }

        console.log(
          `     Title: ${plan.title} | Day 1 focus: ${plan.days[0]?.focus}`
        );
      } catch (error) {
        failures += 1;

        const elapsedMs = Math.round(
          performance.now() -
            startedAt
        );

        totalGenerationMs +=
          elapsedMs;

        console.log(
          `FAIL | ${scenario.name} | generation threw after ${elapsedMs}ms`
        );

        console.error(error);
      }
    }
  }

  const averageMs =
    generationCount > 0
      ? Math.round(
          totalGenerationMs /
            generationCount
        )
      : 0;

  console.log(
    `\n=== SUMMARY: ${failures === 0 ? "ALL GENERATIONS SCHEMA-COMPLETE" : `${failures} FAILURE(S)`} ===`
  );

  console.log(
    `Generations: ${generationCount} | Fallbacks away from 120B: ${fallbackCount} | Average generation time: ${averageMs}ms`
  );

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);

  process.exit(1);
});
