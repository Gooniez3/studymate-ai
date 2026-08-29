import dotenv from "dotenv";

dotenv.config({
  path: ".env.local",
});

import { z } from "zod";

type GroqCall = Record<string, unknown>;

function makeGroqCompletion(
  content: string
) {
  return {
    choices: [
      {
        message: { content },
      },
    ],
  };
}

function httpError(
  status: number,
  message: string,
  code?: string
) {
  const error = new Error(
    `${status} ${message}${code ? ` [${code}]` : ""}`
  );

  Object.assign(error, {
    status,

    ...(code ? { code } : {}),
  });

  return error;
}

function fakeFetchResponse(
  body: unknown,

  ok = true,

  status = 200
): Response {
  return {
    ok,

    status,

    json: async () => body,
  } as unknown as Response;
}

type TestChatMessage = {
  role: "user" | "assistant" | "system";

  content: string;
};

const BASE_MESSAGES: TestChatMessage[] = [
  {
    role: "system",

    content: "You are a test assistant.",
  },

  {
    role: "user",

    content:
      "Reply with the word OK only.",
  },
];

async function main() {
  /*
   * Imported dynamically AFTER dotenv.config so
   * provider module initialization sees the
   * configured environment.
   */
  const {
    createAICompletion,

    createAIStructuredCompletion,

    classifyProviderError,

    _providerTestHooks,

    _testResetProviderCooldowns,
  } = await import("../lib/ai/provider");

  let failures = 0;

  function report(
    passed: boolean,
    name: string,
    detail: string
  ) {
    if (!passed) {
      failures += 1;
    }

    console.log(
      `\n${passed ? "PASS" : "FAIL"} | ${name}`
    );

    console.log(`  ${detail}`);
  }

  /*
   * All tests run fully mocked via
   * _providerTestHooks - no real provider
   * requests are made and no quota is used.
   */
  delete process.env.AI_PROVIDER;

  function resetHooks() {
    _providerTestHooks.groqCreate =
      null;

    _providerTestHooks.geminiGenerate =
      null;

    _providerTestHooks.geminiGenerateStream =
      null;

    _providerTestHooks.openRouterFetch =
      null;

    _providerTestHooks.cooldownMs = null;

    _providerTestHooks.roleTimeoutMs =
      null;

    _testResetProviderCooldowns();
  }

  console.log(
    "\n=== PROVIDER FALLBACK TESTS (mocked, no quota) ==="
  );

  /*
   * ------------------------------------------------------------
   * A. Primary Groq success
   * ------------------------------------------------------------
   */
  {
    const groqCalls: GroqCall[] = [];

    resetHooks();

    _providerTestHooks.groqCreate =
      async (args) => {
        groqCalls.push(args);

        return makeGroqCompletion(
          "OK"
        );
      };

    const result =
      await createAICompletion(
        BASE_MESSAGES,

        { maxTokens: 10 }
      );

    report(
      result.provider === "groq" &&
        result.model ===
          "openai/gpt-oss-120b" &&
        result.content === "OK" &&
        groqCalls.length === 1,
      "A. Primary Groq success",

      `provider=${result.provider} model=${result.model} content=${result.content} groqCalls=${groqCalls.length}`
    );
  }

  /*
   * ------------------------------------------------------------
   * B. Groq 120b rate limited -> falls back to Groq 20b
   * ------------------------------------------------------------
   */
  {
    const attemptedModels: string[] =
      [];

    resetHooks();

    _providerTestHooks.groqCreate =
      async (args) => {
        attemptedModels.push(
          args.model as string
        );

        if (
          attemptedModels.length ===
          1
        ) {
          throw httpError(
            429,
            "rate limit exceeded",
            "rate_limit_exceeded"
          );
        }

        return makeGroqCompletion(
          "OK from 20b"
        );
      };

    const result =
      await createAICompletion(
        BASE_MESSAGES,

        { maxTokens: 10 }
      );

    report(
      result.model ===
        "openai/gpt-oss-20b" &&
        result.content ===
          "OK from 20b" &&
        attemptedModels.join(",") ===
          "openai/gpt-oss-120b,openai/gpt-oss-20b",
      "B. Groq 120b 429 -> Groq 20b",

      `chain=${attemptedModels.join(" -> ")} final=${result.model}`
    );
  }

  /*
   * ------------------------------------------------------------
   * C. All Groq models unavailable -> Gemini strong model
   * ------------------------------------------------------------
   */
  {
    resetHooks();

    let geminiCalls = 0;

    let openRouterCalls = 0;

    _providerTestHooks.groqCreate =
      async () => {
        throw httpError(
          429,
          "rate limit",
          "rate_limit_exceeded"
        );
      };

    _providerTestHooks.geminiGenerate =
      async () => {
        geminiCalls += 1;

        return {
          text: "Gemini answer",
        };
      };

    _providerTestHooks.openRouterFetch =
      async () => {
        openRouterCalls += 1;

        throw new Error(
          "should not be called"
        );
      };

    const result =
      await createAICompletion(
        BASE_MESSAGES,

        { maxTokens: 10 }
      );

    report(
      result.provider === "gemini" &&
        result.model ===
          "gemini-2.5-flash" &&
        result.content ===
          "Gemini answer" &&
        geminiCalls === 1 &&
        openRouterCalls === 0,
      "C. Groq unavailable -> Gemini",

      `provider=${result.provider} model=${result.model} geminiCalls=${geminiCalls} openRouterCalls=${openRouterCalls}`
    );
  }

  /*
   * ------------------------------------------------------------
   * D. Gemini failure -> OpenRouter last resort
   * ------------------------------------------------------------
   */
  {
    resetHooks();

    _providerTestHooks.groqCreate =
      async () => {
        throw httpError(
          429,
          "rate limit",
          "rate_limit_exceeded"
        );
      };

    _providerTestHooks.geminiGenerate =
      async () => {
        throw httpError(
          503,
          "UNAVAILABLE service overloaded"
        );
      };

    _providerTestHooks.openRouterFetch =
      async (_url, init) => {
        const body = JSON.parse(
          String(init.body)
        );

        if (
          body.model !==
          "nvidia/nemotron-3-super-120b-a12b:free"
        ) {
          throw new Error(
            `unexpected openrouter model ${body.model}`
          );
        }

        return fakeFetchResponse({
          choices: [
            {
              message: {
                content:
                  "OpenRouter answer",
              },
            },
          ],
        });
      };

    const result =
      await createAICompletion(
        BASE_MESSAGES,

        { maxTokens: 10 }
      );

    report(
      result.provider ===
        "openrouter" &&
        result.model ===
          "nvidia/nemotron-3-super-120b-a12b:free" &&
        result.content ===
          "OpenRouter answer",
      "D. Gemini failure -> OpenRouter",

      `provider=${result.provider} model=${result.model} content=${result.content}`
    );
  }

  /*
   * ------------------------------------------------------------
   * E. Non-retryable 400 does NOT cascade
   * ------------------------------------------------------------
   */
  {
    const groqCalls: GroqCall[] = [];

    resetHooks();

    _providerTestHooks.groqCreate =
      async (args) => {
        groqCalls.push(args);

        throw httpError(
          400,
          "Invalid 'messages': array too short"
        );
      };

    _providerTestHooks.geminiGenerate =
      async () => {
        throw new Error(
          "gemini must not be called on fatal error"
        );
      };

    _providerTestHooks.openRouterFetch =
      async () => {
        throw new Error(
          "openrouter must not be called on fatal error"
        );
      };

    let threw = false;

    try {
      await createAICompletion(
        BASE_MESSAGES,

        { maxTokens: 10 }
      );
    } catch {
      threw = true;
    }

    report(
      threw && groqCalls.length === 1,
      "E. Non-retryable 400 does NOT cascade",

      `threw=${threw} attempts=${groqCalls.length} (expected exactly 1)`
    );
  }

  /*
   * ------------------------------------------------------------
   * F. Structured output survives fallback
   * ------------------------------------------------------------
   */
  {
    const quizSchema = z.object({
      title: z.string().min(1),

      questions: z
        .array(z.string())
        .min(1)
        .max(3),
    });

    const validQuiz = JSON.stringify({
      title: "Recursion Quiz",

      questions: [
        "Base case?",
        "Stack overflow?",
      ],
    });

    const attemptedModels: string[] =
      [];

    resetHooks();

    _providerTestHooks.groqCreate =
      async (args) => {
        attemptedModels.push(
          args.model as string
        );

        if (
          attemptedModels.length <
          2
        ) {
          throw httpError(
            429,
            "rate limit",
            "rate_limit_exceeded"
          );
        }

        return makeGroqCompletion(
          validQuiz
        );
      };

    const result =
      await createAIStructuredCompletion(
        BASE_MESSAGES,

        quizSchema,

        "test_quiz_schema"
      );

    const structuredValid =
      quizSchema.safeParse(result.data)
        .success;

    report(
      result.provider === "groq" &&
        result.model ===
          "openai/gpt-oss-20b" &&
        structuredValid &&
        result.data.title ===
          "Recursion Quiz",
      "F. Structured output survives fallback (Zod-validated)",

      `provider=${result.provider} model=${result.model} title=${result.data.title} chain=${attemptedModels.join(" -> ")}`
    );
  }

  /*
   * ------------------------------------------------------------
   * G. Zod validation rejects malformed structured output
   * ------------------------------------------------------------
   */
  {
    const strictSchema = z.object({
      title: z.string().min(1),

      requiredField: z
        .string()
        .min(1),
    });

    const malformed = JSON.stringify({
      title: "Missing required field",
    });

    const attemptedProviders: string[] =
      [];

    resetHooks();

    _providerTestHooks.groqCreate =
      async (args) => {
        attemptedProviders.push(
          `groq:${args.model}`
        );

        return makeGroqCompletion(
          malformed
        );
      };

    _providerTestHooks.geminiGenerate =
      async (model) => {
        attemptedProviders.push(
          `gemini:${model}`
        );

        return { text: malformed };
      };

    _providerTestHooks.openRouterFetch =
      async () => {
        attemptedProviders.push(
          "openrouter"
        );

        return fakeFetchResponse({
          choices: [
            {
              message: {
                content: malformed,
              },
            },
          ],
        });
      };

    let threw = false;

    let errorName = "";

    try {
      await createAIStructuredCompletion(
        BASE_MESSAGES,

        strictSchema,

        "test_strict_schema"
      );
    } catch (error) {
      threw = true;

      errorName =
        error instanceof Error
          ? error.name
          : "unknown";
    }

    report(
      threw &&
        attemptedProviders.length ===
          5 &&
        (errorName === "ZodError" ||
          errorName === "Error"),
      "G. Zod validation still rejects malformed output (never accepted)",

      `threw=${threw} error=${errorName} attempts=${attemptedProviders.length}: ${attemptedProviders.join(", ")}`
    );
  }

  /*
   * ------------------------------------------------------------
   * H. Streaming failure BEFORE first token falls back
   * ------------------------------------------------------------
   */
  {
    const tokens: string[] = [];

    let geminiStreamCalls = 0;

    resetHooks();

    _providerTestHooks.groqCreate =
      async () => {
        throw httpError(
          429,
          "rate limit",
          "rate_limit_exceeded"
        );
      };

    _providerTestHooks.geminiGenerateStream =
      async function* () {
        geminiStreamCalls += 1;

        yield { text: "Hello" };

        yield { text: " world" };
      };

    const result =
      await createAICompletion(
        BASE_MESSAGES,

        {
          maxTokens: 20,

          onToken: (delta) =>
            tokens.push(delta),
        }
      );

    report(
      result.provider === "gemini" &&
        result.content ===
          "Hello world" &&
        tokens.join("") ===
          "Hello world" &&
        geminiStreamCalls === 1,
      "H. Stream failure before first token falls back to next provider",

      `provider=${result.provider} content="${result.content}" tokens=${tokens.length}`
    );
  }

  /*
   * ------------------------------------------------------------
   * I. Streaming failure AFTER first token does NOT restart
   * ------------------------------------------------------------
   */
  {
    const tokens: string[] = [];

    let geminiStreamCalls = 0;

    resetHooks();

    _providerTestHooks.groqCreate =
      async (args) => {
        if (args.stream) {
          return (async function* () {
            yield makeGroqChunk("Hel");

            yield makeGroqChunk("lo");

            throw httpError(
              500,
              "stream interrupted"
            );
          })() as never;
        }

        return makeGroqCompletion(
          "should not be reached"
        );
      };

    _providerTestHooks.geminiGenerateStream =
      async function* () {
        geminiStreamCalls += 1;

        yield { text: "SHOULD NOT APPEAR" };
      };

    function makeGroqChunk(text: string) {
      return {
        choices: [
          {
            delta: { content: text },
          },
        ],
      };
    }

    const result =
      await createAICompletion(
        BASE_MESSAGES,

        {
          maxTokens: 20,

          onToken: (delta) =>
            tokens.push(delta),
        }
      );

    const duplicated =
      result.content.includes(
        "SHOULD NOT APPEAR"
      ) ||
      geminiStreamCalls > 0;

    report(
      result.provider === "groq" &&
        result.model ===
          "openai/gpt-oss-120b" &&
        result.content === "Hello" &&
        !duplicated &&
        tokens.join("") === "Hello",
      "I. Stream failure after first token preserves partial answer (no restart)",

      `provider=${result.provider} partial="${result.content}" geminiCalled=${geminiStreamCalls}`
    );
  }

  /*
   * ------------------------------------------------------------
   * J. Fast-model chain uses its correct models
   * ------------------------------------------------------------
   */
  {
    const attempted: string[] = [];

    resetHooks();

    _providerTestHooks.groqCreate =
      async (args) => {
        attempted.push(
          `groq:${args.model}`
        );

        throw httpError(
          429,
          "rate limit",
          "rate_limit_exceeded"
        );
      };

    _providerTestHooks.geminiGenerate =
      async (model) => {
        attempted.push(
          `gemini:${model}`
        );

        return { text: "fast ok" };
      };

    const result =
      await createAICompletion(
        BASE_MESSAGES,

        {
          maxTokens: 10,

          preferFastModel: true,
        }
      );

    const expectedChain =
      "groq:openai/gpt-oss-20b,gemini:gemini-3.1-flash-lite";

    report(
      attempted.join(",") ===
        expectedChain &&
        result.provider === "gemini",
      "J. Fast chain uses correct models",

      `chain=${attempted.join(" -> ")}`
    );
  }

  /*
   * ------------------------------------------------------------
   * K. Strong-model chain uses its exact five-attempt order
   * ------------------------------------------------------------
   */
  {
    const attempted: string[] = [];

    resetHooks();

    _providerTestHooks.groqCreate =
      async (args) => {
        attempted.push(
          `groq:${args.model}`
        );

        throw httpError(
          429,
          "rate limit",
          "rate_limit_exceeded"
        );
      };

    _providerTestHooks.geminiGenerate =
      async (model) => {
        attempted.push(
          `gemini:${model}`
        );

        throw httpError(
          503,
          "UNAVAILABLE"
        );
      };

    _providerTestHooks.openRouterFetch =
      async () => {
        attempted.push(
          "openrouter:nvidia/nemotron-3-super-120b-a12b:free"
        );

        return fakeFetchResponse(
          {
            error: {
              message: "upstream error",
            },
          },

          false,

          502
        );
      };

    let threw = false;

    try {
      await createAICompletion(
        BASE_MESSAGES,

        { maxTokens: 10 }
      );
    } catch {
      threw = true;
    }

    const expectedChain =
      "groq:openai/gpt-oss-120b,groq:openai/gpt-oss-20b,gemini:gemini-2.5-flash,gemini:gemini-3.1-flash-lite,openrouter:nvidia/nemotron-3-super-120b-a12b:free";

    report(
      threw &&
        attempted.join(",") ===
          expectedChain,
      "K. Strong chain uses its exact ordered attempt list then fails honestly",

      `threw=${threw} chain=${attempted.join(" -> ")}`
    );
  }

  /*
   * ------------------------------------------------------------
   * L (bonus). Missing optional provider credentials are skipped
   * ------------------------------------------------------------
   */
  {
    const attempted: string[] = [];

    const geminiKey =
      process.env.GEMINI_API_KEY;

    const openRouterKey =
      process.env.OPENROUTER_API_KEY;

    try {
      delete process.env.GEMINI_API_KEY;

      delete process.env
        .OPENROUTER_API_KEY;

      resetHooks();

      _providerTestHooks.groqCreate =
        async (args) => {
          attempted.push(
            `groq:${args.model}`
          );

          if (
            attempted.length >= 2
          ) {
            return makeGroqCompletion(
              "recovered on 20b"
            );
          }

          throw httpError(
            429,
            "rate limit",
            "rate_limit_exceeded"
          );
        };

      _providerTestHooks.geminiGenerate =
        async () => {
          attempted.push(
            "gemini:SHOULD-NOT-BE-CALLED"
          );

          return { text: "" };
        };

      const result =
        await createAICompletion(
          BASE_MESSAGES,

          { maxTokens: 10 }
        );

      report(
        result.model ===
          "openai/gpt-oss-20b" &&
          !attempted.some((entry) =>
            entry.startsWith(
              "gemini:"
            )
          ),
        "L. Unconfigured providers are skipped without breaking the chain",

        `final=${result.model} attempts=${attempted.join(" -> ")}`
      );
    } finally {
      process.env.GEMINI_API_KEY =
        geminiKey;

      process.env.OPENROUTER_API_KEY =
        openRouterKey;
    }
  }

  /*
   * ------------------------------------------------------------
   * M (bonus). Error classification unit checks
   * ------------------------------------------------------------
   */
  {
    const cases: {
      name: string;

      error: unknown;

      retryable: boolean;

      reason: string;
    }[] = [
      {
        name: "429 -> rate_limit",

        error: httpError(
          429,
          "limit",
          "rate_limit_exceeded"
        ),

        retryable: true,

        reason: "rate_limit",
      },
      {
        name: "401 -> auth (fatal)",

        error: httpError(401, "invalid api key"),

        retryable: false,

        reason: "auth",
      },
      {
        name: "plain 400 -> fatal",

        error: httpError(
          400,
          "malformed request"
        ),

        retryable: false,

        reason: "http_400",
      },
      {
        name: "json_validate_failed 400 -> retryable output_schema",

        error: httpError(
          400,
          "Generated JSON does not match the expected schema",
          "json_validate_failed"
        ),

        retryable: true,

        reason: "output_schema",
      },
      {
        name: "503 -> server_error",

        error: httpError(503, "overloaded"),

        retryable: true,

        reason: "server_error",
      },
      {
        name: "fetch failed -> network",

        error: new TypeError(
          "fetch failed"
        ),

        retryable: true,

        reason: "network",
      },
      {
        name: "402 -> payment_required (retryable)",

        error: httpError(
          402,
          "credits exhausted"
        ),

        retryable: true,

        reason: "payment_required",
      },
    ];

    const allPassed = cases.every(
      (testCase) => {
        const classification =
          classifyProviderError(
            testCase.error
          );

        return (
          classification.retryable ===
            testCase.retryable &&
          classification.reason ===
            testCase.reason
        );
      }
    );

    report(
      allPassed,
      "M. Error classification table",

      `${cases.length} classifications verified: ${cases
        .map(
          (c) =>
            `${c.name.split(" ->")[0]}=>${c.reason}`
        )
        .join(", ")}`
    );
  }

  /*
   * ------------------------------------------------------------
   * N. Rate-limited models enter cooldown and are skipped next request
   * ------------------------------------------------------------
   */
  {
    let groqCalls = 0;

    let geminiCalls = 0;

    resetHooks();

    _providerTestHooks.groqCreate =
      async () => {
        groqCalls += 1;

        throw httpError(
          429,
          "rate limit",
          "rate_limit_exceeded"
        );
      };

    _providerTestHooks.geminiGenerate =
      async () => {
        geminiCalls += 1;

        return { text: "ok" };
      };

    await createAICompletion(
      BASE_MESSAGES,

      { maxTokens: 10 }
    );

    const groqCallsAfterRequest1 =
      groqCalls;

    const result =
      await createAICompletion(
        BASE_MESSAGES,

        { maxTokens: 10 }
      );

    report(
      result.provider === "gemini" &&
        geminiCalls === 2 &&
        groqCalls ===
          groqCallsAfterRequest1,
      "N. Cooled-down models are skipped on the next request",

      `groqCalls req1=${groqCallsAfterRequest1} total=${groqCalls} (unchanged) | geminiCalls=${geminiCalls}`
    );
  }

  /*
   * ------------------------------------------------------------
   * O. Cooldown expires automatically
   * ------------------------------------------------------------
   */
  {
    let groqCalls = 0;

    resetHooks();

    _providerTestHooks.cooldownMs = 40;

    _providerTestHooks.groqCreate =
      async () => {
        groqCalls += 1;

        throw httpError(
          429,
          "rate limit",
          "rate_limit_exceeded"
        );
      };

    _providerTestHooks.geminiGenerate =
      async () => ({ text: "ok" });

    try {
      await createAICompletion(
        BASE_MESSAGES,

        { maxTokens: 10 }
      );
    } catch {
      // Strong chain ends on OpenRouter which is unhooked; ignore.
    }

    const before =
      groqCalls;

    await new Promise((resolve) =>
      setTimeout(resolve, 80)
    );

    let retriedGroq = false;

    try {
      await createAIStructuredCompletion(
        BASE_MESSAGES,

        z.object({
          ok: z.boolean(),
        }),

        "cooldown_expiry_probe"
      );
    } catch {
      // OpenRouter unhooked -> may throw; only call-count matters.
    }

    retriedGroq = groqCalls > before;

    report(
      retriedGroq,
      "O. Cooldown expires and cooled models are retried again",

      `groqCalls before=${before} after=${groqCalls}`
    );
  }

  /*
   * ------------------------------------------------------------
   * P. Attempt timeout falls through to the next provider
   * ------------------------------------------------------------
   */
  {
    resetHooks();

    _providerTestHooks.roleTimeoutMs =
      200;

    _providerTestHooks.groqCreate =
      async () =>
        new Promise(() => {
          // Never resolves - simulates a hung provider.
        });

    _providerTestHooks.geminiGenerate =
      async () => ({ text: "fast enough" });

    const startedAt = Date.now();

    const result =
      await createAICompletion(
        BASE_MESSAGES,

        { maxTokens: 10 }
      );

    const elapsed = Date.now() - startedAt;

    report(
      result.provider === "gemini" &&
        elapsed < 5000,
      "P. Hung provider times out and falls through",

      `provider=${result.provider} elapsed=${elapsed}ms`
    );
  }

  /*
   * ------------------------------------------------------------
   * Q. Balanced structured failure escalates to the strong chain
   * ------------------------------------------------------------
   */
  {
    const strictSchema = z.object({
      title: z.string().min(1),

      requiredField: z.string().min(1),
    });

    let groq120bCalls = 0;

    resetHooks();

    _providerTestHooks.groqCreate =
      async (args) => {
        if (
          args.model ===
          "openai/gpt-oss-120b"
        ) {
          groq120bCalls += 1;
        }

        return makeGroqCompletion(
          '{"title":"missing required field"}'
        );
      };

    _providerTestHooks.geminiGenerate =
      async () => ({
        text:
          '{"title":"still malformed"}',
      });

    _providerTestHooks.openRouterFetch =
      async () =>
        fakeFetchResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "Escalated",

                  requiredField:
                    "present",
                }),
              },
            },
          ],
        });

    const result =
      await createAIStructuredCompletion(
        BASE_MESSAGES,

        strictSchema,

        "escalation_probe",

        /*
         * Balanced role: malformed output must
         * escalate into the appended strong
         * chain - groq-120b is retried once at
         * full effort (no cooldown on
         * validation failures) before OpenRouter.
         */
        { modelRole: "balanced" }
      );

    const escalatedToStrong =
      groq120bCalls === 2;

    const valid =
      strictSchema.safeParse(result.data)
        .success;

    report(
      escalatedToStrong &&
        valid &&
        result.provider ===
          "openrouter",
      "Q. Malformed balanced output escalates through strong chain (Zod still guards)",

      `groq120bCalls=${groq120bCalls} (balanced + escalation) | final=${result.provider}/${result.model}`
    );
  }

  /*
   * ------------------------------------------------------------
   * R. OpenRouterRateLimitError(statusCode=429, code=429) classifies
   *    as rate_limit - provider-specific error subclasses must not
   *    bypass the HTTP status classifier.
   * ------------------------------------------------------------
   */
  {
    class OpenRouterRateLimitError extends Error {
      statusCode = 429;

      code = 429;

      constructor() {
        super(
          "Rate limit exceeded: openrouter_free_tier_daily (50/day)"
        );

        this.name =
          "OpenRouterRateLimitError";
      }
    }

    const classification =
      classifyProviderError(
        new OpenRouterRateLimitError()
      );

    const plainStatusShape =
      classifyProviderError({
        statusCode: 429,
      } as unknown);

    const numericCodeOnly =
      classifyProviderError({
        code: 429,
        message:
          "free tier daily limit",
      } as unknown);

    report(
      classification.retryable &&
        classification.reason ===
          "rate_limit" &&
        plainStatusShape.reason ===
          "rate_limit" &&
        numericCodeOnly.reason ===
          "rate_limit",
      "R. OpenRouter 429 shapes classify as rate_limit",

      `subclass=>${classification.reason} | statusCodeShape=>${plainStatusShape.reason} | numericCodeShape=>${numericCodeOnly.reason}`
    );
  }

  /*
   * ------------------------------------------------------------
   * S/T. Pre-first-token hang falls through within the interactive
   * window and Gemini Flash-Lite is reached BEFORE OpenRouter.
   * Mirrors the observed production failure sequence.
   * ------------------------------------------------------------
   */
  {
    const attemptedOrder: string[] = [];

    let fetchCalls = 0;

    const tokens: string[] = [];

    resetHooks();

    _providerTestHooks.firstTokenTimeoutMs =
      300;

    _providerTestHooks.groqCreate =
      async (args) => {
        attemptedOrder.push(
          `groq:${args.model}`
        );

        if (
          args.model ===
          "openai/gpt-oss-120b"
        ) {
          throw httpError(
            429,
            "rate limit",
            "rate_limit_exceeded"
          );
        }

        // gpt-oss-20b: hangs with no first token.
        return new Promise(() => {});
      };

    _providerTestHooks.geminiGenerateStream =
      async function* (model) {
        attemptedOrder.push(
          `gemini:${model}`
        );

        if (
          model === "gemini-2.5-flash"
        ) {
          // Mirrors the observed production rate limit.
          throw httpError(
            429,
            "rate limit",
            "rate_limit_exceeded"
          );
        }

        yield { text: "Quick answer." };
      };

    _providerTestHooks.openRouterFetch =
      async () => {
        fetchCalls += 1;

        attemptedOrder.push("openrouter");

        throw httpError(
          429,
          "daily free tier exhausted"
        );
      };

    const startedAt = Date.now();

    const result =
      await createAICompletion(
        BASE_MESSAGES,

        {
          maxTokens: 40,

          onToken: (delta) =>
            tokens.push(delta),
        }
      );

    const elapsed = Date.now() - startedAt;

    const liteIndex =
      attemptedOrder.indexOf(
        "gemini:gemini-3.1-flash-lite"
      );

    const openRouterIndex =
      attemptedOrder.indexOf(
        "openrouter"
      );

    const liteBeforeOpenRouter =
      liteIndex !== -1 &&
      (openRouterIndex === -1 ||
        liteIndex < openRouterIndex);

    report(
      result.provider === "gemini" &&
        result.model ===
          "gemini-3.1-flash-lite" &&
        result.content ===
          "Quick answer." &&
        elapsed < 5000 &&
        liteBeforeOpenRouter,
      "S/T. Pre-token timeout falls through; Flash-Lite serves before OpenRouter",

      `chain=${attemptedOrder.join(" -> ")} | elapsed=${elapsed}ms | fetchCalls=${fetchCalls} | content="${result.content}"`
    );
  }

  /*
   * ------------------------------------------------------------
   * V. Every provider unavailable -> bounded, predictable failure
   * ------------------------------------------------------------
   */
  {
    resetHooks();

    _providerTestHooks.firstTokenTimeoutMs =
      300;

    _providerTestHooks.groqCreate =
      async () => {
        throw httpError(
          429,
          "rate limit",
          "rate_limit_exceeded"
        );
      };

    _providerTestHooks.geminiGenerateStream =
      async () => {
        throw httpError(
          429,
          "RESOURCE_EXHAUSTED quota"
        );
      };

    _providerTestHooks.openRouterFetch =
      async () =>
        fakeFetchResponse(
          {
            error: {
              message:
                "free tier daily limit reached",
            },
          },

          false,

          429
        );

    const startedAt = Date.now();

    let threw = false;

    try {
      await createAICompletion(
        BASE_MESSAGES,

        {
          maxTokens: 20,

          onToken: () => undefined,
        }
      );
    } catch {
      threw = true;
    }

    const elapsed = Date.now() - startedAt;

    report(
      threw && elapsed < 15000,
      "V. All providers unavailable fails bounded and predictably",

      `threw=${threw} elapsed=${elapsed}ms`
    );
  }

  /*
   * ------------------------------------------------------------
   * W. OpenRouter daily 429 enters cooldown and the next request
   *    skips it entirely.
   * ------------------------------------------------------------
   */
  {
    let fetchCalls = 0;

    resetHooks();

    _providerTestHooks.firstTokenTimeoutMs =
      200;

    _providerTestHooks.groqCreate =
      async () => {
        throw httpError(
          429,
          "rate limit",
          "rate_limit_exceeded"
        );
      };

    _providerTestHooks.geminiGenerate =
      async () => {
        throw httpError(
          429,
          "RESOURCE_EXHAUSTED"
        );
      };

    _providerTestHooks.openRouterFetch =
      async () => {
        fetchCalls += 1;

        return fakeFetchResponse(
          {
            error: {
              message:
                "Rate limit exceeded: openrouter_free_tier_daily",
            },
          },

          false,

          429
        );
      };

    const cooldownSchema = z.object({
      value: z.string().min(1),
    });

    try {
      await createAIStructuredCompletion(
        BASE_MESSAGES,

        cooldownSchema,

        "cooldown_skip_probe"
      );
    } catch {
      // Expected exhaustion.
    }

    const fetchCallsAfterRequest1 =
      fetchCalls;

    try {
      await createAIStructuredCompletion(
        BASE_MESSAGES,

        cooldownSchema,

        "cooldown_skip_probe"
      );
    } catch {
      /*
       * Expected exhaustion again - but reached
       * via instant cooldown skips, not another
       * OpenRouter round trip.
       */
    }

    report(
      fetchCallsAfterRequest1 === 1 &&
        fetchCalls === 1,
      "W. OpenRouter 429 enters cooldown; next request skips it",

      `fetchCalls req1=${fetchCallsAfterRequest1} total=${fetchCalls} (unchanged)`
    );
  }


  function normalizedPropertiesFor(
    sanitized: Record<string, unknown>
  ): Record<string, unknown> {
    return ((sanitized.properties ?? {}) as Record<string, unknown>);
  }
  /*
   * ------------------------------------------------------------
   * H. Gemini schema normalization: planner/revision/assignment
   *    nullable fields produce NO null-type / type-arrays, and
   *    hydration restores missing nullable keys as null.
   *    Zero-quota deterministic test for Bug 4.
   * ------------------------------------------------------------
   */
  {
    const {
      _testNormalizeGeminiSchema,

      _testSanitizeGeminiSchema,

      setNullAlongPath,
    } = await import("../lib/ai/provider");

    const schemas = [
      [
        "studymate_study_plan",

        await import(
          "../lib/ai/agents/study-planner-agent"
        ).then((m) => m.studyPlanSchema),
      ],

      [
        "studymate_exam_revision",

        await import(
          "../lib/ai/agents/exam-revision-agent"
        ).then((m) => m.examRevisionSchema),
      ],

      [
        "studymate_assignment_guidance",

        await import(
          "../lib/ai/agents/assignment-assistant-agent"
        ).then((m) => m.assignmentGuidanceSchema),
      ],

      [
        "studymate_quiz",

        await import("../lib/ai/agents/quiz-agent").then(
          (m) => m.quizSchema
        ),
      ],
    ] as const;

    let allClean = true;

    let plannerPromoted = false;

    let hydrationWorks = false;

    for (const [name, schema] of schemas) {
      const raw = JSON.parse(
        JSON.stringify(z.toJSONSchema(schema))
      );

      /*
       * Production path: strip null branches,
       * then apply the Gemini keyword sanitizer
       * (which drops minItems/maxItems).
       */
      const sanitized = JSON.parse(
        JSON.stringify(
          _testSanitizeGeminiSchema(
            _testNormalizeGeminiSchema(raw)
          )
        )
      );

      const text = JSON.stringify(sanitized);

      if (text.includes('"null"')) {
        allClean = false;
      }

      if (
        /"type":\s*\[/.test(text) ||
        text.includes("minItems") ||
        text.includes("maxItems")
      ) {
        allClean = false;
      }

      if (
        name === "studymate_study_plan"
      ) {
        plannerPromoted =
          JSON.stringify(
            normalizedPropertiesFor(
              sanitized
            ).durationDays ??
              {}
          ).includes('"integer"') &&
          !JSON.stringify(
            normalizedPropertiesFor(
              sanitized
            ).durationDays ?? {}
          ).includes("anyOf");
      }
    }

    /*
     * Hydration unit check: nested wildcard path
     * plus root-level field.
     */
    const sample: Record<string, unknown> = {
      durationDays: undefined,

      days: [{ tasks: [{}] }],
    };

    delete sample.durationDays;

    setNullAlongPath(sample, ["durationDays"]);

    setNullAlongPath(sample, [
      "days",

      "*",

      "tasks",

      "*",

      "minutes",
    ]);

    const afterDays = (sample.days as unknown as Array<Record<string, unknown>>)[0];
    const afterTasks = (afterDays.tasks as unknown as Array<Record<string, unknown>>)[0];
    hydrationWorks =
      sample.durationDays === null &&
      afterTasks.minutes === null;

    report(
      allClean && plannerPromoted && hydrationWorks,
      "H. Gemini schema normalization + nullable hydration",

      `allSchemasClean=${allClean} plannerDurationPromoted=${plannerPromoted} hydrationWorks=${hydrationWorks}`
    );
  }

  resetHooks();

  console.log(
    `\n=== SUMMARY: ${
      failures === 0
        ? "ALL TESTS PASSED"
        : `${failures} FAILURE(S)`
    } (fully mocked - no provider quota consumed) ===`
  );

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);

  process.exit(1);
});
