"use client";

/**
 * SocialImpactMonitor - LIVE DATA ONLY
 * 
 * Connects to real social bot API for engagement metrics.
 * NO MOCK DATA - shows error/disconnected state if API unavailable.
 */

import { useState } from "react";
import {
  Twitter,
  MessageCircle,
  Heart,
  Repeat,
  Eye,
  Zap,
  BarChart3,
  Bot,
  ExternalLink,
} from "lucide-react";
import { useLiveSocialMetrics, useLivePosts, type RecentPost } from "@/hooks/use-live-social";
import { ConnectionErrorDisplay, DisconnectedDisplay, LoadingDisplay } from "@/components/error";
import { ErrorBoundary } from "@/components/error";

// ============================================
// COMPONENT
// ============================================

function SocialImpactMonitorContent() {
  const {
    metrics,
    connectionState: metricsState,
    error: metricsError,
    retry: retryMetrics,
    isConnected: metricsConnected,
  } = useLiveSocialMetrics();

  const {
    posts,
    connectionState: postsState,
    error: postsError,
    retry: retryPosts,
  } = useLivePosts();

  const [activeTab, setActiveTab] = useState<"overview" | "posts">("overview");

  // Show error if metrics failed
  if (metricsError) {
    return (
      <div className="cyber-card p-6">
        <ConnectionErrorDisplay error={metricsError} onRetry={retryMetrics} />
      </div>
    );
  }

  // Show loading
  if (metricsState === "connecting") {
    return (
      <div className="cyber-card p-6">
        <LoadingDisplay source="Social Metrics" />
      </div>
    );
  }

  // Show disconnected
  if (metricsState === "disconnected" || !metrics) {
    return (
      <div className="cyber-card p-6">
        <DisconnectedDisplay source="Social Metrics" onConnect={retryMetrics} />
      </div>
    );
  }

  const getKFactorColor = (k: number) => {
    if (k >= 2) return "text-neon-green";
    if (k >= 1) return "text-cyber-yellow";
    return "text-cyber-red";
  };

  const getKFactorLabel = (k: number) => {
    if (k >= 2) return "VIRAL";
    if (k >= 1) return "GROWING";
    return "DECLINING";
  };

  return (
    <div className="cyber-card p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-cyber-cyan/20 rounded-lg border border-cyber-cyan/30 relative">
            <Twitter className="w-5 h-5 text-cyber-cyan" />
            {metricsConnected && (
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-neon-green rounded-full animate-pulse" />
            )}
          </div>
          <div>
            <h2 className="text-lg font-display font-bold text-white">
              SOCIAL IMPACT MONITOR
            </h2>
            <p className="text-xs text-gray-500 font-mono">
              BOT NETWORK PERFORMANCE METRICS
            </p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-cyber-gray/50 rounded-lg p-1">
          <button
            onClick={() => setActiveTab("overview")}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              activeTab === "overview"
                ? "bg-cyber-purple text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab("posts")}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              activeTab === "posts"
                ? "bg-cyber-purple text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            Recent Posts
          </button>
        </div>
      </div>

      {activeTab === "overview" ? (
        <>
          {/* K-Factor Hero */}
          <div className="mb-6 p-4 bg-gradient-to-r from-cyber-purple/20 to-cyber-pink/20 rounded-lg border border-cyber-purple/30">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                  <Zap className="w-3 h-3" />
                  VIRAL COEFFICIENT (K-FACTOR)
                </p>
                <div className="flex items-baseline gap-2">
                  <p className={`text-5xl font-bold font-mono ${getKFactorColor(metrics.kFactor)}`}>
                    {metrics.kFactor.toFixed(2)}
                  </p>
                  <span className={`text-sm px-2 py-0.5 rounded ${getKFactorColor(metrics.kFactor)} bg-current/20`}>
                    {getKFactorLabel(metrics.kFactor)}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Each user brings {metrics.kFactor.toFixed(1)} new users on average
                </p>
              </div>
              <div className="text-right">
                <div className="flex items-center gap-2 mb-2">
                  <Bot className="w-4 h-4 text-cyber-purple" />
                  <span className="text-sm text-gray-400">Active Bots</span>
                </div>
                <p className="text-3xl font-bold font-mono text-cyber-purple">
                  {metrics.activeBots}
                </p>
                <p className="text-xs text-gray-500">
                  {metrics.queuedPosts} posts queued
                </p>
              </div>
            </div>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="p-4 bg-cyber-gray/30 rounded-lg border border-cyber-purple/20">
              <div className="flex items-center gap-2 text-cyber-cyan mb-2">
                <MessageCircle className="w-4 h-4" />
                <span className="text-xs">TOTAL TWEETS</span>
              </div>
              <p className="text-2xl font-bold font-mono text-white">
                {metrics.totalTweets.toLocaleString()}
              </p>
              <p className="text-xs text-gray-500">
                +{metrics.tweetsToday} today
              </p>
            </div>

            <div className="p-4 bg-cyber-gray/30 rounded-lg border border-cyber-purple/20">
              <div className="flex items-center gap-2 text-cyber-pink mb-2">
                <Heart className="w-4 h-4" />
                <span className="text-xs">TOTAL LIKES</span>
              </div>
              <p className="text-2xl font-bold font-mono text-white">
                {(metrics.likes / 1000).toFixed(1)}K
              </p>
            </div>

            <div className="p-4 bg-cyber-gray/30 rounded-lg border border-cyber-purple/20">
              <div className="flex items-center gap-2 text-neon-green mb-2">
                <Repeat className="w-4 h-4" />
                <span className="text-xs">RETWEETS</span>
              </div>
              <p className="text-2xl font-bold font-mono text-white">
                {(metrics.retweets / 1000).toFixed(1)}K
              </p>
            </div>

            <div className="p-4 bg-cyber-gray/30 rounded-lg border border-cyber-purple/20">
              <div className="flex items-center gap-2 text-cyber-yellow mb-2">
                <Eye className="w-4 h-4" />
                <span className="text-xs">IMPRESSIONS</span>
              </div>
              <p className="text-2xl font-bold font-mono text-white">
                {(metrics.impressions / 1000000).toFixed(2)}M
              </p>
            </div>
          </div>

          {/* Engagement Breakdown */}
          <div className="p-4 bg-cyber-gray/30 rounded-lg border border-cyber-purple/20">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-4 h-4 text-cyber-purple" />
              <span className="text-sm font-bold text-white">ENGAGEMENT BREAKDOWN</span>
            </div>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-500">Engagement Rate</span>
                  <span className="text-neon-green">{metrics.avgEngagementRate}%</span>
                </div>
                <div className="h-2 bg-cyber-gray rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-neon-green to-cyber-cyan transition-all"
                    style={{ width: `${Math.min(metrics.avgEngagementRate * 10, 100)}%` }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 mt-4 text-center">
                <div>
                  <p className="text-lg font-bold text-cyber-pink font-mono">
                    {((metrics.likes / metrics.totalEngagement) * 100).toFixed(0)}%
                  </p>
                  <p className="text-xs text-gray-500">Likes</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-neon-green font-mono">
                    {((metrics.retweets / metrics.totalEngagement) * 100).toFixed(0)}%
                  </p>
                  <p className="text-xs text-gray-500">Retweets</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-cyber-cyan font-mono">
                    {((metrics.replies / metrics.totalEngagement) * 100).toFixed(0)}%
                  </p>
                  <p className="text-xs text-gray-500">Replies</p>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        /* Recent Posts Tab */
        <PostsTab
          posts={posts}
          error={postsError}
          connectionState={postsState}
          onRetry={retryPosts}
        />
      )}
    </div>
  );
}

// ============================================
// SUB-COMPONENTS
// ============================================

interface PostsTabProps {
  posts: RecentPost[];
  error: ReturnType<typeof useLivePosts>["error"];
  connectionState: ReturnType<typeof useLivePosts>["connectionState"];
  onRetry: () => void;
}

function PostsTab({ posts, error, connectionState, onRetry }: PostsTabProps) {
  if (error) {
    return <ConnectionErrorDisplay error={error} onRetry={onRetry} compact />;
  }

  if (connectionState === "connecting") {
    return <LoadingDisplay source="Recent Posts" />;
  }

  if (posts.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p>No recent posts</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {posts.map((post) => (
        <div
          key={post.id}
          className="p-4 bg-cyber-gray/30 rounded-lg border border-cyber-purple/20"
        >
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-cyber-purple bg-cyber-purple/20 px-2 py-0.5 rounded">
                @{post.botHandle}
              </span>
              {post.status === "viral" && (
                <span className="text-xs font-mono text-neon-green bg-neon-green/20 px-2 py-0.5 rounded flex items-center gap-1">
                  <Zap className="w-3 h-3" />
                  VIRAL
                </span>
              )}
              {post.status === "flagged" && (
                <span className="text-xs font-mono text-cyber-red bg-cyber-red/20 px-2 py-0.5 rounded">
                  FLAGGED
                </span>
              )}
            </div>
            <span className="text-xs text-gray-500">
              {new Date(post.timestamp).toLocaleTimeString()}
            </span>
          </div>
          <p className="text-sm text-gray-300 mb-3">{post.content}</p>
          <div className="flex items-center gap-6 text-xs">
            <span className="flex items-center gap-1 text-cyber-pink">
              <Heart className="w-3 h-3" />
              {post.likes}
            </span>
            <span className="flex items-center gap-1 text-neon-green">
              <Repeat className="w-3 h-3" />
              {post.retweets}
            </span>
            <span className="flex items-center gap-1 text-cyber-cyan">
              <MessageCircle className="w-3 h-3" />
              {post.replies}
            </span>
            <span className="flex items-center gap-1 text-gray-500">
              <Eye className="w-3 h-3" />
              {(post.impressions / 1000).toFixed(1)}K
            </span>
            {post.url && (
              <a
                href={post.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-cyber-purple hover:text-cyber-pink ml-auto"
              >
                <ExternalLink className="w-3 h-3" />
                View
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================
// EXPORT WITH ERROR BOUNDARY
// ============================================

export function SocialImpactMonitor() {
  return (
    <ErrorBoundary>
      <SocialImpactMonitorContent />
    </ErrorBoundary>
  );
}
