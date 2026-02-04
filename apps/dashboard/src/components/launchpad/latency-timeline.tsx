"use client";

/**
 * LatencyTimeline - LIVE DATA ONLY
 * 
 * Measures ACTUAL latency from real API calls.
 * Shows DISCONNECTED if services are unavailable.
 */

import {
  Zap,
  Clock,
  Activity,
  CheckCircle,
  ArrowRight,
  Gauge,
  Database,
  Brain,
  Send,
  XCircle,
} from "lucide-react";
import { useLivePipelineMetrics, useLiveChainMetrics } from "@/hooks/use-live-metrics";
import { ConnectionErrorDisplay, DisconnectedDisplay, LoadingDisplay } from "@/components/error";
import { ErrorBoundary } from "@/components/error";

// ============================================
// CONSTANTS
// ============================================

const MONAD_FINALITY = 400; // ms
const REFERENCE_ETH_FINALITY = 12000; // 12 seconds

// ============================================
// COMPONENT
// ============================================

function LatencyTimelineContent() {
  const {
    stages,
    totalLatency,
    connectionState,
    error,
    retry,
    isConnected,
  } = useLivePipelineMetrics();

  const { metrics: chainMetrics, error: chainError } = useLiveChainMetrics();

  // Show error state
  if (error && connectionState === "error") {
    return (
      <div className="cyber-card p-6">
        <ConnectionErrorDisplay error={error} onRetry={retry} />
      </div>
    );
  }

  // Show disconnected
  if (connectionState === "disconnected") {
    return (
      <div className="cyber-card p-6">
        <DisconnectedDisplay source="Pipeline Metrics" onConnect={retry} />
      </div>
    );
  }

  const stageIcons: Record<string, React.ElementType> = {
    orchestrator: Brain,
    ingestion: Database,
    execution: Send,
    finality: CheckCircle,
  };

  const getStageColor = (status: string) => {
    switch (status) {
      case "measuring":
        return "border-cyber-yellow bg-cyber-yellow/20 animate-pulse";
      case "connected":
        return "border-neon-green bg-neon-green/20";
      case "error":
        return "border-cyber-red bg-cyber-red/20";
      default:
        return "border-gray-600 bg-cyber-gray/30";
    }
  };

  const totalPipelineTarget = stages.reduce((acc, s) => acc + (s.avgLatency || 100), 0);
  const actualTotal = totalLatency || 0;
  const ethSavings = REFERENCE_ETH_FINALITY - actualTotal;
  const ethSavingsPercent = actualTotal > 0 ? ((ethSavings / REFERENCE_ETH_FINALITY) * 100).toFixed(1) : "0";

  return (
    <div className="cyber-card p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-neon-green/20 rounded-lg border border-neon-green/30">
            <Zap className="w-5 h-5 text-neon-green" />
          </div>
          <div>
            <h2 className="text-lg font-display font-bold text-white">
              LATENCY TIMELINE
            </h2>
            <p className="text-xs text-gray-500 font-mono">
              MONAD EXECUTION PIPELINE - LIVE MEASUREMENTS
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs text-gray-500">MONAD TARGET</p>
            <p className="text-xl font-bold font-mono text-neon-green">
              {MONAD_FINALITY}ms
            </p>
          </div>
          <span className={`px-2 py-1 text-xs font-mono rounded border ${
            isConnected
              ? "bg-neon-green/20 text-neon-green border-neon-green/30"
              : "bg-cyber-red/20 text-cyber-red border-cyber-red/30"
          }`}>
            {isConnected ? "● MEASURING" : "○ OFFLINE"}
          </span>
        </div>
      </div>

      {/* Pipeline Visualization */}
      <div className="mb-6">
        <div className="flex items-center justify-between gap-2">
          {stages.map((stage, idx) => {
            const Icon = stageIcons[stage.id] || Activity;
            return (
              <div key={stage.id} className="flex items-center flex-1">
                {/* Stage Node */}
                <div className="flex flex-col items-center flex-1">
                  <div
                    className={`
                      w-12 h-12 rounded-full border-2 flex items-center justify-center
                      transition-all duration-300 ${getStageColor(stage.status)}
                    `}
                  >
                    {stage.status === "error" ? (
                      <XCircle className="w-5 h-5 text-cyber-red" />
                    ) : (
                      <Icon
                        className={`w-5 h-5 ${
                          stage.status === "connected"
                            ? "text-neon-green"
                            : stage.status === "measuring"
                            ? "text-cyber-yellow"
                            : "text-gray-500"
                        }`}
                      />
                    )}
                  </div>
                  <p className="text-[10px] font-mono text-gray-500 mt-1">
                    {stage.name}
                  </p>
                  <p
                    className={`text-sm font-mono ${
                      stage.status === "error"
                        ? "text-cyber-red"
                        : stage.status === "connected"
                        ? "text-cyber-cyan"
                        : stage.status === "measuring"
                        ? "text-cyber-yellow animate-pulse"
                        : "text-gray-600"
                    }`}
                  >
                    {stage.status === "error"
                      ? stage.error || "ERR"
                      : stage.currentLatency !== null
                      ? `${stage.currentLatency}ms`
                      : "---"}
                  </p>
                </div>

                {/* Connector */}
                {idx < stages.length - 1 && (
                  <div className="flex items-center px-1">
                    <div
                      className={`h-0.5 w-8 transition-colors ${
                        stages[idx + 1].status === "connected"
                          ? "bg-gradient-to-r from-cyber-purple to-neon-green"
                          : "bg-gray-700"
                      }`}
                    />
                    <ArrowRight
                      className={`w-4 h-4 ${
                        stages[idx + 1].status === "connected"
                          ? "text-neon-green"
                          : "text-gray-700"
                      }`}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Total Progress Bar */}
        <div className="mt-4 pt-4 border-t border-cyber-purple/20">
          <div className="flex justify-between text-xs mb-2">
            <span className="text-gray-500">TOTAL PIPELINE LATENCY</span>
            <span className={totalLatency ? "text-neon-green font-mono" : "text-cyber-red font-mono"}>
              {totalLatency !== null ? `${totalLatency}ms` : "DISCONNECTED"}
            </span>
          </div>
          <div className="h-3 bg-cyber-gray rounded-full overflow-hidden relative">
            {totalLatency !== null && (
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-cyber-purple via-neon-green to-cyber-cyan transition-all duration-300"
                style={{ width: `${Math.min((totalLatency / totalPipelineTarget) * 100, 100)}%` }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Comparison Stats */}
      <div className="grid grid-cols-3 gap-4">
        {/* Monad */}
        <div className="p-4 bg-gradient-to-br from-neon-green/10 to-cyber-purple/10 rounded-lg border border-neon-green/30">
          <div className="flex items-center gap-2 mb-2">
            <Gauge className="w-4 h-4 text-neon-green" />
            <span className="text-xs font-bold text-white">MONAD</span>
            <span className="text-[10px] text-neon-green bg-neon-green/20 px-1.5 py-0.5 rounded">
              [MEASURED]
            </span>
          </div>
          <p className={`text-3xl font-bold font-mono ${
            chainMetrics.connected ? "text-neon-green" : "text-cyber-red"
          }`}>
            {chainMetrics.finality !== null ? `${chainMetrics.finality}ms` : "---"}
          </p>
          <p className="text-xs text-gray-500">RPC Latency</p>
          <div className="mt-2 pt-2 border-t border-neon-green/20">
            {chainMetrics.connected ? (
              <p className="text-xs text-gray-400">
                Block #{chainMetrics.blockNumber?.toLocaleString() || "---"}
              </p>
            ) : (
              <p className="text-xs text-cyber-red">RPC Disconnected</p>
            )}
          </div>
        </div>

        {/* Ethereum Reference */}
        <div className="p-4 bg-cyber-gray/30 rounded-lg border border-cyber-purple/20">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-gray-500" />
            <span className="text-xs font-bold text-white">ETHEREUM</span>
            <span className="text-[10px] text-gray-500 bg-cyber-gray/50 px-1.5 py-0.5 rounded">
              [CONFIG-REF]
            </span>
          </div>
          <p className="text-3xl font-bold font-mono text-gray-500">
            {(REFERENCE_ETH_FINALITY / 1000).toFixed(0)}s
          </p>
          <p className="text-xs text-gray-500">Block Finality</p>
          <div className="mt-2 pt-2 border-t border-cyber-purple/20">
            <p className="text-xs text-cyber-red">
              {ethSavingsPercent}% slower
            </p>
          </div>
        </div>

        {/* Savings */}
        <div className="p-4 bg-gradient-to-br from-cyber-pink/10 to-cyber-purple/10 rounded-lg border border-cyber-pink/30">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-cyber-pink" />
            <span className="text-xs font-bold text-white">ADVANTAGE</span>
          </div>
          <p className={`text-3xl font-bold font-mono ${
            actualTotal > 0 ? "text-cyber-pink" : "text-gray-600"
          }`}>
            {actualTotal > 0 ? `${(ethSavings / 1000).toFixed(1)}s` : "---"}
          </p>
          <p className="text-xs text-gray-500">Time Saved vs ETH</p>
          <div className="mt-2 pt-2 border-t border-cyber-pink/20">
            <p className="text-xs text-neon-green">
              {chainMetrics.gasPrice !== null
                ? `Gas: ${chainMetrics.gasPrice.toFixed(3)} gwei`
                : "Gas: ---"}
            </p>
          </div>
        </div>
      </div>

      {/* Chain Error Display */}
      {chainError && (
        <div className="mt-4 p-3 bg-cyber-red/20 border border-cyber-red/50 rounded text-sm">
          <span className="text-cyber-red font-mono">[MONAD_RPC]</span>
          <span className="text-red-300 ml-2">{chainError.message}</span>
        </div>
      )}
    </div>
  );
}

// ============================================
// EXPORT WITH ERROR BOUNDARY
// ============================================

export function LatencyTimeline() {
  return (
    <ErrorBoundary>
      <LatencyTimelineContent />
    </ErrorBoundary>
  );
}
