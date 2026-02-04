"use client";

/**
 * NEURO Launchpad Dashboard - LIVE DATA ONLY
 * 
 * Strategic Trend Detection → nad.fun Launch → Social Automation
 * 
 * NO MOCK DATA:
 * - All components connect to real backend
 * - Errors/disconnections are shown in UI
 * - Zero hardcoded values unless from live DB or SSE stream
 */

import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import { StatusPanel } from "@/components/panels/status-panel";
import { ActivityFeed } from "@/components/panels/activity-feed";
import { KillSwitch } from "@/components/controls/kill-switch";
import { ErrorBoundary } from "@/components/error";
import {
  TrendIntelligenceGrid,
  NadfunOperationsWing,
  BondingCurveProgress,
  SocialImpactMonitor,
  LatencyTimeline,
} from "@/components/launchpad";
import { validateConfig } from "@/lib/live-data-client";
import { useEffect, useState } from "react";

// ============================================
// CONFIG VALIDATION COMPONENT
// ============================================

function ConfigValidator({ children }: { children: React.ReactNode }) {
  const [configValid, setConfigValid] = useState<boolean | null>(null);
  const [missingVars, setMissingVars] = useState<string[]>([]);

  useEffect(() => {
    const { valid, missing } = validateConfig();
    setConfigValid(valid);
    setMissingVars(missing);
  }, []);

  // Still checking
  if (configValid === null) {
    return (
      <div className="min-h-screen bg-cyber-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-cyber-purple border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Validating configuration...</p>
        </div>
      </div>
    );
  }

  // Config invalid - show error
  if (!configValid) {
    return (
      <div className="min-h-screen bg-cyber-black flex items-center justify-center p-8">
        <div className="max-w-lg w-full cyber-card p-8">
          <h1 className="text-2xl font-bold text-cyber-red mb-4">
            Configuration Error
          </h1>
          <p className="text-gray-400 mb-4">
            The following required environment variables are missing:
          </p>
          <div className="bg-cyber-black/50 p-4 rounded border border-cyber-red/30 font-mono text-sm mb-6">
            {missingVars.map((v) => (
              <div key={v} className="text-cyber-red py-1">
                {v}
              </div>
            ))}
          </div>
          <p className="text-gray-500 text-sm">
            Please configure these variables in your <code className="text-cyber-cyan">.env.local</code> file.
            See <code className="text-cyber-cyan">.env.local.example</code> for reference.
          </p>
          <div className="mt-6 p-4 bg-cyber-yellow/10 border border-cyber-yellow/30 rounded">
            <p className="text-sm text-cyber-yellow">
              <strong>Note:</strong> This dashboard requires a running backend.
              Mock data has been removed for production readiness.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

// ============================================
// MAIN DASHBOARD
// ============================================

export default function LaunchpadDashboard() {
  return (
    <ConfigValidator>
      <div className="min-h-screen bg-cyber-black bg-cyber-grid">
        {/* Scanline overlay effect */}
        <div className="pointer-events-none fixed inset-0 z-50 bg-[linear-gradient(transparent_50%,_rgba(0,0,0,0.1)_50%)] bg-[length:100%_4px]" />

        <ErrorBoundary>
          <Header />
        </ErrorBoundary>

        <div className="flex">
          <ErrorBoundary>
            <Sidebar />
          </ErrorBoundary>

          <main className="flex-1 p-6 ml-64 pt-20">
            {/* Top row - Status and Kill Switch */}
            <div className="mb-6 flex gap-6">
              <div className="flex-1">
                <StatusPanel />
              </div>
              <div className="w-80">
                <ErrorBoundary>
                  <KillSwitch />
                </ErrorBoundary>
              </div>
            </div>

            {/* Main Grid - Strategic Launchpad Layout */}
            <div className="grid grid-cols-12 gap-6">
              {/* Trend Intelligence - Full Width */}
              <div className="col-span-12">
                <TrendIntelligenceGrid />
              </div>

              {/* Operations Wing + Activity Feed */}
              <div className="col-span-8">
                <NadfunOperationsWing />
              </div>
              <div className="col-span-4">
                <ActivityFeed />
              </div>

              {/* Bonding Curve Progress + Social Impact */}
              <div className="col-span-6">
                <BondingCurveProgress />
              </div>
              <div className="col-span-6">
                <SocialImpactMonitor />
              </div>

              {/* Latency Timeline - Full Width */}
              <div className="col-span-12">
                <LatencyTimeline />
              </div>
            </div>
          </main>
        </div>
      </div>
    </ConfigValidator>
  );
}
