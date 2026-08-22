import { ChatOpenRouter } from "@langchain/openrouter";

export const OPENROUTER_MODELS = {
  primary: "openrouter/free",
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