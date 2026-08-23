import Groq from "groq-sdk";
import { GoogleGenAI } from "@google/genai";
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
  | "gemini"
  | "openrouter";

export type TextStreamResult = {
  provider: AIProvider;
  model: string;
  stream: AsyncIterable<string>;
};

export type AICompletionOptions = {
  temperature?: number;
  maxTokens?: number;

  /*
   * Use the small/fast models for lightweight
   * control-plane work (routing, verification,
   * query rewrites). Final user-facing answers
   * keep the stronger chain.
   */
  preferFastModel?: boolean;

  /*
   * When provided, completions stream token
   * deltas to this callback while the full
   * text is still returned as usual.
   */
  onToken?: (delta: string) => void;
};

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

/*
 * Legacy single-provider model list used by
 * the direct-stream helper and referenced by
 * historical callers.
 */
const GROQ_MODELS = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
] as const;

/*
 * ============================================================
 * Cross-provider fallback chains
 *
 * Groq rate limits are PER MODEL, so each of
 * these models draws from an independent
 * daily token bucket. Gemini and OpenRouter
 * are separate providers entirely.
 *
 * FAST: control-plane calls (routing,
 * verification, query rewriting).
 * STRONG: final answers, quiz, planner,
 * revision, document-grounded responses.
 * ============================================================
 */
export type AIAttempt = {
  provider: AIProvider;
  model: string;
};

const STRONG_CHAIN: AIAttempt[] = [
  {
    provider: "groq",
    model: "openai/gpt-oss-120b",
  },
  {
    provider: "groq",
    model: "openai/gpt-oss-20b",
  },
  {
    provider: "gemini",
    model: "gemini-2.5-flash",
  },
  {
    provider: "openrouter",
    model: OPENROUTER_MODELS.primary,
  },
];

const FAST_CHAIN: AIAttempt[] = [
  {
    provider: "groq",
    model: "openai/gpt-oss-20b",
  },
  {
    provider: "gemini",
    model: "gemini-2.5-flash-lite",
  },
];

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

function getAttemptChain(
  role: "fast" | "strong"
): AIAttempt[] {
  /*
   * Compatibility mode: AI_PROVIDER=openrouter
   * keeps the historical static behavior where
   * every call goes to OpenRouter only.
   */
  if (
    getConfiguredProvider() ===
    "openrouter"
  ) {
    return [
      {
        provider: "openrouter",
        model:
          OPENROUTER_MODELS.primary,
      },
      {
        provider: "openrouter",
        model:
          OPENROUTER_MODELS.fallback,
      },
    ];
  }

  return role === "fast"
    ? FAST_CHAIN
    : STRONG_CHAIN;
}

/*
 * ============================================================
 * Development logging. Never logs API keys,
 * prompts, or document content - only
 * provider/model identifiers and failure
 * classifications.
 * ============================================================
 */
function logAi(line: string) {
  console.log(`[ai] ${line}`);
}

type FailureClassification = {
  /*
   * Try the next attempt in the chain.
   */
  retryable: boolean;

  reason: string;
};

/*
 * Retryable: rate limits, provider outages,
 * 5xx errors, transient network failures, and
 * model-side schema violations on otherwise
 * valid requests (another model may comply).
 *
 * NOT retryable: invalid API keys, malformed
 * requests, configuration errors - falling
 * back would just burn quota and hide bugs.
 */
