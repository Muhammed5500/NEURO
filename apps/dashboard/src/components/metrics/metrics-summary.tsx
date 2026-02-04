"use client";

/**
 * Metrics Summary Component
 * 
 * Quick overview of key metrics with source labels
 * Turkish: "Her rakamın yanında [measured] veya [config-ref] etiketi olsun"
 */

import { memo } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  Clock,
  DollarSign,
  BarChart3,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SourceBadge } from "./source-badge";
import type { MetricsSummary as MetricsSummaryType } from "@/types/metrics";

interface MetricsSummaryProps {
  data: MetricsSummaryType;
  className?: string;
}

export const MetricsSummary = memo(function MetricsSummary({
  data,
  className,
}: MetricsSummaryProps) {
  return (
    <div className={cn("cyber-card p-6", className)}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-6">
        <Activity className="w-5 h-5 text-cyber-pink" />
        <h3 className="font-display font-bold text-lg">METRICS SUMMARY</h3>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Total Measurements */}
        <MetricCard
          icon={BarChart3}
          label="Measurements"
          value={data.totalMeasurements.toLocaleString()}
          source="measured"
          color="text-cyber-cyan"
        />

        {/* Avg Ingestion */}
        <MetricCard
          icon={Clock}
          label="Avg Ingestion"
          value={`${data.avgIngestionMs.value.toFixed(0)}ms`}
          source={data.avgIngestionMs.source}
          color="text-cyber-purple"
        />

        {/* Avg Consensus */}
        <MetricCard
          icon={Layers}
          label="Avg Consensus"
          value={`${data.avgConsensusMs.value.toFixed(0)}ms`}
          source={data.avgConsensusMs.source}
          color="text-neon-green"
        />

        {/* Avg Execution */}
        <MetricCard
          icon={Activity}
          label="Avg Execution"
          value={`${data.avgExecutionMs.value.toFixed(0)}ms`}
          source={data.avgExecutionMs.source}
          color="text-cyber-yellow"
        />

        {/* Estimated Savings */}
        <MetricCard
          icon={DollarSign}
          label="Est. Saved/Tx"
          value={`$${data.estimatedUsdSaved.value.toFixed(4)}`}
          source={data.estimatedUsdSaved.source}
          color="text-neon-green"
          highlight
        />
      </div>

      {/* Total latency bar */}
      <div className="mt-6 pt-4 border-t border-cyber-gray/30">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-cyber-gray">Average Total Run Time</span>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold font-mono">
              {data.avgTotalMs.value.toFixed(0)}ms
            </span>
            <SourceBadge source={data.avgTotalMs.source} />
          </div>
        </div>
        
        {/* Visual bar showing breakdown */}
        <div className="h-4 rounded-full overflow-hidden flex bg-cyber-dark">
          <motion.div
            className="bg-cyber-purple"
            style={{ width: `${(data.avgIngestionMs.value / data.avgTotalMs.value) * 100}%` }}
            title="Ingestion"
          />
          <motion.div
            className="bg-neon-green"
            style={{ width: `${(data.avgConsensusMs.value / data.avgTotalMs.value) * 100}%` }}
            title="Consensus"
          />
          <motion.div
            className="bg-cyber-yellow"
            style={{ width: `${(data.avgExecutionMs.value / data.avgTotalMs.value) * 100}%` }}
            title="Execution"
          />
          <motion.div
            className="bg-cyber-gray/50 flex-1"
            title="Other"
          />
        </div>
        
        <div className="flex items-center justify-center gap-4 mt-2 text-xs text-cyber-gray">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded bg-cyber-purple" />
            <span>Ingestion</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded bg-neon-green" />
            <span>Consensus</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded bg-cyber-yellow" />
            <span>Execution</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded bg-cyber-gray/50" />
            <span>Other</span>
          </div>
        </div>
      </div>
    </div>
  );
});

// ============================================
// HELPER COMPONENTS
// ============================================

interface MetricCardProps {
  icon: React.ElementType;
  label: string;
  value: string;
  source: "measured" | "config-ref" | "simulated" | "estimated";
  color: string;
  highlight?: boolean;
}

function MetricCard({ icon: Icon, label, value, source, color, highlight }: MetricCardProps) {
  return (
    <div className={cn(
      "bg-cyber-dark/50 rounded-lg p-3",
      highlight && "ring-1 ring-neon-green/50"
    )}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={cn("w-4 h-4", color)} />
        <span className="text-xs text-cyber-gray">{label}</span>
      </div>
      <div className="text-xl font-bold font-mono mb-1">{value}</div>
      <SourceBadge source={source} />
    </div>
  );
}
