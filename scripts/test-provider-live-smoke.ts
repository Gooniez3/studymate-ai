import dotenv from "dotenv";

dotenv.config({
  path: ".env.local",
});

import { z } from "zod";

/*
 * Live smoke test - makes ONE minimal
 * request per provider (~5 output tokens
 * each). Groq is intentionally force-failed
 * with mocked 429s for cases 2 and 3 so the
 * real Gemini and OpenRouter code paths run
 * without burning extra quota.
 */
async function main() {
  const {
    createAICompletion,

    createAIStructuredCompletion,

    _providerTestHooks,
  } = await import("../lib/ai/provider");

  function http429() {
    const error = new Error(
      "429 simulated rate limit [rate_limit_exceeded]"
    );

    Object.assign(error, {
      status: 429,

      code: "rate_limit_exceeded",
    });

    return error;
  }

  console.log(
    "\n=== LIVE PROVIDER SMOKE (one minimal request per provider) ==="
  );

  /*
   * 1. Real Groq primary attempt.
   */
  try {
    const result =
      await createAICompletion(
        [
          {
            role: "user",

            content: "Say OK.",
          },
        ],

        { maxTokens: 5 }
      );

    console.log(
      `[smoke] GROQ OK -> ${result.provider}/${result.model}: ${result.content}`
    );
  } catch (error) {
    console.log(
      `[smoke] GROQ FAILED (expected if TPD exhausted): ${
        error instanceof Error
          ? error.message.slice(0, 140)
          : String(error)
      }`
    );
  }

  try {
    /*
     * 2. Real Gemini structured output
     * (Groq force-failed via mock 429).
     */
    _providerTestHooks.groqCreate =
      async () => {
        throw http429();
      };

    const schema = z.object({
      title: z.string(),

      points: z.array(z.string()).max(3),
    });

    const result =
      await createAIStructuredCompletion(
        [
          {
            role: "user",

            content:
              'Return JSON with title "Test" and one point "Alpha".',
          },
        ],

        schema,

        "smoke_test_schema",

        { maxTokens: 60 }
      );

    console.log(
      `[smoke] GEMINI STRUCTURED OK -> ${result.provider}/${result.model}: ${JSON.stringify(
        result.data
      ).slice(0, 120)}`
    );
  } catch (error) {
    console.log(
      `[smoke] GEMINI FAILED: ${
        error instanceof Error
          ? error.message.slice(0, 200)
          : String(error)
      }`
    );
  }

  try {
    /*
     * 3. Real OpenRouter text completion
     * (Groq force-failed, Gemini force-failed).
     */
    _providerTestHooks.geminiGenerate =
      async () => {
        const error = new Error(
          "503 UNAVAILABLE simulated"
        );

        Object.assign(error, {
          status: 503,
        });

        throw error;
      };

    const result =
      await createAICompletion(
        [
          {
            role: "user",

            content: "Say OK.",
          },
        ],

        { maxTokens: 5 }
      );

    console.log(
      `[smoke] OPENROUTER OK -> ${result.provider}/${result.model}: ${result.content}`
    );
  } catch (error) {
    console.log(
      `[smoke] OPENROUTER FAILED: ${
        error instanceof Error
          ? error.message.slice(0, 200)
          : String(error)
      }`
    );
  } finally {
    _providerTestHooks.groqCreate = null;

    _providerTestHooks.geminiGenerate =
      null;
  }

  console.log("\n=== SMOKE COMPLETE ===");
}

main().catch((error) => {
  console.error(error);

  process.exit(1);
});
