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
          4 &&
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
      "groq:openai/gpt-oss-20b,gemini:gemini-2.5-flash-lite";

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
      "groq:openai/gpt-oss-120b,groq:openai/gpt-oss-20b,gemini:gemini-2.5-flash,openrouter:nvidia/nemotron-3-super-120b-a12b:free";

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