export function classifyProviderError(
  error: unknown
): FailureClassification {
  if (
    error instanceof Error &&
    error.name === "ProviderFatalError"
  ) {
    return {
      retryable: false,
      reason: "fatal",
    };
  }

  if (
    error instanceof Error &&
    error.name === "EmptyOutputError"
  ) {
    return {
      retryable: true,
      reason: "empty_output",
    };
  }

  const anyError = error as {
    status?: number;
    code?: unknown;
    message?: string;
    name?: string;
    error?: {
      error?: { code?: string };
    };
  };

  const status =
    typeof anyError.status ===
    "number"
      ? anyError.status
      : undefined;

  const code =
    (typeof anyError.code ===
      "string"
      ? anyError.code
      : undefined) ??
    anyError.error?.error?.code;

  const message =
    anyError.message ?? "";

  if (
    status === 429 ||
    code === "rate_limit_exceeded" ||
    /RESOURCE_EXHAUSTED/i.test(
      message
    )
  ) {
    return {
      retryable: true,
      reason: "rate_limit",
    };
  }

  if (
    (status !== undefined &&
      status >= 500) ||
    code === "overloaded" ||
    /UNAVAILABLE|overloaded/i.test(
      message
    )
  ) {
    return {
      retryable: true,
      reason: "server_error",
    };
  }

  if (
    status === 402 ||
    code === "payment_required"
  ) {
    /*
     * OpenRouter free-tier balance guard -
     * this provider is exhausted for us, but
     * others may not be.
     */
    return {
      retryable: true,
      reason: "payment_required",
    };
  }

  if (
    status === 400 &&
    (code === "json_validate_failed" ||
      /does not match the expected schema/i.test(
        message
      ))
  ) {
    /*
     * The REQUEST was valid; the model
     * produced non-schema JSON. Another
     * model may comply.
     */
    return {
      retryable: true,
      reason: "output_schema",
    };
  }

  if (
    status === 404 &&
    /model/i.test(message)
  ) {
    /*
     * A pinned model disappeared - skip it
     * rather than failing the request.
     */
    return {
      retryable: true,
      reason: "model_not_found",
    };
  }

  const networkMarkers = [
    /fetch failed/i,

    /ECONNRESET/,

    /ETIMEDOUT/,

    /ENOTFOUND/,

    /EAI_AGAIN/,

    /socket hang up/i,

    /network/i,
  ];

  const isNetworkError =
    anyError.name === "TypeError" &&
    networkMarkers.some((marker) =>
      marker.test(message)
    );

  if (
    isNetworkError ||
    networkMarkers.some((marker) =>
      marker.test(message)
    )
  ) {
    return {
      retryable: true,
      reason: "network",
    };
  }

  if (
    status === 401 ||
    status === 403 ||
    /API key|API_KEY_INVALID|permission/i.test(
      message
    )
  ) {
    return {
      retryable: false,
      reason: "auth",
    };
  }

  return {
    retryable: false,
    reason:
      status !== undefined
        ? `http_${status}`
        : "unknown_error",
  };
}

class ProviderFatalError extends Error {
  constructor(
    message: string,
    options?: {
      cause?: unknown;
    }
  ) {
    super(message, options);

    this.name =
      "ProviderFatalError";
  }
}

/*
 * Raised when a provider returns HTTP success
 * but no usable text (observed live with
 * gpt-oss reasoning models given very small
 * max_tokens: the budget is consumed by
 * reasoning tokens and the visible content is
 * empty). The request itself was valid, so the
 * next attempt in the chain is legitimate.
 */
class EmptyOutputError extends Error {
  constructor(
    message: string
  ) {
    super(message);

    this.name = "EmptyOutputError";
  }
}

/*
 * ============================================================
 * Test-only seams. Production paths always use
 * the real clients below; tests inject fakes so
 * fallback logic can be verified without
 * consuming provider quota. Never set in app
 * runtime code.
 * ============================================================
 */
export const _providerTestHooks = {
  groqCreate: null as null | ((args: Record<string, unknown>) => unknown),

  geminiGenerate: null as null | ((model: string, params: Record<string, unknown>) => unknown),

  geminiGenerateStream: null as null | ((model: string, params: Record<string, unknown>) => unknown),

  openRouterFetch: null as null | ((url: string, init: RequestInit) => Promise<Response>),
};

/*
 * ============================================================
 * Gemini client (lazy - only constructed when
 * a Gemini attempt actually runs).
 * ============================================================
 */
let geminiClient:
  | GoogleGenAI
  | null = null;

function getGeminiClient():
  | GoogleGenAI
  | null {
  const apiKey =
    process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return null;
  }

  if (!geminiClient) {
    geminiClient =
      new GoogleGenAI({ apiKey });
  }

  return geminiClient;
}

type GeminiTurn = {
  role: "user" | "model";

  parts: { text: string }[];
};

