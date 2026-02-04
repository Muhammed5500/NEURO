"use client";

import { useState } from "react";
import { CheckCircle, XCircle, Clock, AlertTriangle, ChevronRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface ApprovalItem {
  id: string;
  actionType: string;
  description: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  estimatedCostMon: number;
  confidence: number;
  createdAt: Date;
  expiresAt: Date;
}

// Mock data for demonstration
const mockApprovals: ApprovalItem[] = [
  {
    id: "1",
    actionType: "TOKEN_BUY",
    description: "Buy PEPE token for 0.5 MON",
    riskLevel: "medium",
    estimatedCostMon: 0.52,
    confidence: 0.85,
    createdAt: new Date(Date.now() - 60000),
    expiresAt: new Date(Date.now() + 240000),
  },
  {
    id: "2",
    actionType: "TOKEN_SELL",
    description: "Sell 1000 DOGE tokens",
    riskLevel: "low",
    estimatedCostMon: 0.03,
    confidence: 0.92,
    createdAt: new Date(Date.now() - 120000),
    expiresAt: new Date(Date.now() + 180000),
  },
  {
    id: "3",
    actionType: "TOKEN_LAUNCH",
    description: "Launch new token NEURO",
    riskLevel: "high",
    estimatedCostMon: 0.8,
    confidence: 0.78,
    createdAt: new Date(Date.now() - 30000),
    expiresAt: new Date(Date.now() + 270000),
  },
];

export function ApprovalQueue() {
  const [approvals] = useState<ApprovalItem[]>(mockApprovals);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleApprove = (id: string) => {
    console.log("Approving:", id);
    // TODO: Implement approval logic
  };

  const handleReject = (id: string) => {
    console.log("Rejecting:", id);
    // TODO: Implement rejection logic
  };

  return (
    <div className="cyber-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-display font-bold text-white flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-cyber-yellow" />
          Pending Approvals
        </h2>
        <span className="px-3 py-1 bg-cyber-red/20 text-cyber-red text-sm font-bold rounded-full">
          {approvals.length} pending
        </span>
      </div>

      <div className="space-y-3">
        {approvals.map((approval) => (
          <div
            key={approval.id}
            className={`p-4 bg-cyber-gray/30 rounded-lg border transition-all cursor-pointer ${
              selectedId === approval.id
                ? "border-cyber-purple"
                : "border-cyber-purple/20 hover:border-cyber-purple/50"
            }`}
            onClick={() => setSelectedId(selectedId === approval.id ? null : approval.id)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`risk-badge ${approval.riskLevel}`}>
                  {approval.riskLevel}
                </div>
                <div>
                  <p className="text-sm font-medium text-white">
                    {approval.description}
                  </p>
                  <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDistanceToNow(approval.createdAt, { addSuffix: true })}
                    </span>
                    <span>Cost: {approval.estimatedCostMon.toFixed(3)} MON</span>
                    <span>Confidence: {(approval.confidence * 100).toFixed(0)}%</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleApprove(approval.id);
                  }}
                  className="p-2 bg-cyber-green/20 text-cyber-green rounded-lg hover:bg-cyber-green/30 transition-colors"
                  title="Approve"
                >
                  <CheckCircle className="w-5 h-5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleReject(approval.id);
                  }}
                  className="p-2 bg-cyber-red/20 text-cyber-red rounded-lg hover:bg-cyber-red/30 transition-colors"
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
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500">Action Type</p>
                    <p className="text-white font-mono">{approval.actionType}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Expires In</p>
                    <p className="text-cyber-yellow">
                      {formatDistanceToNow(approval.expiresAt)}
                    </p>
                  </div>
                </div>
                <div>
                  <p className="text-gray-500 text-sm mb-2">AI Reasoning</p>
                  <p className="text-sm text-gray-300 bg-cyber-black/50 p-3 rounded">
                    Based on market analysis, this action has a{" "}
                    {(approval.confidence * 100).toFixed(0)}% confidence score.
                    Risk assessment: {approval.riskLevel}.
                  </p>
                </div>
              </div>
            )}
          </div>
        ))}

        {approvals.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <CheckCircle className="w-12 h-12 mx-auto mb-3 text-cyber-green/50" />
            <p>No pending approvals</p>
          </div>
        )}
      </div>
    </div>
  );
}
