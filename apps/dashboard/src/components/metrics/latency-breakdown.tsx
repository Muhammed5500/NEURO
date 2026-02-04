"use client";

/**
 * Latency Breakdown Component
 * 
 * Shows latency breakdown by phase with live updates
 * Acceptance criteria: "Panel updates live during runs"
 */

import { memo } from "react";
import { motion } from "framer-motion";
import {
  Timer,
  Download,
  Brain,
  MessageSquare,
  FileText,
  Play,
  Upload,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SourceBadge } from "./source-badge";
import type { LatencyStats, LatencyPhase } from "@/types/metrics";

interface LatencyBreakdownProps {
  stats: Record<LatencyPhase, LatencyStats | null>;
  className?: string;
}

const PHASE_CONFIG: Record<LatencyPhase, { icon: React.ElementType; label: string; color: string }> = {
  ingestion: { icon: Download, label: "Ingestion", color: "text-cyber-cyan" },
  embedding: { icon: Brain, label: "Embedding", color: "text-cyber-purple" },
  agent_analysis: { icon: Brain, label: "Agent Analysis", color: "text-neon-purple" },
  consensus: { icon: MessageSquare, label: "Consensus", color: "text-neon-green" },
  planning: { icon: FileText, label: "Planning", color: "text-cyber-yellow" },
  simulation: { icon: Play, label: "Simulation", color: "text-cyber-pink" },
  submission: { icon: Upload, label: "Submission", color: "text-orange-400" },
  mempool: { icon: Timer, label: "Mempool", color: "text-cyan-400" },
  execution: { icon: CheckCircle2, label: "Execution", color: "text-neon-green" },
  finality: { icon: CheckCircle2, label: "Finality", color: "text-green-400" },
};

const TREND_ICONS = {
  improving: { icon: TrendingDown, color: "text-neon-green", label: "Improving" },
  stable: { icon: Minus, color: "text-cyber-gray", label: "Stable" },
  degrading: { icon: TrendingUp, color: "text-cyber-red", label: "Degrading" },
};

export const LatencyBreakdown = memo(function LatencyBreakdown({
  stats,
  className,
}: LatencyBreakdownProps) {
  // Filter to only show phases with data
  const activePhases = Object.entries(stats)
    .filter(([_, s]) => s !== null && s.count > 0) as [LatencyPhase, LatencyStats][];

  // Calculate total
  const totalAvgMs = activePhases.reduce((sum, [_, s]) => sum + s.avgMs, 0);

  return (
    <div className={cn("cyber-card p-6", className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Timer className="w-5 h-5 text-cyber-yellow" />
          <h3 className="font-display font-bold text-lg">LATENCY BREAKDOWN</h3>
        </div>
        <div className="text-sm text-cyber-gray">
          Total: <span className="text-white font-mono">{totalAvgMs.toFixed(0)}ms</span>
        </div>
      </div>

      {activePhases.length === 0 ? (
        <div className="text-center py-8 text-cyber-gray">
          <Timer className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No latency data yet</p>
          <p className="text-sm mt-1">Measurements will appear during runs</p>
        </div>
      ) : (
        <div className="space-y-4">
          {activePhases.map(([phase, stat]) => {
            const config = PHASE_CONFIG[phase];
            const trend = TREND_ICONS[stat.trend];
            const percentOfTotal = totalAvgMs > 0 ? (stat.avgMs / totalAvgMs) * 100 : 0;

            return (
              <div key={phase} className="space-y-2">
                {/* Phase header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <config.icon className={cn("w-4 h-4", config.color)} />
                    <span className="text-sm font-medium">{config.label}</span>
                    <SourceBadge source={stat.source} />
                  </div>
                  <div className="flex items-center gap-3">
                    <trend.icon className={cn("w-3 h-3", trend.color)} />
                    <span className="text-sm font-mono text-white">
                      {stat.avgMs.toFixed(0)}ms
                    </span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="relative h-2 bg-cyber-dark rounded-full overflow-hidden">
                  <motion.div
                    className={cn(
                      "h-full rounded-full",
                      stat.avgMs < 100 ? "bg-neon-green" :
                      stat.avgMs < 500 ? "bg-cyber-cyan" :
                      stat.avgMs < 1000 ? "bg-cyber-yellow" :
                      "bg-cyber-red"
                    )}
                    initial={{ width: 0 }}
                    animate={{ width: `${percentOfTotal}%` }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                  />
                </div>

                {/* Stats row */}
                <div className="flex items-center justify-between text-xs text-cyber-gray">
                  <span>Min: {stat.minMs.toFixed(0)}ms</span>
                  <span>P50: {stat.p50Ms.toFixed(0)}ms</span>
                  <span>P95: {stat.p95Ms.toFixed(0)}ms</span>
                  <span>Max: {stat.maxMs.toFixed(0)}ms</span>
                  <span className={trend.color}>{trend.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      <div className="mt-6 pt-4 border-t border-cyber-gray/30">
        <div className="flex items-center justify-center gap-4 text-xs text-cyber-gray">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-neon-green" />
            <span>&lt;100ms</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-cyber-cyan" />
            <span>&lt;500ms</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-cyber-yellow" />
            <span>&lt;1s</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-cyber-red" />
            <span>&gt;1s</span>
          </div>
        </div>
      </div>
    </div>
  );
});