function toGeminiContents(
  messages: ChatMessage[]
): {
  systemInstruction?:
    | string;

  contents: GeminiTurn[];
} {
  let systemInstruction:
    | string
    | undefined;

  const contents: GeminiTurn[] =
    [];

  for (const message of messages) {
    if (
      message.role === "system"
    ) {
      systemInstruction =
        systemInstruction
          ? `${systemInstruction}\n\n${message.content}`
          : message.content;

      continue;
    }

    contents.push({
      role:
        message.role === "assistant"
          ? "model"
          : "user",

      parts: [
        { text: message.content },
      ],
    });
  }

  return {
    systemInstruction,

    contents,
  };
}

/*
 * Gemini's responseJsonSchema accepts plain
 * JSON Schema but only a documented subset of
 * keywords. z.toJSONSchema emits extras such
 * as $schema/maxLength/minLength/pattern that
 * are unsupported, so they are stripped before
 * sending.
 */
const GEMINI_SCHEMA_KEYWORDS = [
  "$id",

  "$defs",

  "$ref",

  "$anchor",

  "type",

  "format",

  "title",

  "description",

  "enum",

  "items",

  "prefixItems",

  "minItems",

  "maxItems",

  "minimum",

  "maximum",

  "anyOf",

  "oneOf",

  /*
   * NOTE: "properties"/"$defs"/"patternProperties"
   * are intentionally NOT in this list. Their
   * child keys are user-defined identifiers, so
   * they must route through the map branch
   * below - filtering their children by name
   * silently deletes user properties.
   */

  "additionalProperties",

  "required",
] as const;

/*
 * Keys whose CHILD keys are user-defined
 * identifiers (property names, def names),
 * not schema keywords. They must be preserved
 * verbatim while their VALUES are sanitized.
 */
const GEMINI_SCHEMA_MAP_KEYS = [
  "properties",

  "$defs",

  "patternProperties",
] as const;

function sanitizeSchemaForGemini(
  schema: unknown
): unknown {
  if (Array.isArray(schema)) {
    return schema.map((entry) =>
      sanitizeSchemaForGemini(entry)
    );
  }

  if (
    schema === null ||
    typeof schema !== "object"
  ) {
    return schema;
  }

  const source = schema as Record<
    string,
    unknown
  >;

  const result: Record<
    string,
    unknown
  > = {};

  for (const [
    key,
    value,
  ] of Object.entries(source)) {
    if (
      GEMINI_SCHEMA_KEYWORDS.includes(
        key as
          | (typeof GEMINI_SCHEMA_KEYWORDS)[number]
      )
    ) {
      result[key] =
        sanitizeSchemaForGemini(value);

      continue;
    }

    if (
      GEMINI_SCHEMA_MAP_KEYS.includes(
        key as
          | (typeof GEMINI_SCHEMA_MAP_KEYS)[number]
      )
    ) {
      /*
       * Keep the identifier keys, sanitize the
       * subschemas they point to. Stripping
       * these keys silently breaks required
       * property declarations.
       */
      const map =
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
          ? (value as Record<
              string,
              unknown
            >)
          : {};

      const sanitizedMap: Record<
        string,
        unknown
      > = {};

      for (const [
        entryKey,
        entryValue,
      ] of Object.entries(map)) {
        sanitizedMap[entryKey] =
          sanitizeSchemaForGemini(
            entryValue
          );
      }

      result[key] = sanitizedMap;
    }

    /*
     * Unsupported keywords ($schema, maxLength,
     * minLength, pattern, default, ...) are
     * dropped.
     */
  }

  return result;
}

