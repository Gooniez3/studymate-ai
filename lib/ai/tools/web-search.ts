import { tool } from "@langchain/core/tools";
import { z } from "zod";

export type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
};

export type SearchWebResult = {
  context: string;
  sources: {
    title: string;
    url: string;
  }[];
};

const searchCache = new Map<
  string,
  {
    result: SearchWebResult;
    timestamp: number;
  }
>();

const CACHE_TTL_MS =
  1000 * 60 * 30;

function getCacheKey(
  query: string
): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function getHostname(
  url: string
): string {
  try {
    return new URL(url)
      .hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return "";
  }
}

function getAuthorityScore(
  result: TavilyResult,
  query: string
): number {
  if (!result.url) {
    return 0;
  }

  const hostname =
    getHostname(result.url);

  let boost = 0;

  // Government and educational sources
  if (
    hostname.endsWith(".gov") ||
    hostname.endsWith(".edu")
  ) {
    boost += 0.15;
  }

  // Prefer domains that directly match
  // an important entity in the query.
  const queryTokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(
      (token) =>
        token.length >= 4
    );

  const domainMatchesQuery =
    queryTokens.some((token) =>
      hostname.includes(token)
    );

  if (domainMatchesQuery) {
    boost += 0.15;
  }

  const trustedReferenceDomains = [
    "reuters.com",
    "apnews.com",
    "bbc.com",
    "bbc.co.uk",
    "nytimes.com",
    "theguardian.com",
    "nature.com",
    "science.org",
    "wikipedia.org",
  ];

  if (
    trustedReferenceDomains.some(
      (domain) =>
        hostname === domain ||
        hostname.endsWith(
          `.${domain}`
        )
    )
  ) {
    boost += 0.07;
  }

  const lowerPriorityDomains = [
    "youtube.com",
    "youtu.be",
    "letterboxd.com",
    "pinterest.com",
  ];

  if (
    lowerPriorityDomains.some(
      (domain) =>
        hostname === domain ||
        hostname.endsWith(
          `.${domain}`
        )
    )
  ) {
    boost -= 0.08;
  }

  return boost;
}

export async function searchWeb(
  query: string
): Promise<SearchWebResult | null> {
  const cleanQuery =
    query.trim();

  if (!cleanQuery) {
    return null;
  }

  const apiKey =
    process.env.TAVILY_API_KEY;

  if (!apiKey) {
    console.error(
      "Missing TAVILY_API_KEY"
    );

    return null;
  }

  const cacheKey =
    getCacheKey(cleanQuery);

  const cached =
    searchCache.get(cacheKey);

  if (
    cached &&
    Date.now() -
      cached.timestamp <
      CACHE_TTL_MS
  ) {
    return cached.result;
  }

  try {
    const res = await fetch(
      "https://api.tavily.com/search",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          Authorization:
            `Bearer ${apiKey}`,
        },

        body: JSON.stringify({
          query: cleanQuery,
          search_depth:
            "advanced",
          chunks_per_source: 2,
          max_results: 6,
          include_answer: false,
          include_raw_content:
            false,
        }),
      }
    );

    if (!res.ok) {
      console.error(
        "Tavily error:",
        await res.text()
      );

      return null;
    }

    const data =
      await res.json();

    const results:
      TavilyResult[] =
        data.results || [];

    console.log(
      "Tavily results:",
      results.map((result) => ({
        title: result.title,
        score: result.score,
        url: result.url,
      }))
    );

    const validResults =
      results
        .filter(
          (result) =>
            result.title &&
            result.url &&
            result.content &&
            typeof result.score ===
              "number" &&
            result.score >= 0.5
        )
        .map((result) => {
          const authorityBoost =
            getAuthorityScore(
              result,
              cleanQuery
            );

          return {
            ...result,

            finalScore:
              (result.score ?? 0) +
              authorityBoost,
          };
        })
        .sort(
          (a, b) =>
            b.finalScore -
            a.finalScore
        )
        .slice(0, 5);

    if (
      validResults.length === 0
    ) {
      console.warn(
        "Tavily returned no sufficiently relevant results for:",
        cleanQuery
      );

      return null;
    }

    const MAX_RESULT_CHARS =
      1200;

    const context =
      validResults
        .slice(0, 3)
        .map(
          (
            result,
            index
          ) => {
            const hostname =
              getHostname(
                result.url!
              );

            const content =
              result.content!
                .length >
              MAX_RESULT_CHARS
                ? `${result.content!.slice(
                    0,
                    MAX_RESULT_CHARS
                  )}...`
                : result.content!;

            return [
              `[${index + 1}] ${result.title}`,
              `Source: ${hostname}`,
              `Relevance: ${(
                result.score ?? 0
              ).toFixed(3)}`,
              content,
            ].join("\n");
          }
        )
        .join("\n\n");

    const sources =
      validResults
        .slice(0, 3)
        .map((result) => ({
          title:
            result.title!,
          url: result.url!,
        }));

    const result:
      SearchWebResult = {
        context,
        sources,
      };

    searchCache.set(
      cacheKey,
      {
        result,
        timestamp:
          Date.now(),
      }
    );

    return result;
  } catch (error) {
    console.error(
      "Tavily error:",
      error
    );

    return null;
  }
}

