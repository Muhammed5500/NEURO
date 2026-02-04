"use client";

/**
 * NadfunOperationsWing - LIVE DATA ONLY
 * 
 * Connects to real nad.fun operation queue.
 * NO MOCK DATA - shows error/disconnected state if backend unavailable.
 */

import { useState } from "react";
import {
  Rocket,
  Twitter,
  MessageSquare,
  CheckCircle,
  XCircle,
  Clock,
  ChevronRight,
  Zap,
  Target,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useLiveOperations, type PendingOperation, type OperationType } from "@/hooks/use-live-nadfun";
import { ConnectionErrorDisplay, DisconnectedDisplay, LoadingDisplay } from "@/components/error";
import { ErrorBoundary } from "@/components/error";

// ============================================
// HELPERS
// ============================================

const operationIcons: Record<OperationType, React.ElementType> = {
  DEPLOY_TOKEN: Rocket,
  X_CAMPAIGN: Twitter,
  MASS_COMMENT: MessageSquare,
  LIQUIDITY_ADD: Zap,
};

const operationLabels: Record<OperationType, string> = {
  DEPLOY_TOKEN: "DEPLOY",
  X_CAMPAIGN: "X CAMPAIGN",
  MASS_COMMENT: "MASS COMMENT",
  LIQUIDITY_ADD: "ADD LIQUIDITY",
};

const priorityColors: Record<string, string> = {
  low: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  medium: "bg-cyber-yellow/20 text-cyber-yellow border-cyber-yellow/30",
  high: "bg-cyber-pink/20 text-cyber-pink border-cyber-pink/30",
  critical: "bg-cyber-red/20 text-cyber-red border-cyber-red/30 animate-pulse",
};

// ============================================
// COMPONENT
// ============================================

