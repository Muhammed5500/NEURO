"use client";

/**
 * TrendIntelligenceGrid - LIVE DATA ONLY
 * 
 * Connects to real Scout/Macro agent data feeds.
 * NO MOCK DATA - shows error/disconnected state if backend unavailable.
 */

import {
  TrendingUp,
  Flame,
  Zap,
  Hash,
  MessageCircle,
  BarChart3,
  ArrowUp,
  ArrowDown,
  Sparkles,
  Target,
} from "lucide-react";
import { useLiveTrends, type TrendKeyword, type SentimentData } from "@/hooks/use-live-trends";
import { ConnectionErrorDisplay, DisconnectedDisplay, LoadingDisplay } from "@/components/error";
import { ErrorBoundary } from "@/components/error";
import { useState } from "react";

// ============================================
// COMPONENT
// ============================================

function TrendIntelligenceGridContent() {
  const {
    keywords,
    sentiment,
    connectionState,
    error,
    lastUpdate,
    retry,
    isConnected,
    isLoading,
  } = useLiveTrends();

  const [selectedKeyword, setSelectedKeyword] = useState<string | null>(null);

  const getSentimentColor = (value: number) => {
    if (value >= 0.6) return "text-neon-green";
    if (value >= 0.3) return "text-cyber-yellow";
    if (value >= 0) return "text-gray-400";
    return "text-cyber-red";
  };

  const getVelocityIcon = (velocity: number) => {
    if (velocity > 100) return <Flame className="w-4 h-4 text-cyber-red animate-pulse" />;
    if (velocity > 50) return <Zap className="w-4 h-4 text-cyber-yellow" />;
    return <TrendingUp className="w-4 h-4 text-cyber-purple" />;
  };

  // Show error state
  if (error) {
    return (
      <div className="cyber-card p-6">
        <ConnectionErrorDisplay error={error} onRetry={retry} />
      </div>
    );
  }

  // Show loading state
  if (isLoading) {
    return (
      <div className="cyber-card p-6">
        <LoadingDisplay source="Trend Intelligence" />
      </div>
    );
  }

  // Show disconnected state
  if (connectionState === "disconnected") {
    return (
      <div className="cyber-card p-6">
        <DisconnectedDisplay source="Trend Intelligence" onConnect={retry} />
      </div>
    );
  }

  return (
    <div className="cyber-card p-6 relative overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Target className="w-6 h-6 text-neon-green" />
            {isConnected && (
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-neon-green rounded-full animate-ping" />
            )}
          </div>
          <div>
            <h2 className="text-lg font-display font-bold text-white">
              TREND INTELLIGENCE
            </h2>
            <p className="text-xs text-gray-500 font-mono">
              SCOUT + MACRO AGENT DATA FEED
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 text-xs font-mono rounded border ${
            isConnected 
              ? "bg-neon-green/20 text-neon-green border-neon-green/30"
              : "bg-cyber-red/20 text-cyber-red border-cyber-red/30"
          }`}>
            {isConnected ? "LIVE" : "DISCONNECTED"}
          </span>
          {lastUpdate && (
            <span className="text-xs text-gray-600">
              {lastUpdate.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-12 gap-4">
        {/* Hot Keywords Panel - 8 columns */}
        <div className="col-span-8">
          <div className="flex items-center gap-2 mb-3">
            <Hash className="w-4 h-4 text-cyber-pink" />
            <span className="text-sm font-bold text-white">HOT KEYWORDS</span>
          </div>

          {keywords.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <Hash className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No trending keywords detected</p>
              <p className="text-xs mt-1">Waiting for data from agents...</p>
            </div>
          ) : (
            <div className="space-y-2">
              {keywords
                .sort((a, b) => b.velocity - a.velocity)
                .slice(0, 5)
                .map((kw, index) => (
                  <KeywordCard
                    key={kw.id}
                    keyword={kw}
                    rank={index + 1}
                    isSelected={selectedKeyword === kw.id}
                    onSelect={() => setSelectedKeyword(selectedKeyword === kw.id ? null : kw.id)}
                    getSentimentColor={getSentimentColor}
                    getVelocityIcon={getVelocityIcon}
                  />
                ))}
            </div>
          )}
        </div>

        {/* Sentiment Overview - 4 columns */}
        <div className="col-span-4 space-y-4">
          <SentimentPanel sentiment={sentiment} getSentimentColor={getSentimentColor} />
        </div>
      </div>
    </div>
  );
}

// ============================================
// SUB-COMPONENTS
// ============================================

interface KeywordCardProps {
  keyword: TrendKeyword;
  rank: number;
  isSelected: boolean;
  onSelect: () => void;
  getSentimentColor: (v: number) => string;
  getVelocityIcon: (v: number) => React.ReactNode;
}

function KeywordCard({
  keyword: kw,
  rank,
  isSelected,
  onSelect,
  getSentimentColor,
  getVelocityIcon,
}: KeywordCardProps) {
  return (
    <div
      onClick={onSelect}
      className={`
        p-3 rounded-lg border cursor-pointer transition-all
        ${isSelected
          ? "bg-cyber-purple/20 border-cyber-purple"
          : "bg-cyber-gray/30 border-cyber-purple/20 hover:border-cyber-purple/50"
        }
      `}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-gray-600">
            #{rank}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-white">
                {kw.keyword}
              </span>
              {getVelocityIcon(kw.velocity)}
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs">
              <span className="text-gray-500">
                {kw.mentions.toLocaleString()} mentions
              </span>
              <span
                className={`flex items-center gap-1 ${
                  kw.mentionsDelta >= 0 ? "text-neon-green" : "text-cyber-red"
                }`}
              >
                {kw.mentionsDelta >= 0 ? (
                  <ArrowUp className="w-3 h-3" />
                ) : (
                  <ArrowDown className="w-3 h-3" />
                )}
                {Math.abs(kw.mentionsDelta).toLocaleString()}/hr
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Sentiment bar */}
          <div className="w-20">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-500">Sentiment</span>
              <span className={getSentimentColor(kw.sentiment)}>
                {(kw.sentiment * 100).toFixed(0)}%
              </span>
            </div>
            <div className="h-1.5 bg-cyber-gray rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  kw.sentiment >= 0.6
                    ? "bg-neon-green"
                    : kw.sentiment >= 0.3
                    ? "bg-cyber-yellow"
                    : "bg-cyber-red"
                }`}
                style={{ width: `${kw.sentiment * 100}%` }}
              />
            </div>
          </div>

          {/* Velocity */}
          <div className="text-right">
            <p className="text-xs text-gray-500">Velocity</p>
            <p className="font-mono font-bold text-cyber-cyan">
              {kw.velocity}x
            </p>
          </div>
        </div>
      </div>

      {/* Expanded info */}
      {isSelected && (
        <div className="mt-3 pt-3 border-t border-cyber-purple/20 grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-gray-500">Source</p>
            <p className="text-white uppercase">{kw.source}</p>
          </div>
          <div>
            <p className="text-gray-500">First Seen</p>
            <p className="text-white">
              {new Date(kw.firstSeen).toLocaleTimeString()}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Related</p>
            <p className="text-cyber-purple font-mono">
              {kw.relatedTickers.length > 0
                ? kw.relatedTickers.join(", ")
                : "None detected"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

interface SentimentPanelProps {
  sentiment: SentimentData | null;
  getSentimentColor: (v: number) => string;
}

function SentimentPanel({ sentiment, getSentimentColor }: SentimentPanelProps) {
  if (!sentiment) {
    return (
      <div className="p-4 bg-cyber-gray/30 rounded-lg border border-cyber-purple/20">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="w-4 h-4 text-cyber-cyan" />
          <span className="text-sm font-bold text-white">MARKET SENTIMENT</span>
        </div>
        <div className="text-center py-4 text-gray-500">
          <p>No sentiment data</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Overall Sentiment */}
      <div className="p-4 bg-cyber-gray/30 rounded-lg border border-cyber-purple/20">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="w-4 h-4 text-cyber-cyan" />
          <span className="text-sm font-bold text-white">MARKET SENTIMENT</span>
        </div>

        <div className="text-center mb-4">
          <p className={`text-4xl font-bold font-mono ${getSentimentColor(sentiment.overall)}`}>
            {(sentiment.overall * 100).toFixed(0)}%
          </p>
          <p className="text-xs text-gray-500 mt-1">OVERALL BULLISH SIGNAL</p>
        </div>

        {/* Breakdown */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-neon-green">Bullish</span>
            <span className="font-mono text-white">{sentiment.bullish}%</span>
          </div>
          <div className="h-2 bg-cyber-gray rounded-full overflow-hidden">
            <div className="h-full bg-neon-green" style={{ width: `${sentiment.bullish}%` }} />
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-cyber-red">Bearish</span>
            <span className="font-mono text-white">{sentiment.bearish}%</span>
          </div>
          <div className="h-2 bg-cyber-gray rounded-full overflow-hidden">
            <div className="h-full bg-cyber-red" style={{ width: `${sentiment.bearish}%` }} />
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Neutral</span>
            <span className="font-mono text-white">{sentiment.neutral}%</span>
          </div>
        </div>
      </div>

      {/* Social Volume */}
      <div className="p-4 bg-cyber-gray/30 rounded-lg border border-cyber-purple/20">
        <div className="flex items-center gap-2 mb-2">
          <MessageCircle className="w-4 h-4 text-cyber-pink" />
          <span className="text-sm font-bold text-white">SOCIAL VOLUME</span>
        </div>
        <p className="text-3xl font-bold font-mono text-white">
          {sentiment.volume.toLocaleString()}
        </p>
        <p className="text-xs text-gray-500">Posts in last 24h</p>
      </div>

      {/* Quick Action */}
      <button className="w-full p-4 bg-gradient-to-r from-cyber-purple/20 to-cyber-pink/20 border border-cyber-purple/50 rounded-lg hover:from-cyber-purple/30 hover:to-cyber-pink/30 transition-all group">
        <div className="flex items-center justify-center gap-2">
          <Sparkles className="w-5 h-5 text-cyber-purple group-hover:text-cyber-pink transition-colors" />
          <span className="font-bold text-white">ANALYZE OPPORTUNITY</span>
        </div>
        <p className="text-xs text-gray-500 mt-1">Deploy agents on selected trend</p>
      </button>
    </>
  );
}

// ============================================
// EXPORT WITH ERROR BOUNDARY
// ============================================

export function TrendIntelligenceGrid() {
  return (
    <ErrorBoundary>
      <TrendIntelligenceGridContent />
    </ErrorBoundary>
  );
}
