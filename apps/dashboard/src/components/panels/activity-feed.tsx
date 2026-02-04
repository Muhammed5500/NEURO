"use client";

/**
 * ActivityFeed - LIVE DATA ONLY
 * 
 * Shows real agent events from SSE stream.
 * NO MOCK DATA - shows DISCONNECTED if no data.
 */

import {
  Activity,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Bot,
  Rocket,
  Twitter,
  TrendingUp,
  Target,
  Zap,
  WifiOff,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useAgentStream } from "@/hooks/use-agent-stream";
import { ErrorBoundary } from "@/components/error";
import { useEffect, useState } from "react";
import type { AgentEvent } from "@/types/agent-events";

// ============================================
// HELPERS
// ============================================

const eventIcons: Record<string, React.ElementType> = {
  deployment: Rocket,
  campaign: Twitter,
  viral: Zap,
  trend: Target,
  decision: Bot,
  graduation: TrendingUp,
  rejection: XCircle,
  approval: CheckCircle,
  alert: AlertTriangle,
};

const eventColors: Record<string, string> = {
  deployment: "text-cyber-pink",
  campaign: "text-cyber-cyan",
  viral: "text-neon-green",
  trend: "text-cyber-yellow",
  decision: "text-cyber-purple",
  graduation: "text-neon-green",
  rejection: "text-cyber-red",
  approval: "text-neon-green",
  alert: "text-cyber-yellow",
};

// ============================================
// COMPONENT
// ============================================

function ActivityFeedContent() {
  const {
    events,
    status,
    connect,
    isConnected,
    eventCount,
  } = useAgentStream({ autoConnect: true });

  // Map agent events to activity items
  const activities = events.slice(0, 20).map((event) => ({
    id: event.id,
    type: getActivityType(event),
    title: getActivityTitle(event),
    description: event.content || event.data?.message || "Agent activity",
    timestamp: new Date(event.timestamp),
    confidence: event.data?.confidence,
    token: event.data?.token || event.data?.symbol,
  }));

  return (
    <div className="cyber-card p-6 h-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-display font-bold text-white flex items-center gap-2">
          <Activity className="w-5 h-5 text-cyber-pink" />
          LIVE FEED
        </h2>
        <div className="flex items-center gap-2">
          {isConnected ? (
            <span className="flex items-center gap-1 text-xs text-neon-green">
              <span className="w-2 h-2 rounded-full bg-neon-green animate-pulse" />
              STREAMING ({eventCount})
            </span>
          ) : status === "connecting" ? (
            <span className="flex items-center gap-1 text-xs text-cyber-yellow">
              <span className="w-2 h-2 rounded-full bg-cyber-yellow animate-pulse" />
              CONNECTING...
            </span>
          ) : (
            <button
              onClick={connect}
              className="flex items-center gap-1 text-xs text-cyber-red hover:text-red-300"
            >
              <WifiOff className="w-3 h-3" />
              DISCONNECTED - Click to connect
            </button>
          )}
        </div>
      </div>

      {/* Show disconnected state */}
      {status === "error" || (status === "disconnected" && !isConnected) ? (
        <div className="flex flex-col items-center justify-center py-12">
          <WifiOff className="w-12 h-12 text-gray-600 mb-3" />
          <p className="text-gray-500">Stream disconnected</p>
          <button
            onClick={connect}
            className="mt-3 px-4 py-2 bg-cyber-purple/20 text-cyber-purple rounded border border-cyber-purple/30 hover:bg-cyber-purple/30 text-sm"
          >
            Reconnect
          </button>
        </div>
      ) : activities.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Activity className="w-12 h-12 text-gray-600 mb-3 animate-pulse" />
          <p className="text-gray-500">Waiting for events...</p>
          <p className="text-xs text-gray-600 mt-1">
            Connected to agent stream
          </p>
        </div>
      ) : (
        <div className="space-y-3 max-h-[500px] overflow-y-auto scrollbar-thin scrollbar-thumb-cyber-purple/50 scrollbar-track-transparent">
          {activities.map((activity, index) => {
            const Icon = eventIcons[activity.type] || Activity;
            const colorClass = eventColors[activity.type] || "text-gray-400";

            return (
              <div
                key={activity.id}
                className={`
                  flex items-start gap-3 p-3 bg-cyber-gray/30 rounded-lg border border-cyber-purple/10 
                  hover:border-cyber-purple/30 transition-all
                  ${index === 0 ? "animate-pulse-once border-neon-green/30" : ""}
                `}
              >
                <div className={`p-2 rounded-lg bg-cyber-black/50 ${colorClass}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white truncate">
                      {activity.title}
                    </p>
                    {activity.token && (
                      <span className="text-xs font-mono text-cyber-cyan bg-cyber-cyan/10 px-1.5 py-0.5 rounded">
                        ${activity.token}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 truncate mt-0.5">
                    {activity.description}
                  </p>
                  {activity.confidence !== undefined && (
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-1 bg-cyber-gray rounded-full overflow-hidden max-w-20">
                        <div
                          className="h-full bg-cyber-purple"
                          style={{ width: `${activity.confidence * 100}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-gray-500">
                        {(activity.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                  )}
                </div>
                <span className="text-xs text-gray-600 whitespace-nowrap">
                  {formatDistanceToNow(activity.timestamp, { addSuffix: true })}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function getActivityType(event: AgentEvent): string {
  // Map event types to activity types
  const typeMap: Record<string, string> = {
    agent_thinking: "decision",
    agent_decision: "decision",
    consensus_reached: "approval",
    operation_approved: "approval",
    operation_rejected: "rejection",
    deployment_started: "deployment",
    campaign_started: "campaign",
    trend_detected: "trend",
    viral_alert: "viral",
    graduation: "graduation",
  };

  return typeMap[event.type] || event.data?.activityType || "decision";
}

function getActivityTitle(event: AgentEvent): string {
  // Map events to titles
  const titleMap: Record<string, string> = {
    agent_thinking: `${event.agent || "Agent"} Thinking`,
    agent_decision: `${event.agent || "Agent"} Decision`,
    consensus_reached: "Consensus Reached",
    operation_approved: "Operation Approved",
    operation_rejected: "Operation Rejected",
    deployment_started: "Deployment Started",
    campaign_started: "Campaign Started",
    trend_detected: "Trend Detected",
    viral_alert: "Viral Alert",
    graduation: "Token Graduated!",
  };

  return titleMap[event.type] || event.data?.title || "Agent Activity";
}

// ============================================
// EXPORT WITH ERROR BOUNDARY
// ============================================

export function ActivityFeed() {
  return (
    <ErrorBoundary>
      <ActivityFeedContent />
    </ErrorBoundary>
  );
}
