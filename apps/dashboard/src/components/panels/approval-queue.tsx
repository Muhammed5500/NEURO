"use client";

/**
 * ApprovalQueue - LIVE DATA ONLY
 * 
 * Shows real pending operations from backend.
 * NO MOCK DATA - shows error/disconnected if unavailable.
 */

import { useState } from "react";
import {
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronRight,
  Rocket,
  Twitter,
  MessageSquare,
  Zap,
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
  DEPLOY_TOKEN: "DEPLOYMENT",
  X_CAMPAIGN: "VIRAL GROWTH",
  MASS_COMMENT: "ENGAGEMENT",
  LIQUIDITY_ADD: "LIQUIDITY",
};

// ============================================
// COMPONENT
// ============================================

function ApprovalQueueContent() {
  const {
    operations,
    connectionState,
    error,
    approveOperation,
    rejectOperation,
    retry,
    isConnected,
  } = useLiveOperations();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [executingIds, setExecutingIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  const handleApprove = async (id: string) => {
    setExecutingIds((prev) => new Set(prev).add(id));
    setActionError(null);
    try {
      await approveOperation(id);
    } catch (err) {
      setActionError(String(err));
    } finally {
      setExecutingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleReject = async (id: string) => {
    setExecutingIds((prev) => new Set(prev).add(id));
    setActionError(null);
    try {
      await rejectOperation(id);
    } catch (err) {
      setActionError(String(err));
    } finally {
      setExecutingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  // Show error
  if (error) {
    return (
      <div className="cyber-card p-6">
        <ConnectionErrorDisplay error={error} onRetry={retry} />
      </div>
    );
  }

  // Show loading
  if (connectionState === "connecting") {
    return (
      <div className="cyber-card p-6">
        <LoadingDisplay source="Approval Queue" />
      </div>
    );
  }

  // Show disconnected
  if (connectionState === "disconnected") {
    return (
      <div className="cyber-card p-6">
        <DisconnectedDisplay source="Approval Queue" onConnect={retry} />
      </div>
    );
  }

  return (
    <div className="cyber-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-display font-bold text-white flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-cyber-yellow" />
          PENDING OPERATIONS
        </h2>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 text-xs font-mono rounded border ${
            isConnected
              ? "bg-neon-green/20 text-neon-green border-neon-green/30"
              : "bg-cyber-red/20 text-cyber-red border-cyber-red/30"
          }`}>
            {isConnected ? "LIVE" : "OFFLINE"}
          </span>
          {operations.length > 0 && (
            <span className="px-3 py-1 bg-cyber-red/20 text-cyber-red text-sm font-bold rounded-full border border-cyber-red/30 animate-pulse">
              {operations.length} awaiting
            </span>
          )}
        </div>
      </div>

      {/* Action Error */}
      {actionError && (
        <div className="mb-4 p-3 bg-cyber-red/20 border border-cyber-red/50 rounded text-sm text-red-300 font-mono">
          {actionError}
        </div>
      )}

      <div className="space-y-3">
        {operations.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Rocket className="w-12 h-12 mx-auto mb-3 text-cyber-purple/30" />
            <p>No pending operations</p>
            <p className="text-xs text-gray-600 mt-1">
              Waiting for agent recommendations...
            </p>
          </div>
        ) : (
          operations.map((approval) => {
            const Icon = operationIcons[approval.type];
            const label = operationLabels[approval.type];
            const isExecuting = executingIds.has(approval.id);

            return (
              <div
                key={approval.id}
                className={`relative p-4 bg-cyber-gray/30 rounded-lg border transition-all cursor-pointer ${
                  selectedId === approval.id
                    ? "border-cyber-purple"
                    : "border-cyber-purple/20 hover:border-cyber-purple/50"
                } ${isExecuting ? "opacity-75" : ""}`}
                onClick={() =>
                  setSelectedId(selectedId === approval.id ? null : approval.id)
                }
              >
                {/* Executing overlay */}
                {isExecuting && (
                  <div className="absolute inset-0 flex items-center justify-center bg-cyber-black/50 rounded-lg z-10">
                    <div className="flex items-center gap-2 text-neon-green">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span className="font-mono text-sm">PROCESSING...</span>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {/* Operation Type Badge */}
                    <div className="flex flex-col items-center gap-1">
                      <div className="p-2 bg-cyber-purple/20 rounded-lg border border-cyber-purple/30">
                        <Icon className="w-4 h-4 text-cyber-purple" />
                      </div>
                      <span className="text-[9px] font-mono text-gray-500">{label}</span>
                    </div>

                    {/* Details */}
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <div className={`risk-badge ${approval.priority}`}>
                          {approval.priority}
                        </div>
                        <p className="text-sm font-medium text-white">{approval.title}</p>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDistanceToNow(new Date(approval.createdAt), { addSuffix: true })}
                        </span>
                        <span className="text-cyber-cyan font-mono">
                          {approval.estimatedCostMon.toFixed(3)} MON
                        </span>
                        <span className="text-cyber-purple">
                          {(approval.confidence * 100).toFixed(0)}% confidence
                        </span>
                        {approval.estimatedImpact?.viralPotential && (
                          <span className="text-neon-green">
                            {approval.estimatedImpact.viralPotential}% viral
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleApprove(approval.id);
                      }}
                      disabled={isExecuting}
                      className="p-2 bg-neon-green/20 text-neon-green rounded-lg hover:bg-neon-green/30 transition-colors border border-neon-green/30 disabled:opacity-50"
                      title="Deploy"
                    >
                      <CheckCircle className="w-5 h-5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleReject(approval.id);
                      }}
                      disabled={isExecuting}
                      className="p-2 bg-cyber-red/20 text-cyber-red rounded-lg hover:bg-cyber-red/30 transition-colors border border-cyber-red/30 disabled:opacity-50"
                      title="Reject"
                    >
                      <XCircle className="w-5 h-5" />
                    </button>
                    <ChevronRight
                      className={`w-5 h-5 text-gray-500 transition-transform ${
                        selectedId === approval.id ? "rotate-90" : ""
                      }`}
                    />
                  </div>
                </div>

                {/* Expanded details */}
                {selectedId === approval.id && (
                  <div className="mt-4 pt-4 border-t border-cyber-purple/20 space-y-3">
                    <p className="text-sm text-gray-400">{approval.description}</p>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-gray-500">Operation Type</p>
                        <p className="text-white font-mono">{approval.type}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">Expires In</p>
                        <p className="text-cyber-yellow">
                          {formatDistanceToNow(new Date(approval.expiresAt))}
                        </p>
                      </div>
                    </div>
                    {approval.metadata && Object.keys(approval.metadata).length > 0 && (
                      <div>
                        <p className="text-gray-500 text-sm mb-2">Parameters</p>
                        <div className="p-3 bg-cyber-black/50 rounded font-mono text-xs">
                          {Object.entries(approval.metadata).map(([key, value]) => (
                            <div key={key} className="flex justify-between py-1">
                              <span className="text-gray-500">{key}:</span>
                              <span className="text-cyber-cyan">
                                {Array.isArray(value) ? value.join(", ") : String(value)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ============================================
// EXPORT WITH ERROR BOUNDARY
// ============================================

export function ApprovalQueue() {
  return (
    <ErrorBoundary>
      <ApprovalQueueContent />
    </ErrorBoundary>
  );
}
