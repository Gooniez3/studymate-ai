import { ChatOpenRouter } from "@langchain/openrouter";

/*
 * Pinned OpenRouter model IDs.
 *
 * primary: NVIDIA Nemotron 3 Super - verified
 * live as a genuinely free model (Aug 2026).
 * The previously planned openai/gpt-oss-120b:free
 * ID was retired by OpenRouter ("unavailable
 * for free"), which is why this is pinned to a
 * confirmed-free slug instead.
 *
 * fallback: OpenRouter's free-models router -
 * selects any currently available free model
 * that supports the requested features. The
 * roster rotates, so this is a catch-all, not
 * a quality guarantee.
 */
export const OPENROUTER_MODELS = {
  primary:
    "nvidia/nemotron-3-super-120b-a12b:free",

  fallback: "openrouter/free",
} as const;

function getOpenRouterApiKey(): string {
  const apiKey =
    process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not configured."
    );
  }

  return apiKey;
}

export function createOpenRouterModel(
  modelName: string
) {
  return new ChatOpenRouter({
    model: modelName,
    apiKey: getOpenRouterApiKey(),
    temperature: 0.35,
    maxTokens: 1400,
    maxRetries: 1,
  });
}

export function getPrimaryModel() {
  return createOpenRouterModel(
    OPENROUTER_MODELS.primary
  );
}

export function getFallbackModel() {
  return createOpenRouterModel(
    OPENROUTER_MODELS.fallback
  );
}

export function getModelFallbackChain() {
  return [
    getPrimaryModel(),
    getFallbackModel(),
  ];
}