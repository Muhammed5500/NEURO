"use client";

/**
 * useLiveTrends Hook
 * 
 * Connects to LIVE trend intelligence data.
 * NO MOCK DATA - errors if backend unavailable.
 */

import { useState, useEffect, useCallback } from "react";
import {
  API,
  liveFetch,
  createSSEConnection,
  ConnectionError,
  type ConnectionState,
  type DataSourceError,
} from "@/lib/live-data-client";

// ============================================
// TYPES
// ============================================

export interface TrendKeyword {
  id: string;
  keyword: string;
  mentions: number;
  mentionsDelta: number;
  sentiment: number;
  velocity: number;
  source: "x" | "telegram" | "discord" | "news";
  firstSeen: string; // ISO timestamp
  relatedTickers: string[];
}

export interface SentimentData {
  overall: number;
  bullish: number;
  bearish: number;
  neutral: number;
  volume: number;
  lastUpdated: string;
}

export interface TrendUpdate {
  type: "keyword_update" | "sentiment_update" | "new_keyword";
  data: TrendKeyword | SentimentData;
  timestamp: string;
}

// ============================================
// HOOK
// ============================================

export function useLiveTrends() {
  const [keywords, setKeywords] = useState<TrendKeyword[]>([]);
  const [sentiment, setSentiment] = useState<SentimentData | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [error, setError] = useState<DataSourceError | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Initial data fetch
  const fetchInitialData = useCallback(async () => {
    try {
      setConnectionState("connecting");
      setError(null);

      const [keywordsData, sentimentData] = await Promise.all([
        liveFetch<{ keywords: TrendKeyword[] }>(API.trends.keywords(), "TRENDS_KEYWORDS"),
        liveFetch<SentimentData>(API.trends.sentiment(), "TRENDS_SENTIMENT"),
      ]);

      setKeywords(keywordsData.keywords);
      setSentiment(sentimentData);
      setLastUpdate(new Date());
      setConnectionState("connected");
    } catch (err) {
      if (err instanceof ConnectionError) {
        setError(err.toDataSourceError());
      } else {
        setError({
          source: "TRENDS",
          code: "UNKNOWN",
          message: String(err),
          timestamp: new Date(),
        });
      }
      setConnectionState("error");
    }
  }, []);

  // SSE stream for real-time updates
  useEffect(() => {
    const sse = createSSEConnection(
      API.trends.stream(),
      "TRENDS_STREAM",
      (data) => {
        const update = data as TrendUpdate;
        setLastUpdate(new Date());

        switch (update.type) {
          case "keyword_update":
          case "new_keyword":
            const keywordData = update.data as TrendKeyword;
            setKeywords((prev) => {
              const exists = prev.findIndex((k) => k.id === keywordData.id);
              if (exists >= 0) {
                const updated = [...prev];
                updated[exists] = keywordData;
                return updated;
              }
              return [keywordData, ...prev];
            });
            break;

          case "sentiment_update":
            setSentiment(update.data as SentimentData);
            break;
        }
      },
      (state, err) => {
        setConnectionState(state);
        if (err) setError(err);
      }
    );

    // Fetch initial data then connect to stream
    fetchInitialData().then(() => {
      if (connectionState !== "error") {
        sse.connect();
      }
    });

    return () => {
      sse.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = useCallback(() => {
    setError(null);
    fetchInitialData();
  }, [fetchInitialData]);

  return {
    keywords,
    sentiment,
    connectionState,
    error,
    lastUpdate,
    retry,
    isConnected: connectionState === "connected",
    isLoading: connectionState === "connecting",
  };
}
