"use client";

/**
 * Metrics Page
 * 
 * Performance metrics and chain comparison dashboard
 * Acceptance criteria: "Panel updates live during runs"
 */

import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import {
  SpeedGauge,
  ComparisonPanel,
  LatencyBreakdown,
  MetricsSummary,
} from "@/components/metrics";
import { useMetrics } from "@/hooks/use-metrics";
import { Loader2, RefreshCw, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

export default function MetricsPage() {
  const { data, loading, refresh, lastUpdated } = useMetrics({
    refreshIntervalMs: 2000, // Fast updates for live feel
    autoRefresh: true,
  });

  return (
    <div className="min-h-screen bg-cyber-black bg-cyber-grid">
      {/* Scanline overlay */}
      <div className="pointer-events-none fixed inset-0 z-50 bg-[linear-gradient(transparent_50%,_rgba(0,0,0,0.1)_50%)] bg-[length:100%_4px]" />

      <Header />

      <div className="flex">
        <Sidebar />

        <main className="flex-1 p-6 ml-64">
          {/* Page header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-display font-bold text-gradient mb-2">
                PERFORMANCE METRICS
              </h1>
              <p className="text-cyber-gray">
                Real-time latency tracking and chain comparison
              </p>
            </div>

            <div className="flex items-center gap-4">
              {/* Last updated */}
              {lastUpdated && (
                <span className="text-xs text-cyber-gray">
                  Updated: {new Date(lastUpdated).toLocaleTimeString()}
                </span>
              )}

              {/* Refresh button */}
              <button
                onClick={refresh}
                disabled={loading}
                className={cn(
                  "p-2 rounded bg-cyber-gray/20 text-cyber-gray",
                  "hover:text-white hover:bg-cyber-gray/30 transition-colors",
                  "disabled:opacity-50"
                )}
                title="Refresh metrics"
              >
                <RefreshCw className={cn("w-5 h-5", loading && "animate-spin")} />
              </button>

              {/* Live indicator */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-neon-green/20 border border-neon-green/30">
                <div className="w-2 h-2 rounded-full bg-neon-green animate-pulse" />
                <span className="text-xs text-neon-green font-bold">LIVE</span>
              </div>
            </div>
          </div>

          {loading && !data ? (
            <div className="flex items-center justify-center h-96">
              <div className="text-center">
                <Loader2 className="w-12 h-12 text-cyber-purple animate-spin mx-auto mb-4" />
                <p className="text-cyber-gray">Loading metrics...</p>
              </div>
            </div>
          ) : data ? (
            <div className="space-y-6">
              {/* Summary row */}
              <MetricsSummary data={data.summary} />

              {/* Main content grid */}
              <div className="grid grid-cols-12 gap-6">
                {/* Speed Gauge - 4 columns */}
                <div className="col-span-4">
                  <SpeedGauge data={data.gaugeData} />
                </div>

                {/* Chain Comparison - 8 columns */}
                <div className="col-span-8">
                  <ComparisonPanel data={data.chainComparisons} />
                </div>
              </div>

              {/* Latency Breakdown - Full width */}
              <LatencyBreakdown stats={data.latencyStats} />

              {/* Source legend */}
              <div className="cyber-card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Activity className="w-4 h-4 text-cyber-gray" />
                  <span className="text-sm text-cyber-gray font-bold">DATA SOURCE LEGEND</span>
                </div>
                <div className="flex flex-wrap gap-4 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded bg-neon-green/20 text-neon-green border border-neon-green/30">
                      [measured]
                    </span>
                    <span className="text-cyber-gray">Real-time measurement from system</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded bg-cyber-purple/20 text-cyber-purple border border-cyber-purple/30">
                      [config-ref]
                    </span>
                    <span className="text-cyber-gray">Reference value from configuration</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded bg-cyber-cyan/20 text-cyber-cyan border border-cyber-cyan/30">
                      [simulated]
                    </span>
                    <span className="text-cyber-gray">Simulated value for development</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded bg-cyber-yellow/20 text-cyber-yellow border border-cyber-yellow/30">
                      [estimated]
                    </span>
                    <span className="text-cyber-gray">Calculated estimate</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-96">
              <div className="text-center text-cyber-gray">
                <Activity className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No metrics data available</p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
