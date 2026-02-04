"use client";

/**
 * useLiveSocial Hook
 * 
 * Connects to LIVE social bot metrics and engagement data.
 * NO MOCK DATA - errors if API unavailable.
 */

import { useState, useEffect, useCallback } from "react";
import {
  API,
  liveFetch,
  ConnectionError,
  type ConnectionState,
  type DataSourceError,
} from "@/lib/live-data-client";

// ============================================
// TYPES
// ============================================

export interface SocialMetrics {
  totalTweets: number;
  tweetsToday: number;
  totalEngagement: number;
  likes: number;
  retweets: number;
  replies: number;
  impressions: number;
  kFactor: number;
  avgEngagementRate: number;
  activeBots: number;
  queuedPosts: number;
  lastUpdated: string;
}

export interface BotAccount {
  id: string;
  handle: string;
  status: "active" | "rate_limited" | "suspended" | "offline";
  followers: number;
  postsToday: number;
  engagementRate: number;
  lastActive: string;
}

export interface RecentPost {
  id: string;
  content: string;
  timestamp: string;
  likes: number;
  retweets: number;
  replies: number;
  impressions: number;
  botId: string;
  botHandle: string;
  status: "posted" | "viral" | "flagged" | "deleted";
  url?: string;
}

// ============================================
// HOOK - SOCIAL METRICS
// ============================================

export function useLiveSocialMetrics() {
  const [metrics, setMetrics] = useState<SocialMetrics | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [error, setError] = useState<DataSourceError | null>(null);

  const fetchMetrics = useCallback(async () => {
    try {
      setConnectionState("connecting");
      setError(null);

      const data = await liveFetch<SocialMetrics>(
        API.social.metrics(),
        "SOCIAL_METRICS"
      );

      setMetrics(data);
      setConnectionState("connected");
    } catch (err) {
      if (err instanceof ConnectionError) {
        setError(err.toDataSourceError());
      } else {
        setError({
          source: "SOCIAL_METRICS",
          code: "UNKNOWN",
          message: String(err),
          timestamp: new Date(),
        });
      }
      setConnectionState("error");
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
    
    // Poll every 10 seconds
    const interval = setInterval(fetchMetrics, 10000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  return {
    metrics,
    connectionState,
    error,
    retry: fetchMetrics,
    isConnected: connectionState === "connected",
  };
}

// ============================================
// HOOK - BOT ACCOUNTS
// ============================================

export function useLiveBots() {
  const [bots, setBots] = useState<BotAccount[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [error, setError] = useState<DataSourceError | null>(null);

  const fetchBots = useCallback(async () => {
    try {
      setConnectionState("connecting");
      setError(null);

      const data = await liveFetch<{ bots: BotAccount[] }>(
        API.social.bots(),
        "SOCIAL_BOTS"
      );

      setBots(data.bots);
      setConnectionState("connected");
    } catch (err) {
      if (err instanceof ConnectionError) {
        setError(err.toDataSourceError());
      } else {
        setError({
          source: "SOCIAL_BOTS",
          code: "UNKNOWN",
          message: String(err),
          timestamp: new Date(),
        });
      }
      setConnectionState("error");
    }
  }, []);

  useEffect(() => {
    fetchBots();
    
    // Poll every 30 seconds
    const interval = setInterval(fetchBots, 30000);
    return () => clearInterval(interval);
  }, [fetchBots]);

  return {
    bots,
    connectionState,
    error,
    retry: fetchBots,
    isConnected: connectionState === "connected",
  };
}

// ============================================
// HOOK - RECENT POSTS
// ============================================

export function useLivePosts() {
  const [posts, setPosts] = useState<RecentPost[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [error, setError] = useState<DataSourceError | null>(null);

  const fetchPosts = useCallback(async () => {
    try {
      setConnectionState("connecting");
      setError(null);

      const data = await liveFetch<{ posts: RecentPost[] }>(
        API.social.posts(),
        "SOCIAL_POSTS"
      );

      setPosts(data.posts);
      setConnectionState("connected");
    } catch (err) {
      if (err instanceof ConnectionError) {
        setError(err.toDataSourceError());
      } else {
        setError({
          source: "SOCIAL_POSTS",
          code: "UNKNOWN",
          message: String(err),
          timestamp: new Date(),
        });
      }
      setConnectionState("error");
    }
  }, []);

  useEffect(() => {
    fetchPosts();
    
    // Poll every 15 seconds
    const interval = setInterval(fetchPosts, 15000);
    return () => clearInterval(interval);
  }, [fetchPosts]);

  return {
    posts,
    connectionState,
    error,
    retry: fetchPosts,
    isConnected: connectionState === "connected",
  };
}