async function geminiGenerateText(
  model: string,

  messages: ChatMessage[],

  temperature: number,

  maxTokens?: number
): Promise<string> {
  const {
    systemInstruction,

    contents,
  } = toGeminiContents(messages);

  const params: Record<
    string,
    unknown
  > = {
    model,

    contents,

    config: {
      /*
       * gpt-oss-style small budgets get
       * consumed by Gemini's default
       * thinking tokens, leaving empty or
       * truncated visible text. Revision and
       * control-plane calls do not need
       * thinking.
       */
      thinkingConfig: {
        thinkingBudget: 0,
      },

      temperature,

      ...(maxTokens
        ? {
            maxOutputTokens:
              maxTokens,
          }
        : {}),

      ...(systemInstruction
        ? {
            systemInstruction,
          }
        : {}),
    },
  };

  const response =
    _providerTestHooks.geminiGenerate
      ? ((await _providerTestHooks.geminiGenerate(
          model,
          params
        )) as { text?: string })
      : await (() => {
          const ai =
            getGeminiClient();

          if (!ai) {
            throw new ProviderFatalError(
              "Gemini is not configured."
            );
          }

          return ai.models.generateContent(
            params as unknown as Parameters<
              typeof ai.models.generateContent
            >[0]
          );
        })();

  const text = response.text ?? "";

  if (!text.trim()) {
    throw new EmptyOutputError(
      "Gemini returned no content."
    );
  }

  return text;
}

async function geminiGenerateStructured(
  model: string,

  messages: ChatMessage[],

  jsonSchema: unknown,

  maxTokens?: number
): Promise<string> {
  const {
    systemInstruction,

    contents,
  } = toGeminiContents(messages);

  const params: Record<
    string,
    unknown
  > = {
    model,

    contents,

    config: {
      /*
       * Thinking disabled for the same reason
       * as above - structured JSON must fit
       * the caller's output budget.
       */
      thinkingConfig: {
        thinkingBudget: 0,
      },

      temperature: 0,

      ...(maxTokens
        ? {
            maxOutputTokens:
              maxTokens,
          }
        : {}),

      ...(systemInstruction
        ? {
            systemInstruction,
          }
        : {}),

      responseMimeType:
        "application/json",

      responseJsonSchema:
        sanitizeSchemaForGemini(
          jsonSchema
        ),
    },
  };

  const response =
    _providerTestHooks.geminiGenerate
      ? ((await _providerTestHooks.geminiGenerate(
          model,
          params
        )) as { text?: string })
      : await (() => {
          const ai =
            getGeminiClient();

          if (!ai) {
            throw new ProviderFatalError(
              "Gemini is not configured."
            );
          }

          return ai.models.generateContent(
            params as unknown as Parameters<
              typeof ai.models.generateContent
            >[0]
          );
        })();

  const text = response.text ?? "";

  if (!text.trim()) {
    throw new EmptyOutputError(
      "Gemini structured output was empty."
    );
  }

  return text;
}

/*
 * ============================================================
 * OpenRouter helpers. Direct REST calls keep
 * structured-output semantics identical to the
 * Groq path (response_format json_schema),
 * while streaming reuses the existing LangChain
 * wrapper for compatibility.
 * ============================================================
 */
const OPENROUTER_API_URL =
  "https://openrouter.ai/api/v1/chat/completions";

function getOpenRouterApiKey(): string {
  const apiKey =
    process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new ProviderFatalError(
      "OpenRouter is not configured."
    );
  }

  return apiKey;
}

