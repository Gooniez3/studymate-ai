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
   * Explicit model role override. When set,
   * it wins over preferFastModel. Structured
   * agents pass "balanced" so ordinary
   * educational output avoids paying full
   * reasoning latency unless escalation is
   * required.
   */
  modelRole?: AIModelRole;

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
    /*
     * Interactive-latency tier: when Groq and
     * Gemini Flash are both unavailable, this
     * verified Flash-Lite serves streaming and
     * structured requests in ~2.5-4.4s instead
     * of leaving the free OpenRouter fallback
     * (tens of seconds) as the only option.
     */
    provider: "gemini",
    model: "gemini-3.1-flash-lite",
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
    /*
     * gemini-2.5-flash-lite began returning
     * "no longer available" for new usage;
     * gemini-3.1-flash-lite is the verified
     * replacement (Aug 2026): supports
     * responseJsonSchema structured output
     * with thinkingBudget: 0, ~770ms round
     * trip on routing-sized prompts.
     */
    provider: "gemini",
    model: "gemini-3.1-flash-lite",
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

/*
 * ============================================================
 * Model roles
 *
 * FAST: routing, verification, query rewriting.
 * BALANCED: ordinary structured educational
 * output (quiz, planner, revision, assignment).
 * Runs the strong Groq models with reduced
 * reasoning effort so a 120B reasoning model is
 * not left generating long thought traces for
 * routine structured JSON, and adds a fast
 * Gemini Flash-Lite tier before any slow
 * last-resort model.
 *
 * STRONG: escalation path - full reasoning on
 * Groq plus the OpenRouter free fallback. Only
 * reached when balanced attempts fail
 * validation or availability.
 * ============================================================
 */
export type AIModelRole =
  | "fast"
  | "balanced"
  | "strong";

const BALANCED_CHAIN: AIAttempt[] = [
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
    provider: "gemini",
    model: "gemini-3.1-flash-lite",
  },
];

/*
 * Per-attempt timeouts (ms). A provider may
 * never hang a request indefinitely; on
 * timeout the attempt is classified as
 * retryable and the chain moves on.
 */
const ROLE_TIMEOUT_MS: Record<
  AIModelRole,
  number
> = {
  fast: 10_000,

  balanced: 30_000,

  strong: 45_000,
};

/*
 * Per provider/model in-memory cooldown.
 * When an attempt fails with a rate limit,
 * quota exhaustion, or a retired-model error,
 * that exact model is skipped for a short
 * window instead of being retried on every
 * request. Purely in-memory: expires by
 * itself, safe per serverless instance, and
 * degrades gracefully when an instance
 * restarts (cooldowns are simply forgotten).
 */
const PROVIDER_COOLDOWN_MS = 60_000;

const cooldownUntil = new Map<
  string,
  number
>();

function attemptKey(
  attempt: AIAttempt
): string {
  return `${attempt.provider}:${attempt.model}`;
}

function markCooldown(attempt: AIAttempt) {
  const ttl =
    _providerTestHooks.cooldownMs ??
    PROVIDER_COOLDOWN_MS;

  cooldownUntil.set(
    attemptKey(attempt),

    Date.now() + ttl
  );
}

function cooldownRemainingSeconds(
  attempt: AIAttempt
): number {
  const until = cooldownUntil.get(
    attemptKey(attempt)
  );

  if (!until) {
    return 0;
  }

  const remaining =
    until - Date.now();

  if (remaining <= 0) {
    cooldownUntil.delete(
      attemptKey(attempt)
    );

    return 0;
  }

  return Math.ceil(remaining / 1000);
}

/*
 * Test-only: clears every cooldown so tests
 * start from a clean slate.
 */
export function _testResetProviderCooldowns() {
  cooldownUntil.clear();
}

function isCoolingDown(
  attempt: AIAttempt
): boolean {
  return (
    cooldownRemainingSeconds(attempt) >
    0
  );
}

