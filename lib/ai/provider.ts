import Groq from "groq-sdk";
import type { ZodType } from "zod";
import { z } from "zod";

import {
  OPENROUTER_MODELS,
  createOpenRouterModel,
} from "@/lib/ai/models";

export type AIStructuredCompletionResult<
  T extends Record<string, any>
> = {
  provider: AIProvider;
  model: string;
  data: T;
};

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type AIProvider =
  | "groq"
  | "openrouter";

export type TextStreamResult = {
  provider: AIProvider;
  model: string;
  stream: AsyncIterable<string>;
};

export type AICompletionOptions = {
  temperature?: number;
  maxTokens?: number;
};

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const GROQ_MODELS = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
] as const;

function getConfiguredProvider(): AIProvider {
  const provider =
    process.env.AI_PROVIDER
      ?.trim()
      .toLowerCase();

  if (provider === "openrouter") {
    return "openrouter";
  }

  return "groq";
}

async function createGroqStream(
  messages: ChatMessage[]
): Promise<TextStreamResult> {
  let lastError: unknown;

  for (const model of GROQ_MODELS) {
    try {
      const groqStream =
        await groq.chat.completions.create({
          model,
          temperature: 0.35,
          max_tokens: 1400,
          stream: true,
          messages,
        });

      async function* textStream() {
        for await (
          const chunk of groqStream
        ) {
          const content =
            chunk.choices[0]?.delta
              ?.content;

          if (content) {
            yield content;
          }
        }
      }

      console.log(
        `AI provider: Groq | Model: ${model}`
      );

      return {
        provider: "groq",
        model,
        stream: textStream(),
      };
    } catch (error) {
      console.error(
        `Groq model failed: ${model}`,
        error
      );

      lastError = error;
    }
  }

  throw (
    lastError ??
    new Error(
      "No Groq model was available."
    )
  );
}

async function createOpenRouterStream(
  messages: ChatMessage[]
): Promise<TextStreamResult> {
  const modelNames = [
    OPENROUTER_MODELS.primary,
    OPENROUTER_MODELS.fallback,
  ];

  let lastError: unknown;

  for (const modelName of modelNames) {
    try {
      const model =
        createOpenRouterModel(
          modelName
        );

      const langChainStream =
        await model.stream(messages);

      async function* textStream() {
        for await (
          const chunk of langChainStream
        ) {
          if (
            typeof chunk.content ===
            "string"
          ) {
            if (chunk.content) {
              yield chunk.content;
            }
          }
        }
      }

      console.log(
        `AI provider: OpenRouter | Model: ${modelName}`
      );

      return {
        provider: "openrouter",
        model: modelName,
        stream: textStream(),
      };
    } catch (error) {
      console.error(
        `OpenRouter model failed: ${modelName}`,
        error
      );

      lastError = error;
    }
  }

  throw (
    lastError ??
    new Error(
      "No OpenRouter model was available."
    )
  );
}

export async function createAICompletion(
  messages: ChatMessage[],
  options: AICompletionOptions = {}
): Promise<{
  provider: AIProvider;
  model: string;
  content: string;
}> {
  const provider =
    getConfiguredProvider();

  const temperature =
    options.temperature ?? 0;

  const maxTokens =
    options.maxTokens ?? 500;

  if (provider === "openrouter") {
    const modelNames = [
      OPENROUTER_MODELS.primary,
      OPENROUTER_MODELS.fallback,
    ];

    let lastError: unknown;

    for (const modelName of modelNames) {
      try {
        const model =
          createOpenRouterModel(
            modelName
          );

        const response =
          await model.invoke(
            messages,
            {
              maxTokens,
            }
          );

        const content =
          typeof response.content === "string"
            ? response.content
            : "";

        console.log(
          `AI completion provider: OpenRouter | Model: ${modelName}`
        );

        return {
          provider: "openrouter",
          model: modelName,
          content,
        };
      } catch (error) {
        console.error(
          `OpenRouter completion failed: ${modelName}`,
          error
        );

        lastError = error;
      }
    }

    throw (
      lastError ??
      new Error(
        "No OpenRouter model was available."
      )
    );
  }

  let lastError: unknown;

  for (const model of GROQ_MODELS) {
    try {
      const completion =
        await groq.chat.completions.create({
          model,
          temperature,
          max_tokens: maxTokens,
          messages,
        });

      const content =
        completion.choices[0]
          ?.message?.content ?? "";

      console.log(
        `AI completion provider: Groq | Model: ${model}`
      );

      return {
        provider: "groq",
        model,
        content,
      };
    } catch (error) {
      console.error(
        `Groq completion failed: ${model}`,
        error
      );

      lastError = error;
    }
  }

  throw (
    lastError ??
    new Error(
      "No Groq model was available."
    )
  );
}

export async function createAIStructuredCompletion<
  T extends Record<string, any>
>(
  messages: ChatMessage[],
  schema: ZodType<T>,
  schemaName: string
): Promise<AIStructuredCompletionResult<T>> {
  const provider =
    getConfiguredProvider();

  if (provider === "openrouter") {
    const modelNames = [
      OPENROUTER_MODELS.primary,
      OPENROUTER_MODELS.fallback,
    ];

    let lastError: unknown;

    for (const modelName of modelNames) {
      try {
        const model =
          createOpenRouterModel(
            modelName
          );

        const structuredModel =
          model.withStructuredOutput(
            schema,
            {
              name: schemaName,
            }
          );

        const rawData =
  await structuredModel.invoke(
    messages
  );

const data =
  schema.parse(rawData);

console.log(
  `AI structured provider: OpenRouter | Model: ${modelName}`
);

return {
  provider: "openrouter",
  model: modelName,
  data,
};
      } catch (error) {
        console.error(
          `OpenRouter structured completion failed: ${modelName}`,
          error
        );

        lastError = error;
      }
    }

    throw (
      lastError ??
      new Error(
        "No OpenRouter model was available for structured output."
      )
    );
  }

  const jsonSchema =
    z.toJSONSchema(schema);

  let lastError: unknown;

  for (const model of GROQ_MODELS) {
    try {
      const completion =
        await groq.chat.completions.create({
          model,
          temperature: 0,
          messages,

          response_format: {
            type: "json_schema",

            json_schema: {
              name: schemaName,
              strict: true,
              schema: jsonSchema,
            },
          },
        });

      const raw =
        completion.choices[0]
          ?.message?.content;

      if (!raw) {
        throw new Error(
          "Structured completion returned no content."
        );
      }

      const data =
        schema.parse(
          JSON.parse(raw)
        );

      console.log(
        `AI structured provider: Groq | Model: ${model}`
      );

      return {
        provider: "groq",
        model,
        data,
      };
    } catch (error) {
      console.error(
        `Groq structured completion failed: ${model}`,
        error
      );

      lastError = error;
    }
  }

  throw (
    lastError ??
    new Error(
      "No Groq model was available for structured output."
    )
  );
}

export async function createAITextStream(
  messages: ChatMessage[]
): Promise<TextStreamResult> {
  const provider =
    getConfiguredProvider();

  if (provider === "openrouter") {
    return createOpenRouterStream(
      messages
    );
  }

  return createGroqStream(
    messages
  );
}