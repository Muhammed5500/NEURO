"use client";

/**
 * BondingCurveProgress - LIVE DATA ONLY
 * 
 * Tracks real nad.fun bonding curves on Monad (Chain ID 143).
 * NO MOCK DATA - shows error/disconnected state if backend unavailable.
 */

import { useState } from "react";
import {
  TrendingUp,
  Award,
  AlertTriangle,
  Users,
  Droplets,
  Clock,
  Zap,
  Target,
  Pause,
} from "lucide-react";
import { useLiveBondingCurves, type ActiveToken, type CurveStatus } from "@/hooks/use-live-nadfun";
import { ConnectionErrorDisplay, DisconnectedDisplay, LoadingDisplay } from "@/components/error";
import { ErrorBoundary } from "@/components/error";

// ============================================
// HELPERS
// ============================================

const statusConfig: Record<CurveStatus, { color: string; icon: React.ElementType; label: string }> = {
  ACTIVE: { color: "text-cyber-cyan", icon: TrendingUp, label: "ACTIVE" },
  STALLING: { color: "text-cyber-yellow", icon: Pause, label: "STALLING" },
  ACCELERATING: { color: "text-neon-green", icon: Zap, label: "ACCELERATING" },
  NEAR_GRADUATION: { color: "text-cyber-pink", icon: Target, label: "NEAR GRAD" },
  GRADUATED: { color: "text-cyber-purple", icon: Award, label: "GRADUATED" },
};

// ============================================
// COMPONENT
// ============================================

