"use client";

/**
 * Chain Comparison Panel
 * 
 * Compare Monad with reference chains showing time and cost savings
 * Turkish: "Monad'daki işlem başına tasarrufu 'USD cinsinden' büyük puntolarla göster"
 * Acceptance criteria: "All numbers cite their input sources"
 */

import { memo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Clock,
  Zap,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SourceBadge, SourcedValueDisplay } from "./source-badge";
import type { ChainComparison, ReferenceChain, AllChainComparisons } from "@/types/metrics";

interface ComparisonPanelProps {
  data: AllChainComparisons;
  className?: string;
}

const CHAIN_ICONS: Record<ReferenceChain, { color: string; shortName: string }> = {
  ethereum: { color: "text-blue-400", shortName: "ETH" },
  solana: { color: "text-purple-400", shortName: "SOL" },
  arbitrum: { color: "text-cyan-400", shortName: "ARB" },
  polygon: { color: "text-violet-400", shortName: "MATIC" },
  optimism: { color: "text-red-400", shortName: "OP" },
  base: { color: "text-blue-500", shortName: "BASE" },
};

export const ComparisonPanel = memo(function ComparisonPanel({
  data,
  className,
}: ComparisonPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [selectedChain, setSelectedChain] = useState<ReferenceChain>("ethereum");

  const comparison = data.comparisons[selectedChain];

  return (
    <div className={cn("cyber-card p-6", className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-cyber-purple" />
          <h3 className="font-display font-bold text-lg">CHAIN COMPARISON</h3>
        </div>
        <span className="text-xs text-cyber-gray">
          Last updated: {new Date(data.lastUpdated).toLocaleTimeString()}
        </span>
      </div>

      {/* Chain selector */}
      <div className="flex flex-wrap gap-2 mb-6">
        {(Object.keys(data.comparisons) as ReferenceChain[]).map((chain) => {
          const chainInfo = CHAIN_ICONS[chain];
          const isSelected = chain === selectedChain;
          
          return (
            <button
              key={chain}
              onClick={() => setSelectedChain(chain)}
              className={cn(
                "px-3 py-1.5 rounded text-sm font-mono transition-all",
                isSelected
                  ? "bg-cyber-purple/20 border border-cyber-purple text-white"
                  : "bg-cyber-dark/50 border border-cyber-gray/30 text-cyber-gray hover:text-white"
              )}
            >
              <span className={chainInfo.color}>{chainInfo.shortName}</span>
            </button>
          );
        })}
      </div>

      {comparison && (
        <>
          {/* Big savings highlight */}
          {/* Turkish: "'USD cinsinden' (Estimated USD Saved) büyük puntolarla göster" */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            {/* USD Saved */}
            <div className="bg-gradient-to-br from-neon-green/20 to-neon-green/5 rounded-lg p-4 border border-neon-green/30">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="w-4 h-4 text-neon-green" />
                <span className="text-xs text-cyber-gray uppercase">USD Saved</span>
              </div>
              <div className="text-3xl font-bold text-neon-green mb-1">
                ${comparison.costSavedUsd.value.toFixed(4)}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-neon-green/70">
                  {comparison.costSavedPercent.value.toFixed(1)}% cheaper
                </span>
                <SourceBadge source={comparison.costSavedUsd.source} />
              </div>
            </div>

            {/* Time Saved */}
            <div className="bg-gradient-to-br from-cyber-cyan/20 to-cyber-cyan/5 rounded-lg p-4 border border-cyber-cyan/30">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-cyber-cyan" />
                <span className="text-xs text-cyber-gray uppercase">Time Saved</span>
              </div>
              <div className="text-3xl font-bold text-cyber-cyan mb-1">
                {formatLatency(comparison.latencySavedMs.value)}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-cyber-cyan/70">
                  {comparison.latencySavedPercent.value.toFixed(1)}% faster
                </span>
                <SourceBadge source={comparison.latencySavedMs.source} />
              </div>
            </div>
          </div>

          {/* Speed multiplier highlight */}
          <div className="bg-cyber-dark/50 rounded-lg p-4 mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-neon-green/20">
                <Zap className="w-6 h-6 text-neon-green" />
              </div>
              <div>
                <p className="text-sm text-cyber-gray">Speed Multiplier</p>
                <p className="text-2xl font-bold text-white">
                  <span className="text-neon-green">
                    {comparison.speedMultiplier.value.toFixed(0)}x
                  </span>{" "}
                  faster than {comparison.referenceConfig.name}
                </p>
              </div>
            </div>
            <SourceBadge source={comparison.speedMultiplier.source} />
          </div>

          {/* Detailed breakdown */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center justify-between py-2 text-cyber-gray hover:text-white transition-colors"
          >
            <span className="text-sm">Detailed Breakdown</span>
            {expanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>

          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="pt-4 space-y-3">
                  <ComparisonRow
                    label="Block Time"
                    monadValue={`${400}ms`}
                    refValue={`${comparison.referenceConfig.avgBlockTimeMs}ms`}
                    saving={`${comparison.referenceConfig.avgBlockTimeMs - 400}ms`}
                    monadSource="config-ref"
                    refSource={comparison.referenceConfig.source}
                  />
                  <ComparisonRow
                    label="Finality"
                    monadValue={`${800}ms`}
                    refValue={formatLatency(comparison.referenceConfig.avgFinalityMs)}
                    saving={formatLatency(comparison.finalitySavedMs.value)}
                    monadSource="config-ref"
                    refSource={comparison.referenceConfig.source}
                  />
                  <ComparisonRow
                    label="Tx Latency"
                    monadValue={`${500}ms`}
                    refValue={`${comparison.referenceConfig.avgTxLatencyMs}ms`}
                    saving={`${comparison.latencySavedMs.value.toFixed(0)}ms`}
                    monadSource="config-ref"
                    refSource={comparison.referenceConfig.source}
                  />
                  <ComparisonRow
                    label="Tx Cost"
                    monadValue={`$${(0.000105).toFixed(6)}`}
                    refValue={`$${comparison.referenceConfig.avgTxCostUsd.toFixed(6)}`}
                    saving={`$${comparison.costSavedUsd.value.toFixed(6)}`}
                    monadSource="config-ref"
                    refSource={comparison.referenceConfig.source}
                    highlight
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      {/* Best savings banner */}
      <div className="mt-6 p-3 rounded-lg bg-cyber-purple/10 border border-cyber-purple/30">
        <p className="text-xs text-cyber-gray mb-1">Highest savings vs:</p>
        <div className="flex items-center justify-between">
          <span className="text-sm">
            <span className={CHAIN_ICONS[data.bestCostSaving.chain].color}>
              {CHAIN_ICONS[data.bestCostSaving.chain].shortName}
            </span>
            {" "}- ${data.bestCostSaving.savedUsd.toFixed(4)} saved
          </span>
          <span className="text-sm">
            <span className={CHAIN_ICONS[data.bestLatencySaving.chain].color}>
              {CHAIN_ICONS[data.bestLatencySaving.chain].shortName}
            </span>
            {" "}- {formatLatency(data.bestLatencySaving.savedMs)} faster
          </span>
        </div>
      </div>
    </div>
  );
});

// ============================================
// HELPER COMPONENTS
// ============================================

interface ComparisonRowProps {
  label: string;
  monadValue: string;
  refValue: string;
  saving: string;
  monadSource: "measured" | "config-ref" | "simulated" | "estimated";
  refSource: "measured" | "config-ref" | "simulated" | "estimated";
  highlight?: boolean;
}

function ComparisonRow({
  label,
  monadValue,
  refValue,
  saving,
  monadSource,
  refSource,
  highlight,
}: ComparisonRowProps) {
  return (
    <div className={cn(
      "grid grid-cols-4 gap-2 p-2 rounded",
      highlight && "bg-neon-green/10"
    )}>
      <span className="text-sm text-cyber-gray">{label}</span>
      <div className="text-sm">
        <span className="text-neon-green">{monadValue}</span>
        <SourceBadge source={monadSource} className="ml-1" showIcon={false} />
      </div>
      <div className="text-sm">
        <span className="text-cyber-gray">{refValue}</span>
        <SourceBadge source={refSource} className="ml-1" showIcon={false} />
      </div>
      <span className={cn(
        "text-sm font-bold",
        highlight ? "text-neon-green" : "text-cyber-cyan"
      )}>
        {saving}
      </span>
    </div>
  );
}

// ============================================
// HELPERS
// ============================================

function formatLatency(ms: number): string {
  if (ms >= 60000) {
    return `${(ms / 60000).toFixed(1)}min`;
  }
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${ms.toFixed(0)}ms`;
}
