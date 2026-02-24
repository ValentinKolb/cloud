/**
 * Quotes Service using ZenQuotes API with Redis caching.
 * Fetches a new quote every hour.
 */

import { redis } from "bun";
import { logger } from "@valentinkolb/cloud/core/services";
import { getSync } from "@valentinkolb/cloud/core/services";
import { err, fail, ok, type Result } from "@valentinkolb/cloud/lib/server";

const log = logger("quotes");

export type Quote = {
  text: string;
  author: string;
};

const CACHE_KEY = "quotes:current";
const CACHE_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * Reads the cached quote from Redis; returns null when cache is empty or invalid.
 */
const getCachedQuote = async (): Promise<Quote | null> => {
  try {
    const cached = await redis.get(CACHE_KEY);
    if (!cached) return null;
    return JSON.parse(cached) as Quote;
  } catch {
    return null;
  }
};

/**
 * Stores the current quote in Redis with a fixed one-hour TTL.
 */
const setCachedQuote = async (quote: Quote): Promise<void> => {
  try {
    await redis.set(CACHE_KEY, JSON.stringify(quote), "EX", CACHE_TTL_SECONDS);
  } catch {
    // Cache failures are non-fatal.
  }
};

type ZenQuotesResponse = Array<{
  q: string;
  a: string;
  h: string;
}>;

/**
 * Fetches one quote from ZenQuotes and maps transport errors into `Result` failures.
 */
const fetchQuote = async (): Promise<Result<Quote>> => {
  try {
    const response = await fetch("https://zenquotes.io/api/random", {
      headers: {
        "User-Agent": `${(getSync<string>("app.name") || "App").replace(/\s+/g, "-")}/1.0`,
      },
    });

    if (!response.ok) {
      log.error("ZenQuotes API error", { status: response.status });
      return fail(err.internal("Failed to fetch quote"));
    }

    const data = (await response.json()) as ZenQuotesResponse;
    const quote = data[0];
    if (!quote) {
      return fail(err.internal("Quote API returned no data"));
    }

    return ok({
      text: quote.q ?? "Unknown",
      author: quote.a ?? "Unknown",
    });
  } catch (error) {
    log.error("Failed to fetch quote", {
      error: error instanceof Error ? error.message : String(error),
    });
    return fail(err.internal("Failed to fetch quote"));
  }
};

/**
 * Returns the current quote, preferring cache and falling back to remote fetch + cache fill.
 */
const get = async (): Promise<Result<Quote>> => {
  const cached = await getCachedQuote();
  if (cached) return ok(cached);

  const fetched = await fetchQuote();
  if (!fetched.ok) return fetched;

  await setCachedQuote(fetched.data);
  return fetched;
};

export const quotesService = {
  quote: {
    get,
  },
};

export type QuotesService = typeof quotesService;