export async function searchWebMultiple(
  queries: string[]
): Promise<SearchWebResult | null> {
  const uniqueQueries =
    Array.from(
      new Set(
        queries
          .map((query) =>
            query.trim()
          )
          .filter(Boolean)
      )
    ).slice(0, 2);

  if (
    uniqueQueries.length === 0
  ) {
    return null;
  }

  const results =
    await Promise.all(
      uniqueQueries.map(
        (query) =>
          searchWeb(query)
      )
    );

  const successfulResults =
    results.filter(
      (
        result
      ): result is SearchWebResult =>
        result !== null
    );

  if (
    successfulResults.length ===
    0
  ) {
    return null;
  }

  const sourceMap =
    new Map<
      string,
      {
        title: string;
        url: string;
      }
    >();

  for (
    const result of
    successfulResults
  ) {
    for (
      const source of
      result.sources
    ) {
      if (
        !sourceMap.has(
          source.url
        )
      ) {
        sourceMap.set(
          source.url,
          source
        );
      }
    }
  }

  const sources =
    Array.from(
      sourceMap.values()
    ).slice(0, 8);

  const context =
    successfulResults
      .map(
        (
          result,
          index
        ) => {
          const query =
            uniqueQueries[
              index
            ] ||
            "Unknown search query";

          return [
            `SEARCH INTENT ${
              index + 1
            }:`,
            query,
            "",
            result.context,
          ].join("\n");
        }
      )
      .join(
        "\n\n====================\n\n"
      );

  return {
    context,
    sources,
  };
}

/**
 * LangChain tool used later by
 * LangGraph / agent nodes.
 *
 * The existing StudyMate route can
 * continue calling searchWebMultiple()
 * directly during Phase 3.
 */
export const webSearchTool =
  tool(
    async ({
      queries,
    }: {
      queries: string[];
    }) => {
      const result =
        await searchWebMultiple(
          queries
        );

      if (!result) {
        return JSON.stringify({
          success: false,
          context: "",
          sources: [],
        });
      }

      return JSON.stringify({
        success: true,
        context:
          result.context,
        sources:
          result.sources,
      });
    },
    {
      name: "web_search",

      description:
        "Search the current web for recent, changing, or externally verifiable information. Use this for current events, latest information, prices, regulations, announcements, releases, rankings, and other facts that may have changed.",

      schema: z.object({
        queries: z
          .array(
            z
              .string()
              .trim()
              .min(1)
          )
          .min(1)
          .max(2)
          .describe(
            "One or two focused web search queries."
          ),
      }),
    }
  );