"use client";

/**
 * StatusPanel - LIVE DATA ONLY
 * 
 * Shows real service health from actual API calls.
 * NO MOCK DATA - shows OFFLINE if services unavailable.
 */

import {
  Server,
  Database,
  Brain,
  Radio,
  Rocket,
  Twitter,
  Target,
  AlertTriangle,
} from "lucide-react";
import { useLiveServiceHealth } from "@/hooks/use-live-metrics";
import { useLiveOperations } from "@/hooks/use-live-nadfun";
import { ErrorBoundary } from "@/components/error";

// ============================================
// COMPONENT
// ============================================

function StatusPanelContent() {
  const { services, error: healthError } = useLiveServiceHealth();
  const { operations } = useLiveOperations();

  const serviceIcons: Record<string, React.ElementType> = {
    Orchestrator: Brain,
    Ingestion: Radio,
    Execution: Server,
    Memory: Database,
  };

  // Count operational stats from actual data
  const activeDeployments = operations.filter(op => op.type === "DEPLOY_TOKEN").length;
  const pendingCampaigns = operations.filter(op => op.type === "X_CAMPAIGN").length;
  const onlineServices = services.filter(s => s.status === "online").length;

  return (
    <div className="cyber-card p-6">
      <h2 className="text-lg font-display font-bold text-white mb-4 flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${
          onlineServices === services.length ? "bg-neon-green" : "bg-cyber-yellow"
        } animate-pulse`} />
        SYSTEM STATUS
      </h2>

      {/* Service Grid */}
      <div className="grid grid-cols-4 gap-4">
        {services.map((service) => {
          const Icon = serviceIcons[service.name] || Server;
          return (
            <div
              key={service.name}
              className={`p-4 bg-cyber-gray/30 rounded-lg border ${
                service.status === "online"
                  ? "border-neon-green/30"
                  : service.status === "degraded"
                  ? "border-cyber-yellow/30"
                  : "border-cyber-red/30"
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <Icon className={`w-5 h-5 ${
                  service.status === "online"
                    ? "text-neon-green"
                    : service.status === "degraded"
                    ? "text-cyber-yellow"
                    : "text-cyber-red"
                }`} />
                <div
                  className={`status-indicator ${
                    service.status === "online"
                      ? "online"
                      : service.status === "degraded"
                      ? "pending"
                      : "offline"
                  }`}
                />
              </div>
              <p className="text-sm font-medium text-white">{service.name}</p>
              <p className={`text-xs mt-1 font-mono ${
                service.status === "online" ? "text-gray-500" : "text-cyber-red"
              }`}>
                {service.status === "online" && service.latency !== null
                  ? `${service.latency}ms`
                  : service.error || "OFFLINE"}
              </p>
            </div>
          );
        })}
      </div>

      {/* Health Error Display */}
      {healthError && (
        <div className="mt-4 p-3 bg-cyber-red/20 border border-cyber-red/50 rounded text-xs">
          <span className="text-cyber-red font-mono">[HEALTH CHECK]</span>
          <span className="text-red-300 ml-2">{healthError.message}</span>
        </div>
      )}

      {/* Operational Stats - From Live Data */}
      <div className="mt-4 pt-4 border-t border-cyber-purple/20 grid grid-cols-4 gap-4 text-center">
        <div className="p-3 bg-gradient-to-br from-cyber-pink/10 to-transparent rounded-lg border border-cyber-pink/20">
          <div className="flex items-center justify-center gap-2 mb-1">
            <Rocket className="w-4 h-4 text-cyber-pink" />
          </div>
          <p className="text-2xl font-bold text-cyber-pink font-mono">
            {activeDeployments}
          </p>
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">
            Pending Deploys
          </p>
        </div>

        <div className="p-3 bg-gradient-to-br from-cyber-cyan/10 to-transparent rounded-lg border border-cyber-cyan/20">
          <div className="flex items-center justify-center gap-2 mb-1">
            <Twitter className="w-4 h-4 text-cyber-cyan" />
          </div>
          <p className="text-2xl font-bold text-cyber-cyan font-mono">
            {pendingCampaigns}
          </p>
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">
            X Campaigns
          </p>
        </div>

        <div className="p-3 bg-gradient-to-br from-cyber-purple/10 to-transparent rounded-lg border border-cyber-purple/20">
          <div className="flex items-center justify-center gap-2 mb-1">
            <Brain className="w-4 h-4 text-cyber-purple" />
          </div>
          <p className="text-2xl font-bold text-cyber-purple font-mono">
            {onlineServices}/{services.length}
          </p>
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">
            Services Online
          </p>
        </div>

        <div className="p-3 bg-gradient-to-br from-neon-green/10 to-transparent rounded-lg border border-neon-green/20">
          <div className="flex items-center justify-center gap-2 mb-1">
            <Target className="w-4 h-4 text-neon-green" />
          </div>
          <p className="text-2xl font-bold text-neon-green font-mono">
            {operations.length}
          </p>
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">
            Total Pending
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================
// EXPORT WITH ERROR BOUNDARY
// ============================================

export function StatusPanel() {
  return (
    <ErrorBoundary>
      <StatusPanelContent />
    </ErrorBoundary>
  );
}