function BondingCurveProgressContent() {
  const {
    tokens,
    connectionState,
    error,
    retry,
    isConnected,
  } = useLiveBondingCurves();

  const [selectedToken, setSelectedToken] = useState<string | null>(null);

  // Show error state
  if (error) {
    return (
      <div className="cyber-card p-6">
        <ConnectionErrorDisplay error={error} onRetry={retry} />
      </div>
    );
  }

  // Show loading/disconnected
  if (connectionState === "connecting") {
    return (
      <div className="cyber-card p-6">
        <LoadingDisplay source="Bonding Curves" />
      </div>
    );
  }

  if (connectionState === "disconnected") {
    return (
      <div className="cyber-card p-6">
        <DisconnectedDisplay source="Bonding Curves" onConnect={retry} />
      </div>
    );
  }

  return (
    <div className="cyber-card p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-neon-green/20 rounded-lg border border-neon-green/30">
            <Award className="w-5 h-5 text-neon-green" />
          </div>
          <div>
            <h2 className="text-lg font-display font-bold text-white">
              BONDING CURVE PROGRESS
            </h2>
            <p className="text-xs text-gray-500 font-mono">
              ACTIVE TOKEN GRADUATION TRACKER
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
          <div className="text-right">
            <p className="text-sm font-bold text-white">{tokens.length} Active</p>
            <p className="text-xs text-gray-500">
              {tokens.filter((t) => t.status === "ACCELERATING").length} accelerating
            </p>
          </div>
        </div>
      </div>

      {/* Token Progress List */}
      <div className="space-y-4">
        {tokens.length === 0 ? (
          <div className="text-center py-12">
            <Award className="w-12 h-12 mx-auto mb-3 text-cyber-purple/30" />
            <p className="text-gray-500">No active bonding curves</p>
            <p className="text-xs text-gray-600 mt-1">
              Deploy a token to start tracking
            </p>
          </div>
        ) : (
          tokens.map((token) => (
            <TokenCard
              key={token.id}
              token={token}
              isSelected={selectedToken === token.id}
              onSelect={() => setSelectedToken(selectedToken === token.id ? null : token.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ============================================
// SUB-COMPONENTS
// ============================================

interface TokenCardProps {
  token: ActiveToken;
  isSelected: boolean;
  onSelect: () => void;
}

function TokenCard({ token, isSelected, onSelect }: TokenCardProps) {
  const config = statusConfig[token.status];
  const StatusIcon = config.icon;

  return (
    <div
      className={`
        p-4 rounded-lg border transition-all cursor-pointer
        ${isSelected
          ? "bg-cyber-purple/20 border-cyber-purple"
          : "bg-cyber-gray/30 border-cyber-purple/20 hover:border-cyber-purple/50"
        }
      `}
      onClick={onSelect}
    >
      {/* Token Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          {/* Token Avatar */}
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyber-purple to-cyber-pink flex items-center justify-center text-sm font-bold text-white">
            {token.symbol[0]}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-white">${token.symbol}</span>
              <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${config.color} bg-current/10`}>
                <StatusIcon className="w-3 h-3" />
                {config.label}
              </span>
            </div>
            <p className="text-xs text-gray-500">{token.name}</p>
            <p className="text-[10px] text-gray-600 font-mono truncate max-w-[200px]">
              {token.contractAddress}
            </p>
          </div>
        </div>

        {/* Price & Change */}
        <div className="text-right">
          <p className="font-mono text-white">
            ${token.currentPrice.toFixed(8)}
          </p>
          <p className={`text-sm ${token.priceChange24h >= 0 ? "text-neon-green" : "text-cyber-red"}`}>
            {token.priceChange24h >= 0 ? "+" : ""}
            {token.priceChange24h.toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="relative mb-3">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-gray-500">Graduation Progress</span>
          <span className={config.color}>{token.curveProgress.toFixed(1)}%</span>
        </div>
        <div className="h-4 bg-cyber-gray rounded-full overflow-hidden relative">
          {/* Progress fill */}
          <div
            className={`h-full transition-all duration-500 ${
              token.status === "ACCELERATING"
                ? "bg-gradient-to-r from-neon-green to-cyber-cyan"
                : token.status === "STALLING"
                ? "bg-gradient-to-r from-cyber-yellow to-cyber-yellow/50"
                : token.status === "NEAR_GRADUATION"
                ? "bg-gradient-to-r from-cyber-pink to-cyber-purple animate-pulse"
                : "bg-gradient-to-r from-cyber-purple to-cyber-cyan"
            }`}
            style={{ width: `${token.curveProgress}%` }}
          />
          {/* Graduation marker */}
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[10px] text-gray-400">
            <Award className="w-3 h-3" />
            GRAD
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-4 gap-2 text-center">
        <div className="p-2 bg-cyber-black/30 rounded">
          <p className="text-xs text-gray-500 flex items-center justify-center gap-1">
            <Droplets className="w-3 h-3" />
            Liquidity
          </p>
          <p className="font-mono text-sm text-cyber-cyan">
            ${(token.liquidity / 1000).toFixed(1)}K
          </p>
        </div>
        <div className="p-2 bg-cyber-black/30 rounded">
          <p className="text-xs text-gray-500 flex items-center justify-center gap-1">
            <Users className="w-3 h-3" />
            Holders
          </p>
          <p className="font-mono text-sm text-cyber-purple">{token.holders}</p>
        </div>
        <div className="p-2 bg-cyber-black/30 rounded">
          <p className="text-xs text-gray-500 flex items-center justify-center gap-1">
            <Zap className="w-3 h-3" />
            Velocity
          </p>
          <p className={`font-mono text-sm ${token.velocity >= 0 ? "text-neon-green" : "text-cyber-red"}`}>
            {token.velocity >= 0 ? "+" : ""}{token.velocity.toFixed(1)}x
          </p>
        </div>
        <div className="p-2 bg-cyber-black/30 rounded">
          <p className="text-xs text-gray-500 flex items-center justify-center gap-1">
            <Clock className="w-3 h-3" />
            ETA
          </p>
          <p className="font-mono text-sm text-cyber-yellow">
            {token.estimatedTimeToGrad || "N/A"}
          </p>
        </div>
      </div>

      {/* Expanded Details */}
      {isSelected && (
        <div className="mt-4 pt-4 border-t border-cyber-purple/20">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-500 mb-1">24h Volume</p>
              <p className="font-mono text-white">${token.volume24h.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Graduation Target</p>
              <p className="font-mono text-white">${token.graduationTarget.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Deployed</p>
              <p className="text-white">
                {new Date(token.deployedAt).toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Progress Rate</p>
              <p className={`font-mono ${token.velocity >= 0 ? "text-neon-green" : "text-cyber-red"}`}>
                {token.velocity >= 0 ? "+" : ""}{(token.velocity * 2.4).toFixed(1)}%/hr
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 mt-4">
            <button className="flex-1 p-2 bg-cyber-purple/20 text-cyber-purple rounded border border-cyber-purple/30 hover:bg-cyber-purple/30 transition-colors text-sm font-medium flex items-center justify-center gap-2">
              <TrendingUp className="w-4 h-4" />
              BOOST CAMPAIGN
            </button>
            <button className="flex-1 p-2 bg-cyber-yellow/20 text-cyber-yellow rounded border border-cyber-yellow/30 hover:bg-cyber-yellow/30 transition-colors text-sm font-medium flex items-center justify-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              REDUCE EXPOSURE
            </button>
          </div>
        </div>
      )}

      {/* Stalling Warning */}
      {token.status === "STALLING" && !isSelected && (
        <div className="mt-3 p-2 bg-cyber-yellow/10 border border-cyber-yellow/30 rounded flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-cyber-yellow" />
          <p className="text-xs text-cyber-yellow">
            Curve velocity declining. Consider boosting social campaign.
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================
// EXPORT WITH ERROR BOUNDARY
// ============================================

export function BondingCurveProgress() {
  return (
    <ErrorBoundary>
      <BondingCurveProgressContent />
    </ErrorBoundary>
  );
}