function NadfunOperationsWingContent() {
  const {
    operations,
    connectionState,
    error,
    approveOperation,
    rejectOperation,
    retry,
    isConnected,
  } = useLiveOperations();

  const [selectedOp, setSelectedOp] = useState<string | null>(null);
  const [executingOps, setExecutingOps] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  const handleApprove = async (id: string) => {
    setExecutingOps((prev) => new Set(prev).add(id));
    setActionError(null);
    
    try {
      await approveOperation(id);
    } catch (err) {
      setActionError(`Failed to approve: ${err}`);
    } finally {
      setExecutingOps((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleReject = async (id: string) => {
    setExecutingOps((prev) => new Set(prev).add(id));
    setActionError(null);
    
    try {
      await rejectOperation(id);
    } catch (err) {
      setActionError(`Failed to reject: ${err}`);
    } finally {
      setExecutingOps((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (selectedOp === id) setSelectedOp(null);
    }
  };

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
        <LoadingDisplay source="nad.fun Operations" />
      </div>
    );
  }

  if (connectionState === "disconnected") {
    return (
      <div className="cyber-card p-6">
        <DisconnectedDisplay source="nad.fun Operations" onConnect={retry} />
      </div>
    );
  }

  const pendingCount = operations.filter((op) => op.status !== "executing").length;

  return (
    <div className="cyber-card p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-cyber-pink/20 rounded-lg border border-cyber-pink/30">
            <Rocket className="w-5 h-5 text-cyber-pink" />
          </div>
          <div>
            <h2 className="text-lg font-display font-bold text-white">
              nad.fun OPERATIONS
            </h2>
            <p className="text-xs text-gray-500 font-mono">
              DEPLOYMENT & VIRAL GROWTH QUEUE
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
          {pendingCount > 0 && (
            <span className="px-3 py-1 bg-cyber-red/20 text-cyber-red text-sm font-bold rounded-full border border-cyber-red/30 animate-pulse">
              {pendingCount} AWAITING
            </span>
          )}
        </div>
      </div>

      {/* Action Error */}
      {actionError && (
        <div className="mb-4 p-3 bg-cyber-red/20 border border-cyber-red/50 rounded text-sm text-cyber-red">
          {actionError}
        </div>
      )}

      {/* Operations List */}
      <div className="space-y-3">
        {operations.length === 0 ? (
          <div className="text-center py-12">
            <Rocket className="w-12 h-12 mx-auto mb-3 text-cyber-purple/30" />
            <p className="text-gray-500">No pending operations</p>
            <p className="text-xs text-gray-600 mt-1">
              Waiting for agent recommendations...
            </p>
          </div>
        ) : (
          operations.map((op) => (
            <OperationCard
              key={op.id}
              operation={op}
              isSelected={selectedOp === op.id}
              isExecuting={executingOps.has(op.id)}
              onSelect={() => setSelectedOp(selectedOp === op.id ? null : op.id)}
              onApprove={() => handleApprove(op.id)}
              onReject={() => handleReject(op.id)}
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

interface OperationCardProps {
  operation: PendingOperation;
  isSelected: boolean;
  isExecuting: boolean;
  onSelect: () => void;
  onApprove: () => void;
  onReject: () => void;
}

function OperationCard({
  operation: op,
  isSelected,
  isExecuting,
  onSelect,
  onApprove,
  onReject,
}: OperationCardProps) {
  const Icon = operationIcons[op.type];

  return (
    <div
      className={`
        relative p-4 rounded-lg border transition-all cursor-pointer
        ${isSelected
          ? "bg-cyber-purple/20 border-cyber-purple"
          : "bg-cyber-gray/30 border-cyber-purple/20 hover:border-cyber-purple/50"
        }
        ${isExecuting ? "opacity-75" : ""}
      `}
      onClick={onSelect}
    >
      {/* Executing overlay */}
      {isExecuting && (
        <div className="absolute inset-0 flex items-center justify-center bg-cyber-black/50 rounded-lg z-10">
          <div className="flex items-center gap-2 text-neon-green">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="font-mono text-sm">EXECUTING...</span>
          </div>
        </div>
      )}

      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          {/* Operation Type Badge */}
          <div className="flex flex-col items-center gap-1">
            <div className="p-2 bg-cyber-purple/20 rounded-lg border border-cyber-purple/30">
              <Icon className="w-5 h-5 text-cyber-purple" />
            </div>
            <span className="text-[10px] font-mono text-gray-500">
              {operationLabels[op.type]}
            </span>
          </div>

          {/* Details */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`px-2 py-0.5 text-xs font-bold rounded border ${priorityColors[op.priority]}`}>
                {op.priority.toUpperCase()}
              </span>
              <span className="text-sm font-bold text-white">{op.title}</span>
            </div>
            <p className="text-xs text-gray-400 max-w-md">{op.description}</p>

            {/* Meta row */}
            <div className="flex items-center gap-4 mt-2 text-xs">
              <span className="flex items-center gap-1 text-gray-500">
                <Clock className="w-3 h-3" />
                {formatDistanceToNow(new Date(op.createdAt), { addSuffix: true })}
              </span>
              <span className="text-cyber-cyan font-mono">
                {op.estimatedCostMon.toFixed(3)} MON
              </span>
              <span className="flex items-center gap-1 text-cyber-purple">
                <Target className="w-3 h-3" />
                {(op.confidence * 100).toFixed(0)}% confidence
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onApprove();
            }}
            disabled={isExecuting}
            className="p-2 bg-neon-green/20 text-neon-green rounded-lg hover:bg-neon-green/30 transition-colors disabled:opacity-50 border border-neon-green/30"
            title="Deploy"
          >
            <CheckCircle className="w-5 h-5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onReject();
            }}
            disabled={isExecuting}
            className="p-2 bg-cyber-red/20 text-cyber-red rounded-lg hover:bg-cyber-red/30 transition-colors disabled:opacity-50 border border-cyber-red/30"
            title="Reject"
          >
            <XCircle className="w-5 h-5" />
          </button>
          <ChevronRight
            className={`w-5 h-5 text-gray-500 transition-transform ${
              isSelected ? "rotate-90" : ""
            }`}
          />
        </div>
      </div>

      {/* Expanded Details */}
      {isSelected && !isExecuting && (
        <div className="mt-4 pt-4 border-t border-cyber-purple/20">
          {/* Impact Predictions */}
          {op.estimatedImpact && (
            <div className="mb-4">
              <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                <Zap className="w-3 h-3" />
                ESTIMATED IMPACT
              </p>
              <div className="grid grid-cols-3 gap-3">
                {op.estimatedImpact.reach && (
                  <div className="p-2 bg-cyber-black/50 rounded text-center">
                    <p className="text-lg font-bold text-cyber-cyan font-mono">
                      {(op.estimatedImpact.reach / 1000).toFixed(1)}K
                    </p>
                    <p className="text-xs text-gray-500">Reach</p>
                  </div>
                )}
                {op.estimatedImpact.engagement && (
                  <div className="p-2 bg-cyber-black/50 rounded text-center">
                    <p className="text-lg font-bold text-cyber-purple font-mono">
                      {op.estimatedImpact.engagement.toLocaleString()}
                    </p>
                    <p className="text-xs text-gray-500">Engagement</p>
                  </div>
                )}
                {op.estimatedImpact.viralPotential && (
                  <div className="p-2 bg-cyber-black/50 rounded text-center">
                    <p className="text-lg font-bold text-neon-green font-mono">
                      {op.estimatedImpact.viralPotential}%
                    </p>
                    <p className="text-xs text-gray-500">Viral Score</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Operation Metadata */}
          <div>
            <p className="text-xs text-gray-500 mb-2">OPERATION PARAMETERS</p>
            <div className="p-3 bg-cyber-black/50 rounded font-mono text-xs">
              {Object.entries(op.metadata).map(([key, value]) => (
                <div key={key} className="flex justify-between py-1">
                  <span className="text-gray-500">{key}:</span>
                  <span className="text-cyber-cyan">
                    {Array.isArray(value) ? value.join(", ") : String(value)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Warning for high-risk */}
          {(op.priority === "high" || op.priority === "critical") && (
            <div className="mt-3 p-2 bg-cyber-yellow/10 border border-cyber-yellow/30 rounded flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-cyber-yellow flex-shrink-0 mt-0.5" />
              <p className="text-xs text-cyber-yellow">
                High-priority operation. Review all parameters before deployment.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// EXPORT WITH ERROR BOUNDARY
// ============================================

export function NadfunOperationsWing() {
  return (
    <ErrorBoundary>
      <NadfunOperationsWingContent />
    </ErrorBoundary>
  );
}