async function openRouterChat(
  body: Record<string, unknown>
): Promise<{
  content: string;
}> {
  const fetchImpl =
    _providerTestHooks.openRouterFetch ??
    globalThis.fetch.bind(globalThis);

  const response =
    await fetchImpl(
      OPENROUTER_API_URL,
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${getOpenRouterApiKey()}`,

          "Content-Type":
            "application/json",

          "X-Title": "StudyMate AI",
        },

        body: JSON.stringify(body),
      }
    );

  if (!response.ok) {
    let detail = "";

    try {
      const payload =
        await response.json();

      detail =
        payload?.error?.message ?? "";
    } catch {
      // Keep empty detail.
    }

    const error = new Error(
      `OpenRouter error${detail ? `: ${detail}` : ""}`
    );

    (
      error as { status?: number }
    ).status =
      response.status;

    throw error;
  }

  const payload =
    await response.json();

  const content =
    payload?.choices?.[0]?.message
      ?.content ?? "";

  if (
    typeof content !== "string" ||
    !content.trim()
  ) {
    throw new EmptyOutputError(
      "OpenRouter returned no content."
    );
  }

  return { content };
}

/*
 * ============================================================
 * Per-attempt executors
 * ============================================================
 */
async function groqCreate(
  args: Record<string, unknown>
): Promise<unknown> {
  if (
    _providerTestHooks.groqCreate
  ) {
    return _providerTestHooks.groqCreate(
      args
    );
  }

  return groq.chat.completions.create(
    args as unknown as Parameters<
      typeof groq.chat.completions.create
    >[0]
  );
}

async function attemptTextCompletion(
  attempt: AIAttempt,

  messages: ChatMessage[],

  temperature: number,

  maxTokens?: number
): Promise<string> {
  if (
    attempt.provider === "groq"
  ) {
    const completion =
      (await groqCreate({
        model: attempt.model,

        temperature,

        max_tokens: maxTokens,

        messages,
      })) as {
        choices?: {
          message?: { content?: string };
        }[];
      };

    const content =
      completion.choices?.[0]?.message
        ?.content ?? "";

    if (!content.trim()) {
      throw new EmptyOutputError(
        "Groq returned no content."
      );
    }

    return content;
  }

  if (
    attempt.provider === "gemini"
  ) {
    return geminiGenerateText(
      attempt.model,

      messages,

      temperature,

      maxTokens
    );
  }

  const { content } =
    await openRouterChat({
      model: attempt.model,

      temperature,

      max_tokens: maxTokens,

      messages,
    });

  return content;
}

async function attemptStructuredCompletion(
  attempt: AIAttempt,

  messages: ChatMessage[],

  schemaName: string,

  jsonSchema: unknown,

  maxTokens?: number
): Promise<unknown> {
  if (
    attempt.provider === "groq"
  ) {
    const completion =
      (await groqCreate({
        model: attempt.model,

        temperature: 0,

        messages,

        ...(maxTokens
          ? {
              max_tokens: maxTokens,
            }
          : {}),

        response_format: {
          type: "json_schema",

          json_schema: {
            name: schemaName,

            strict: true,

            schema: jsonSchema,
          },
        },
      })) as {
        choices?: {
          message?: { content?: string };
        }[];
      };

    return completion.choices?.[0]
      ?.message?.content;
  }

  if (
    attempt.provider === "gemini"
  ) {
    const raw =
      await geminiGenerateStructured(
        attempt.model,

        messages,

        jsonSchema,

        maxTokens
      );

    return raw;
  }

  const { content } =
    await openRouterChat({
      model: attempt.model,

      temperature: 0,

      max_tokens: maxTokens,

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

  return content;
}

type StreamStartResult = {
  consume: () => Promise<string>;
};

/*
 * Starts a streaming attempt. The returned
 * consumer forwards deltas to onToken exactly
 * once and returns the accumulated text.
 *
 * Mid-stream safety: if the stream fails after
 * deltas have already been forwarded, the
 * partial text is returned instead of throwing
 * so callers never duplicate user-visible
 * answers across providers.
 */
async function attemptStreamStart(
  attempt: AIAttempt,

  messages: ChatMessage[],

  temperature: number,

  maxTokens: number,

  onToken: (delta: string) => void
): Promise<StreamStartResult> {
  const consumeGroqStream =
    async (): Promise<string> => {
      const stream = await groqCreate({
        model: attempt.model,

        temperature,

        max_tokens: maxTokens,

        messages,

        stream: true,
      });

      const iterable =
        stream as AsyncIterable<unknown>;

      let content = "";

      let emitted = false;

      try {
        for await (const chunk of iterable) {
          const delta =
            (
              chunk as {
                choices?: {
                  delta?: {
                    content?: string;
                  };
                }[];
              }
            ).choices?.[0]?.delta
              ?.content;

          if (delta) {
            content += delta;

            emitted = true;

            onToken(delta);
          }
        }
      } catch (streamError) {
        if (emitted) {
          console.error(
            `[ai] stream interrupted mid-answer provider=${attempt.provider} model=${attempt.model}`
          );

          return content;
        }

        throw streamError;
      }

      return content;
    };

  const consumeGeminiStream =
    async (): Promise<string> => {
      const ai =
        getGeminiClient();

      if (!ai) {
        throw new ProviderFatalError(
          "Gemini is not configured."
        );
      }

      const {
        systemInstruction,

        contents,
      } = toGeminiContents(messages);

      const params: Record<
        string,
        unknown
      > = {
        model: attempt.model,

        contents,

        config: {
          /*
           * Thinking disabled: streaming budgets
           * must produce visible tokens, not
           * hidden thought tokens.
           */
          thinkingConfig: {
            thinkingBudget: 0,
          },

          temperature,

          maxOutputTokens: maxTokens,

          ...(systemInstruction
            ? {
                systemInstruction,
              }
            : {}),
        },
      };

      const stream =
        _providerTestHooks.geminiGenerateStream
          ? await _providerTestHooks.geminiGenerateStream(
              attempt.model,
              params
            )
          : await ai.models.generateContentStream(
              params as unknown as Parameters<
                typeof ai.models.generateContentStream
              >[0]
            );

      let content = "";

      let emitted = false;

      try {
        for await (const chunk of stream as AsyncIterable<{ text?: string }>) {
          const delta =
            chunk.text ?? "";

          if (delta) {
            content += delta;

            emitted = true;

            onToken(delta);
          }
        }
      } catch (streamError) {
        if (emitted) {
          console.error(
            `[ai] stream interrupted mid-answer provider=${attempt.provider} model=${attempt.model}`
          );

          return content;
        }

        throw streamError;
      }

      return content;
    };

  const consumeOpenRouterStream =
    async (): Promise<string> => {
      const model =
        createOpenRouterModel(
          attempt.model
        );

      const langChainStream =
        await model.stream(messages, {
          maxTokens,
        });

      let content = "";

      let emitted = false;

      try {
        for await (const chunk of langChainStream) {
          if (
            typeof chunk.content ===
              "string" &&
            chunk.content
          ) {
            content +=
              chunk.content;

            emitted = true;

            onToken(chunk.content);
          }
        }
      } catch (streamError) {
        if (emitted) {
          console.error(
            `[ai] stream interrupted mid-answer provider=${attempt.provider} model=${attempt.model}`
          );

          return content;
        }

        throw streamError;
      }

      return content;
    };

  if (
    attempt.provider === "groq"
  ) {
    return {
      consume: consumeGroqStream,
    };
  }

  if (
    attempt.provider === "gemini"
  ) {
    return {
      consume: consumeGeminiStream,
    };
  }

  return {
    consume: consumeOpenRouterStream,
  };
}

function isAttemptConfigured(
  attempt: AIAttempt
): boolean {
  if (
    attempt.provider === "gemini"
  ) {
    return Boolean(
      process.env.GEMINI_API_KEY
    );
  }

  if (
    attempt.provider ===
    "openrouter"
  ) {
    return Boolean(
      process.env.OPENROUTER_API_KEY
    );
  }

  return Boolean(
    process.env.GROQ_API_KEY
  );
}

/*
 * ============================================================
 * Chain runners
 * ============================================================
 */
async function runTextChain(
  role: "fast" | "strong",

  messages: ChatMessage[],

  options: AICompletionOptions
): Promise<{
  provider: AIProvider;
  model: string;
  content: string;
}> {
  const temperature =
    options.temperature ?? 0;

  const maxTokens =
    options.maxTokens ?? 500;

  const attempts =
    getAttemptChain(role);

  let lastError: unknown;

  let attemptedAny = false;

  for (const attempt of attempts) {
    if (
      !isAttemptConfigured(attempt)
    ) {
      logAi(
        `skip role=${role} provider=${attempt.provider} reason=not_configured`
      );

      continue;
    }

    attemptedAny = true;

    logAi(
      `trying role=${role} provider=${attempt.provider} model=${attempt.model}`
    );

    try {
      const content =
        await attemptTextCompletion(
          attempt,

          messages,

          temperature,

          maxTokens
        );

      logAi(
        `success role=${role} provider=${attempt.provider} model=${attempt.model}`
      );

      return {
        provider: attempt.provider,

        model: attempt.model,

        content,
      };
    } catch (error) {
      lastError = error;

      const classification =
        classifyProviderError(error);

      if (
        !classification.retryable
      ) {
        logAi(
          `abort role=${role} reason=${classification.reason} provider=${attempt.provider} model=${attempt.model}`
        );

        throw error;
      }

      logAi(
        `fallback role=${role} reason=${classification.reason} from=${attempt.provider}/${attempt.model}`
      );
    }
  }

  if (!attemptedAny) {
    throw new ProviderFatalError(
      "No AI provider is configured."
    );
  }

  throw (
    lastError ??
    new Error(
      "No AI model was available."
    )
  );
}

async function runStructuredChain<
  T extends Record<string, unknown>
>(
  role: "fast" | "strong",

  messages: ChatMessage[],

  schema: ZodType<T>,

  schemaName: string,

  maxTokens?: number
): Promise<AIStructuredCompletionResult<T>> {
  const jsonSchema =
    z.toJSONSchema(schema);

  const attempts =
    getAttemptChain(role);

  let lastError: unknown;

  let attemptedAny = false;

  for (const attempt of attempts) {
    if (
      !isAttemptConfigured(attempt)
    ) {
      logAi(
        `skip role=${role} provider=${attempt.provider} reason=not_configured`
      );

      continue;
    }

    attemptedAny = true;

    logAi(
      `trying role=${role} provider=${attempt.provider} model=${attempt.model} task=structured:${schemaName}`
    );

    try {
      const raw =
        await attemptStructuredCompletion(
          attempt,

          messages,

          schemaName,

          jsonSchema,

          maxTokens
        );

      if (
        typeof raw !== "string" ||
        !raw.trim()
      ) {
        throw new Error(
          "Structured completion returned no content."
        );
      }

      /*
       * Every provider's output passes the same
       * strict Zod validation before being
       * accepted.
       */
      const data =
        schema.parse(
          JSON.parse(raw)
        );

      logAi(
        `success role=${role} provider=${attempt.provider} model=${attempt.model} task=structured:${schemaName}`
      );

      return {
        provider: attempt.provider,

        model: attempt.model,

        data,
      };
    } catch (error) {
      lastError = error;

      const classification =
        classifyProviderError(error);

      const zodInvalid =
        error instanceof
          z.ZodError ||
        (error instanceof Error &&
          error.message.includes(
            "Unexpected token"
          ));

      if (
        !classification.retryable &&
        !zodInvalid
      ) {
        logAi(
          `abort role=${role} reason=${classification.reason} provider=${attempt.provider} model=${attempt.model}`
        );

        throw error;
      }

      logAi(
        `fallback role=${role} reason=${
          zodInvalid
            ? "output_schema"
            : classification.reason
        } from=${attempt.provider}/${attempt.model}`
      );
    }
  }

  if (!attemptedAny) {
    throw new ProviderFatalError(
      "No AI provider is configured."
    );
  }

  throw lastError;
}

async function runStreamChain(
  role: "fast" | "strong",

  messages: ChatMessage[],

  options: AICompletionOptions
): Promise<{
  provider: AIProvider;
  model: string;
  content: string;
}> {
  const temperature =
    options.temperature ?? 0;

  const maxTokens =
    options.maxTokens ?? 500;

  const onToken = options.onToken;

  if (!onToken) {
    return runTextChain(
      role,

      messages,

      options
    );
  }

  const attempts =
    getAttemptChain(role);

  let lastError: unknown;

  let attemptedAny = false;

  /*
   * Tracks whether any user-visible token has
   * been forwarded across ALL attempts. Once
   * true, generation must never restart on
   * another provider - that would duplicate
   * the answer.
   */
  let emittedAny = false;

  const guardedOnToken = (
    delta: string
  ) => {
    emittedAny = true;

    onToken(delta);
  };

  for (const attempt of attempts) {
    if (
      !isAttemptConfigured(attempt)
    ) {
      logAi(
        `skip role=${role} provider=${attempt.provider} reason=not_configured`
      );

      continue;
    }

    attemptedAny = true;

    logAi(
      `trying role=${role} provider=${attempt.provider} model=${attempt.model} mode=stream`
    );

    try {
      const started =
        await attemptStreamStart(
          attempt,

          messages,

          temperature,

          maxTokens,

          guardedOnToken
        );

      const content =
        await started.consume();

      logAi(
        `success role=${role} provider=${attempt.provider} model=${attempt.model} mode=stream`
      );

      return {
        provider: attempt.provider,

        model: attempt.model,

        content,
      };
    } catch (error) {
      lastError = error;

      if (emittedAny) {
        /*
         * Tokens already reached the user -
         * restarting generation on another
         * provider would duplicate the answer.
         */
        logAi(
          `stream-failed-after-tokens role=${role} provider=${attempt.provider} model=${attempt.model}`
        );

        throw error;
      }

      const classification =
        classifyProviderError(error);

      if (
        !classification.retryable
      ) {
        logAi(
          `abort role=${role} reason=${classification.reason} provider=${attempt.provider} model=${attempt.model}`
        );

        throw error;
      }

      logAi(
        `fallback role=${role} reason=${classification.reason} before-first-token from=${attempt.provider}/${attempt.model}`
      );
    }
  }

  if (!attemptedAny) {
    throw new ProviderFatalError(
      "No AI provider is configured."
    );
  }

  throw (
    lastError ??
    new Error(
      "No AI model was available."
    )
  );
}

/*
 * ============================================================
 * Public API - signatures unchanged for all
 * existing callers (graph nodes, agents, API
 * route).
 * ============================================================
 */
export async function createAICompletion(
  messages: ChatMessage[],

  options: AICompletionOptions = {}
): Promise<{
  provider: AIProvider;
  model: string;
  content: string;
}> {
  /*
   * Compatibility mode: AI_PROVIDER=openrouter
   * keeps the historical static OpenRouter-only
   * loop.
   */
  if (
    getConfiguredProvider() ===
    "openrouter"
  ) {
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

        if (options.onToken) {
          const langChainStream =
            await model.stream(
              messages,
              {
                maxTokens:
                  options.maxTokens ??
                  500,
              }
            );

          let streamedContent = "";

          for await (const chunk of langChainStream) {
            if (
              typeof chunk.content ===
              "string"
            ) {
              if (chunk.content) {
                streamedContent +=
                  chunk.content;

                options.onToken(
                  chunk.content
                );
              }
            }
          }

          console.log(
            `AI completion provider: OpenRouter | Model: ${modelName} | streamed`
          );

          return {
            provider:
              "openrouter",
            model: modelName,
            content: streamedContent,
          };
        }

        const response =
          await model.invoke(
            messages,
            {
              maxTokens:
                options.maxTokens ??
                500,
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
          provider:
            "openrouter",
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

  const role = options.preferFastModel
    ? "fast"
    : "strong";

  if (options.onToken) {
    return runStreamChain(
      role,
      messages,
      options
    );
  }

  return runTextChain(
    role,
    messages,
    options
  );
}

export async function createAIStructuredCompletion<
  T extends Record<string, any>
>(
  messages: ChatMessage[],
  schema: ZodType<T>,
  schemaName: string,

  /*
   * Structured control-plane calls (routing,
   * query rewrites) can run on the small fast
   * model without hurting answer quality.
   *
   * maxTokens optionally raises the output
   * ceiling for large structured payloads
   * (e.g. study plans). When omitted, the
   * provider default applies and existing
   * callers are unaffected.
   */
  options?: {
    preferFastModel?: boolean;

    maxTokens?: number;
  }
): Promise<AIStructuredCompletionResult<T>> {
  /*
   * Compatibility mode: AI_PROVIDER=openrouter
   * keeps the historical static OpenRouter-only
   * loop with LangChain structured output.
   */
  if (
    getConfiguredProvider() ===
    "openrouter"
  ) {
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

  const role = options?.preferFastModel
    ? "fast"
    : "strong";

  return runStructuredChain<T>(
    role,
    messages,
    schema,
    schemaName,
    options?.maxTokens
  );
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