function getAttemptChain(
  role: AIModelRole
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

  if (role === "fast") {
    return FAST_CHAIN;
  }

  if (role === "balanced") {
    return BALANCED_CHAIN;
  }

  return STRONG_CHAIN;
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

  if (
    error instanceof Error &&
    (error.name ===
      "AttemptTimeoutError" ||
      error.name === "AbortError")
  ) {
    return {
      retryable: true,
      reason: "timeout",
    };
  }

  const anyError = error as {
    status?: unknown;

    statusCode?: unknown;

    code?: unknown;

    message?: string;

    name?: string;

    error?: {
      error?: { code?: string };
    };
  };

  /*
   * Providers expose the HTTP status under
   * different names: groq-sdk uses `status`,
   * OpenRouter's error subclasses use
   * `statusCode`. Accept both, plus numeric
   * `code` fields such as OpenRouter's
   * `code: 429` on rate-limit errors.
   */
  const rawStatus =
    anyError.status ??
    anyError.statusCode;

  const status =
    typeof rawStatus === "number"
      ? rawStatus
      : typeof rawStatus ===
          "string" &&
        /^\d{3}$/.test(rawStatus)
      ? Number(rawStatus)
      : undefined;

  const numericCode =
    typeof anyError.code === "number"
      ? anyError.code
      : typeof anyError.code ===
          "string" &&
        /^\d{3}$/.test(anyError.code)
      ? Number(anyError.code)
      : undefined;

  const code =
    (typeof anyError.code ===
      "string"
      ? anyError.code
      : undefined) ??
    anyError.error?.error?.code;

  const message =
    anyError.message ?? "";

  const effectiveStatus =
    status ?? numericCode;

  if (
    effectiveStatus === 429 ||
    code === "rate_limit_exceeded" ||
    /RESOURCE_EXHAUSTED|rate.?limit/i.test(
      message
    )
  ) {
    return {
      retryable: true,
      reason: "rate_limit",
    };
  }

  if (
    (effectiveStatus !== undefined &&
      effectiveStatus >= 500) ||
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
    effectiveStatus === 401 ||
    effectiveStatus === 403 ||
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
      effectiveStatus !== undefined
        ? `http_${effectiveStatus}`
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
 * Raised when an attempt exceeds its role
 * timeout. The request was valid but the
 * provider was too slow - the next attempt in
 * the chain is legitimate, and user-perceived
 * latency stays bounded.
 */
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

  /*
   * Test overrides for cooldown duration and
   * per-attempt role timeouts (ms).
   */
  cooldownMs: null as null | number,

  firstTokenTimeoutMs: null as null | number,

  roleTimeoutMs: null as null | number,
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

  /*
   * minItems/maxItems are deliberately NOT
   * forwarded: gemini-3.1-flash-lite rejects
   * array size constraints with HTTP 400
   * INVALID_ARGUMENT (bisected live against
   * studymate_study_plan - every other
   * keyword combination passed). Zod .min/.max
   * still enforce the caps after parsing, and
   * agent prompts state the limits verbally.
   */

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

/*
 * ============================================================
 * Gemini nullable-schema normalization.
 *
 * zod's .nullable() renders as
 *   { anyOf: [ {type:"integer",...}, {type:"null"} ] }
 * Gemini responseJsonSchema rejects the JSON-Schema
 * null type outright (HTTP 400 INVALID_ARGUMENT -
 * observed live on studymate_study_plan, while
 * null-free quiz/assignment schemas succeeded).
 *
 * Normalization drops the {"type":"null"} branch,
 * promotes a surviving single branch to replace
 * the anyOf, and removes the affected key from the
 * parent `required` list (absence Ã¢â€°Ë† null). The
 * dotted paths of every nullable field are
 * returned so the raw Gemini response can be
 * hydrated with nulls before Zod parsing - Zod
 * schemas keep these keys REQUIRED, so omission
 * would otherwise fail validation.
 *
 * Wildcard "*" segments stand for array items.
 * ============================================================
 */
function collectNullablePaths(
  schema: Record<string, unknown>,

  prefix: string,

  out: string[]
) {
  const properties = schema.properties as
    | Record<string, unknown>
    | undefined;

  const required = Array.isArray(
    schema.required
  )
    ? (schema.required as string[])
    : [];

  if (!properties) {
    return;
  }

  for (const [
    key,
    rawSubschema,
  ] of Object.entries(properties)) {
    const path = prefix
      ? `${prefix}.${key}`
      : key;

    const subschema =
      rawSubschema as Record<
        string,
        unknown
      >;

    if (
      subschema &&
      typeof subschema === "object" &&
      Array.isArray(subschema.anyOf) &&
      subschema.anyOf.some(
        (entry) =>
          (entry as { type?: unknown })
            ?.type === "null"
      )
    ) {
      out.push(path);

      continue;
    }

    if (
      subschema &&
      typeof subschema === "object"
    ) {
      if (
        (subschema.type as string) ===
          "array" &&
        subschema.items
      ) {
        collectNullablePaths(
          subschema.items as Record<
            string,
            unknown
          >,

          `${path}.*`,

          out
        );
      } else {
        collectNullablePaths(
          subschema,

          path,

          out
        );
      }
    }
  }

  void required;
}

/*
 * Removes {"type":"null"} branches from anyOf
 * constructs and promotes single survivors.
 * Returns the normalized schema; nullable dot
 * paths are collected separately by
 * collectNullablePaths.
 */
function stripNullBranches(
  node: unknown
): unknown {
  if (Array.isArray(node)) {
    return node.map((entry) =>
      stripNullBranches(entry)
    );
  }

  if (
    node === null ||
    typeof node !== "object"
  ) {
    return node;
  }

  const source = node as Record<
    string,
    unknown
  >;

  let working = source;

  if (
    Array.isArray(source.anyOf)
  ) {
    const nonNull =
      source.anyOf.filter(
        (entry) =>
          (entry as { type?: unknown })
            ?.type !== "null"
      );

    if (nonNull.length === 1) {
      const survivor = stripNullBranches(
        nonNull[0]
      ) as Record<string, unknown>;

      const merged: Record<
        string,
        unknown
      > = {};

      for (const [
        key,
        value,
      ] of Object.entries(source)) {
        if (key === "anyOf") {
          continue;
        }

        merged[key] =
          stripNullBranches(value);
      }

      for (const [
        key,
        value,
      ] of Object.entries(survivor)) {
        merged[key] = value;
      }

      working = merged;
    } else {
      working = {
        ...source,

        anyOf: stripNullBranches(
          source.anyOf
        ),
      };
    }
  }

  const result: Record<string, unknown> =
    {};

  for (const [
    key,
    value,
  ] of Object.entries(working)) {
    result[key] =
      key === "properties" ||
      key === "$defs" ||
      key === "patternProperties"
        ? normalizePropertyMap(value)
        : stripNullBranches(value);
  }

  return result;

  function normalizePropertyMap(
    map: unknown
  ): unknown {
    if (
      map === null ||
      typeof map !== "object" ||
      Array.isArray(map)
    ) {
      return map;
    }

    const out: Record<string, unknown> =
      {};

    for (const [
      propKey,
      propValue,
    ] of Object.entries(
      map as Record<string, unknown>
    )) {
      out[propKey] =
        stripNullBranches(propValue);
    }

    return out;
  }
}

export function _testSanitizeGeminiSchema(
  jsonSchema: unknown
): unknown {
  return sanitizeSchemaForGemini(jsonSchema);
}

export function _testNormalizeGeminiSchema(
  jsonSchema: unknown
): unknown {
  return stripNullBranches(jsonSchema);
}

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

  maxTokens?: number,

  signal?: AbortSignal
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
      abortSignal: signal,

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

/*
 * Sets explicit nulls along a dotted path
 * (array items use the "*" wildcard) so
 * nullable-but-required schema keys satisfy
 * strict Zod validation after Gemini
 * normalization made them optional.
 */
export function setNullAlongPath(
  node: unknown,

  segments: string[]
): void {
  if (
    node === null ||
    typeof node !== "object"
  ) {
    return;
  }

  const [head, ...rest] = segments;

  if (!head) {
    return;
  }

  if (head === "*") {
    if (Array.isArray(node)) {
      for (const item of node) {
        setNullAlongPath(item, rest);
      }
    }

    return;
  }

  const record = node as Record<
    string,
    unknown
  >;

  if (rest.length === 0) {
    if (!(head in record)) {
      record[head] = null;
    }

    return;
  }

  const next = record[head];

  if (
    next &&
    typeof next === "object"
  ) {
    setNullAlongPath(next, rest);
  }
}

async function geminiGenerateStructured(
  model: string,

  messages: ChatMessage[],

  jsonSchema: unknown,

  maxTokens?: number,

  signal?: AbortSignal
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
      abortSignal: signal,

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
          stripNullBranches(
            jsonSchema
          )
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

  /*
   * Hydration: nullable fields were made
   * optional for Gemini (null type is not
   * supported), so the model may omit them.
   * Zod schemas still require these keys -
   * re-insert explicit nulls along every
   * collected nullable path before parsing.
   */
  const parsed = JSON.parse(text);

  const normalized =
    stripNullBranches(jsonSchema);

  const nullablePaths: string[] = [];

  collectNullablePaths(
    normalized as Record<string, unknown>,

    "",

    nullablePaths
  );

  for (const path of nullablePaths) {
    setNullAlongPath(parsed, path.split("."));
  }

  return JSON.stringify(parsed);
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
  body: Record<string, unknown>,

  signal?: AbortSignal
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

        signal,
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
  args: Record<string, unknown>,

  signal?: AbortSignal
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
    >[0],

    { signal } as never
  );
}

async function attemptTextCompletion(
  attempt: AIAttempt,

  messages: ChatMessage[],

  temperature: number,

  maxTokens?: number,

  signal?: AbortSignal
): Promise<string> {
  if (
    attempt.provider === "groq"
  ) {
    const completion =
      (await groqCreate(
        {
          model: attempt.model,

          temperature,

          max_tokens: maxTokens,

          messages,
        },

        signal
      )) as {
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

      maxTokens,

      signal
    );
  }

  const { content } =
    await openRouterChat(
      {
        model: attempt.model,

        temperature,

        max_tokens: maxTokens,

        messages,
      },

      signal
    );

  return content;
}

async function attemptStructuredCompletion(
  attempt: AIAttempt,

  messages: ChatMessage[],

  schemaName: string,

  jsonSchema: unknown,

  maxTokens?: number,

  options?: {
    signal?: AbortSignal;

    reasoningEffort?:
      | "low"
      | "medium"
      | "high";
  }
): Promise<unknown> {
  if (
    attempt.provider === "groq"
  ) {
    const completion =
      (await groqCreate(
        {
          model: attempt.model,

          temperature: 0,

          messages,

          ...(maxTokens
            ? {
                max_tokens: maxTokens,
              }
            : {}),

          /*
           * Balanced-role structured calls run
           * gpt-oss reasoning models with reduced
           * thinking effort: routine structured
           * educational JSON does not need long
           * thought traces, and the schema plus
           * Zod validation protect correctness.
           */
          ...(options?.reasoningEffort
            ? {
                reasoning_effort:
                  options
                    .reasoningEffort,
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
        },

        options?.signal
      )) as {
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

        maxTokens,

        options?.signal
      );

    return raw;
  }

  const { content } =
    await openRouterChat(
      {
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
      },

      options?.signal
    );

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

  onToken: (delta: string) => void,

  signal?: AbortSignal
): Promise<StreamStartResult> {
  const consumeGroqStream =
    async (): Promise<string> => {
      const stream = await groqCreate(
        {
          model: attempt.model,

          temperature,

          max_tokens: maxTokens,

          messages,

          stream: true,
        },

        signal
      );

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

          abortSignal: signal,

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
/*
 * Bounds a single attempt so no provider can
 * hang a request indefinitely. The abort
 * controller is owned by the caller so the
 * underlying request is cancelled, not just
 * abandoned.
 */
function shouldCooldown(
  reason: string
): boolean {
  /*
   * Only cooldown on conditions that will
   * persist for a while: quota/rate limits,
   * retired models, exhausted balances.
   * Transient server errors and timeouts are
   * retried normally on the next request.
   */
  return (
    reason === "rate_limit" ||
    reason === "model_not_found" ||
    reason === "payment_required"
  );
}

/*
 * Hard wall-clock bound for a single attempt.
 * The AbortController cancels well-behaved
 * SDK requests; this race additionally bounds
 * any caller that ignores the signal.
 */
function withAttemptTimeout<
  T
>(
  promise: Promise<T>,

  role: AIModelRole
): Promise<T> {
  const timeoutMs =
    _providerTestHooks.roleTimeoutMs ??
    ROLE_TIMEOUT_MS[role];

  let timer:
    | ReturnType<typeof setTimeout>
    | undefined;

  const timeout =
    new Promise<never>(
      (_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(
            `attempt timed out after ${timeoutMs}ms`
          );

          error.name =
            "AttemptTimeoutError";

          reject(error);
        }, timeoutMs);
      }
    );

  return Promise.race([
    promise,

    timeout,
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  }) as Promise<T>;
}

async function runTextChain(
  role: AIModelRole,

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

    const remainingCooldown =
      cooldownRemainingSeconds(attempt);

    if (remainingCooldown > 0) {
      logAi(
        `skip role=${role} provider=${attempt.provider} model=${attempt.model} reason=cooldown remaining=${remainingCooldown}s`
      );

      continue;
    }

    attemptedAny = true;

    logAi(
      `attempt-start role=${role} provider=${attempt.provider} model=${attempt.model}`
    );

    const startedAt =
      performance.now();

    const controller =
      new AbortController();

    const abortTimer = setTimeout(
      () =>
        controller.abort(),

      (_providerTestHooks.roleTimeoutMs ?? ROLE_TIMEOUT_MS[role])
    );

    try {
      const content =
        await withAttemptTimeout(
          attemptTextCompletion(
            attempt,

            messages,

            temperature,

            maxTokens,

            controller.signal
          ),

          role
        );

      clearTimeout(abortTimer);

      const duration = Math.round(
        performance.now() - startedAt
      );

      logAi(
        `attempt-success role=${role} provider=${attempt.provider} model=${attempt.model} duration=${duration}ms`
      );

      return {
        provider: attempt.provider,

        model: attempt.model,

        content,
      };
    } catch (error) {
      clearTimeout(abortTimer);

      lastError = error;

      const duration = Math.round(
        performance.now() - startedAt
      );

      const classification =
        classifyProviderError(error);

      if (
        !classification.retryable
      ) {
        logAi(
          `abort role=${role} reason=${classification.reason} provider=${attempt.provider} model=${attempt.model} duration=${duration}ms`
        );

        throw error;
      }

      if (
        shouldCooldown(
          classification.reason
        )
      ) {
        markCooldown(attempt);
      }

      logAi(
        `attempt-failed role=${role} provider=${attempt.provider} model=${attempt.model} reason=${classification.reason} duration=${duration}ms`
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
  role: AIModelRole,

  messages: ChatMessage[],

  schema: ZodType<T>,

  schemaName: string,

  maxTokens?: number
): Promise<AIStructuredCompletionResult<T>> {
  const jsonSchema =
    z.toJSONSchema(schema);

  /*
   * Smart escalation: the balanced role walks
   * its fast structured chain first; if every
   * balanced attempt fails (availability or
   * validation), the strong chain - including
   * full-reasoning Groq and the OpenRouter
   * fallback - is appended. Models that failed
   * with rate limits are already cooling down,
   * so they are skipped rather than retried;
   * a model that produced INVALID output is
   * not cooled down and therefore gets one
   * escalation retry at full reasoning effort.
   * Rate-limited models skip instantly via
   * cooldown, so chain overlap never doubles
   * quota failures.
   */
  const attempts =
    role === "balanced"
      ? [
          ...BALANCED_CHAIN,

          ...STRONG_CHAIN,
        ]
      : getAttemptChain(role);

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

    const remainingCooldown =
      cooldownRemainingSeconds(attempt);

    if (remainingCooldown > 0) {
      logAi(
        `skip role=${role} provider=${attempt.provider} model=${attempt.model} reason=cooldown remaining=${remainingCooldown}s`
      );

      continue;
    }

    attemptedAny = true;

    logAi(
      `attempt-start role=${role} provider=${attempt.provider} model=${attempt.model} task=structured:${schemaName}`
    );

    const startedAt =
      performance.now();

    const controller =
      new AbortController();

    const abortTimer = setTimeout(
      () =>
        controller.abort(),

      (_providerTestHooks.roleTimeoutMs ?? ROLE_TIMEOUT_MS[role])
    );

    try {
      const raw =
        await withAttemptTimeout(
        attemptStructuredCompletion(
          attempt,

          messages,

          schemaName,

          jsonSchema,

          maxTokens,

          {
            signal: controller.signal,

            reasoningEffort:
              role === "balanced" &&
              attempt.provider === "groq"
                ? "low"
                : undefined,
          }
        ),

        role
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

      clearTimeout(abortTimer);

      const duration = Math.round(
        performance.now() - startedAt
      );

      logAi(
        `attempt-success role=${role} provider=${attempt.provider} model=${attempt.model} task=structured:${schemaName} duration=${duration}ms`
      );

      return {
        provider: attempt.provider,

        model: attempt.model,

        data,
      };
    } catch (error) {
      lastError = error;

      const duration = Math.round(
        performance.now() - startedAt
      );

      const classification =
        classifyProviderError(error);

      const zodInvalid =
        error instanceof
          z.ZodError ||
        (error instanceof Error &&
          error.message.includes(
            "Unexpected token"
          ));

      clearTimeout(abortTimer);

      if (
        !classification.retryable &&
        !zodInvalid
      ) {
        clearTimeout(abortTimer);

        logAi(
          `abort role=${role} reason=${classification.reason} provider=${attempt.provider} model=${attempt.model} duration=${duration}ms`
        );

        throw error;
      }

      if (
        shouldCooldown(
          classification.reason
        )
      ) {
        markCooldown(attempt);
      }

      logAi(
        `attempt-failed role=${role} provider=${attempt.provider} model=${attempt.model} reason=${
          zodInvalid
            ? "output_schema"
            : classification.reason
        } duration=${duration}ms`
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

/*
 * Interactive streaming latency bounds.
 *
 * FIRST_TOKEN: a provider that has not emitted
 * anything within this window is abandoned and
 * the chain falls through - the user must see
 * output quickly.
 *
 * ACTIVE_STREAM: once tokens are flowing, do
 * NOT interrupt a healthy long generation;
 * this generous cap only aborts a stream that
 * has stalled indefinitely. Mid-stream aborts
 * resolve to the partial answer (never a
 * restart).
 */
const FIRST_TOKEN_TIMEOUT_MS = 8_000;

const ACTIVE_STREAM_TIMEOUT_MS =
  180_000;

async function runStreamChain(
  role: AIModelRole,

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

  const chainStartedAt =
    performance.now();

  for (const attempt of attempts) {
    if (
      !isAttemptConfigured(attempt)
    ) {
      logAi(
        `skip role=${role} provider=${attempt.provider} reason=not_configured`
      );

      continue;
    }

    const remainingCooldown =
      cooldownRemainingSeconds(attempt);

    if (remainingCooldown > 0) {
      logAi(
        `skip role=${role} provider=${attempt.provider} model=${attempt.model} reason=cooldown remaining=${remainingCooldown}s`
      );

      continue;
    }

    attemptedAny = true;

    logAi(
      `attempt-start role=${role} provider=${attempt.provider} model=${attempt.model} mode=stream`
    );

    const startedAt =
      performance.now();

    const controller =
      new AbortController();

    /*
     * Phase 1 - first token. A provider that
     * has not produced ANY user-visible output
     * within the interactive window is aborted
     * and the chain falls through. Healthy
     * streams disarm this on their first delta.
     */
    let firstTokenTimer: ReturnType<
      typeof setTimeout
    > | undefined;

    let activeStreamTimer:
      | ReturnType<typeof setTimeout>
      | undefined;

    let firstTokenReject: (() => void) | null =
      null;

    const firstTokenTimeoutMs =
      _providerTestHooks.firstTokenTimeoutMs ??
      FIRST_TOKEN_TIMEOUT_MS;

    firstTokenTimer = setTimeout(() => {
      if (!emittedAny) {
        controller.abort();

        firstTokenReject?.();
      }
    }, firstTokenTimeoutMs);

    const guardedOnTokenWithPhases = (
      delta: string
    ) => {
      if (!emittedAny) {
        /*
         * First token arrived in time - disarm
         * the interactive timer and arm the much
         * larger stall guard for the rest of the
         * stream.
         */
        clearTimeout(firstTokenTimer);

        firstTokenTimer = undefined;

        if (!activeStreamTimer) {
          activeStreamTimer = setTimeout(
            () =>
              controller.abort(),

            ACTIVE_STREAM_TIMEOUT_MS
          );
        }
      }

      emittedAny = true;

      onToken(delta);
    };

    try {
      const started =
        await attemptStreamStart(
          attempt,

          messages,

          temperature,

          maxTokens,

          guardedOnTokenWithPhases,

          controller.signal
        );

      /*
       * Bound the pre-token hang case even when
       * a provider ignores the abort signal:
       * race consumption against the first-token
       * rejection. Post-first-token, this race
       * never fires and long healthy streams are
       * untouched (the active-stream abort is
       * handled inside the consumer, which
       * resolves to the partial answer).
       */
      const preTokenRejection =
        new Promise<never>(
          (_, reject) => {
            firstTokenReject = () => {
              const error = new Error(
                `no first token within ${firstTokenTimeoutMs}ms`
              );

              error.name =
                "AttemptTimeoutError";

              reject(error);
            };
          }
        );

      void preTokenRejection.catch(
        () => undefined
      );

      const content = await Promise.race([
        started.consume(),

        preTokenRejection,
      ]);

      clearTimeout(firstTokenTimer);

      clearTimeout(activeStreamTimer);

      const duration = Math.round(
        performance.now() - startedAt
      );

      logAi(
        `attempt-success role=${role} provider=${attempt.provider} model=${attempt.model} mode=stream duration=${duration}ms`
      );

      return {
        provider: attempt.provider,

        model: attempt.model,

        content,
      };
    } catch (error) {
      clearTimeout(firstTokenTimer);

      clearTimeout(activeStreamTimer);

      lastError = error;

      const duration = Math.round(
        performance.now() - startedAt
      );

      if (emittedAny) {
        /*
         * Tokens already reached the user -
         * restarting generation on another
         * provider would duplicate the answer.
         * The stream consumer itself returns
         * partial content on mid-stream errors,
         * so this path is a safety net only.
         */
        logAi(
          `stream-failed-after-tokens role=${role} provider=${attempt.provider} model=${attempt.model} duration=${duration}ms`
        );

        throw error;
      }

      const classification =
        classifyProviderError(error);

      if (
        !classification.retryable
      ) {
        logAi(
          `abort role=${role} reason=${classification.reason} provider=${attempt.provider} model=${attempt.model} duration=${duration}ms`
        );

        throw error;
      }

      if (
        shouldCooldown(
          classification.reason
        )
      ) {
        markCooldown(attempt);
      }

      logAi(
        `attempt-failed role=${role} provider=${attempt.provider} model=${attempt.model} reason=${classification.reason} before-first-token duration=${duration}ms`
      );
    }
  }

  if (!attemptedAny) {
    throw new ProviderFatalError(
      "No AI provider is configured."
    );
  }

  /*
   * Graceful exhaustion: every configured
   * provider was tried and failed. Fail fast
   * with a clear internal signal instead of
   * letting callers wait on anything else.
   */
  logAi(
    `exhausted role=${role} duration=${Math.round(
      performance.now() - chainStartedAt
    )}ms - all providers unavailable`
  );

  throw (
    lastError ??
    new ProviderFatalError(
      "All AI providers are unavailable."
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

  const role: AIModelRole =
    options.modelRole ??
    (options.preferFastModel
      ? "fast"
      : "strong");

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

    modelRole?: AIModelRole;

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

  const role: AIModelRole =
    options?.modelRole ??
    (options?.preferFastModel
      ? "fast"
      : "strong");

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
