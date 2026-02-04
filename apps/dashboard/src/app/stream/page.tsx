"use client";

/**
 * Stream Page
 * 
 * Live agent message streaming and replay
 * Turkish: "Orchestrator'dan gelen AgentEvent akışını kesintisiz şekilde dinle"
 */

import { useState, useCallback } from "react";
import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import {
  LiveStreamPanel,
  ReplayPanel,
  RunSelector,
  GlitchOverlay,
  useGlitch,
} from "@/components/stream";
import { useAgentStream } from "@/hooks/use-agent-stream";
import { Radio, History } from "lucide-react";
import { cn } from "@/lib/utils";

type ViewMode = "live" | "replay";

export default function StreamPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("live");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  
  // Glitch effect hook
  const { glitchEvent, triggerGlitch } = useGlitch();
  
  // Live stream for glitch detection
  const { latestEvent } = useAgentStream({
    autoConnect: viewMode === "live",
    onEvent: (event) => {
      // Trigger glitch on critical events
      if (
        event.severity === "critical" ||
        event.actionCard?.priority === "critical" ||
        event.type === "KILL_SWITCH"
      ) {
        // The GlitchOverlay will handle this via the latestEvent prop
      }
    },
  });

  // Handle run selection
  const handleSelectRun = useCallback((runId: string) => {
    setSelectedRunId(runId);
    setViewMode("replay");
  }, []);

  // Exit replay mode
  const handleExitReplay = useCallback(() => {
    setSelectedRunId(null);
    setViewMode("live");
  }, []);

  return (
    <div className="min-h-screen bg-cyber-black bg-cyber-grid">
      {/* Scanline overlay */}
      <div className="pointer-events-none fixed inset-0 z-50 bg-[linear-gradient(transparent_50%,_rgba(0,0,0,0.1)_50%)] bg-[length:100%_4px]" />
      
      {/* Glitch overlay for critical events */}
      <GlitchOverlay event={viewMode === "live" ? latestEvent : glitchEvent} />

      <Header />

      <div className="flex">
        <Sidebar />

        <main className="flex-1 p-6 ml-64">
          {/* Page header */}
          <div className="mb-6">
            <h1 className="text-3xl font-display font-bold text-gradient mb-2">
              AGENT STREAM
            </h1>
            <p className="text-cyber-gray">
              Real-time agent message monitoring and replay
            </p>
          </div>

          {/* View mode tabs */}
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setViewMode("live")}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded transition-colors",
                viewMode === "live"
                  ? "bg-neon-green/20 text-neon-green border border-neon-green/50"
                  : "bg-cyber-gray/20 text-cyber-gray hover:text-white border border-transparent"
              )}
            >
              <Radio className={cn("w-4 h-4", viewMode === "live" && "animate-pulse")} />
              Live Stream
            </button>
            <button
              onClick={() => setViewMode("replay")}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded transition-colors",
                viewMode === "replay"
                  ? "bg-cyber-purple/20 text-cyber-purple border border-cyber-purple/50"
                  : "bg-cyber-gray/20 text-cyber-gray hover:text-white border border-transparent"
              )}
            >
              <History className="w-4 h-4" />
              Replay History
            </button>
          </div>

          {/* Content */}
          <div className="grid grid-cols-12 gap-6">
            {viewMode === "live" ? (
              <>
                {/* Live stream panel - main content */}
                <div className="col-span-9">
                  <LiveStreamPanel className="h-[calc(100vh-280px)]" />
                </div>

                {/* Run selector sidebar */}
                <div className="col-span-3">
                  <RunSelector
                    onSelectRun={handleSelectRun}
                    selectedRunId={selectedRunId || undefined}
                  />
                </div>
              </>
            ) : (
              <>
                {/* Replay panel - main content */}
                <div className="col-span-9">
                  {selectedRunId ? (
                    <ReplayPanel
                      runId={selectedRunId}
                      onClose={handleExitReplay}
                      className="h-[calc(100vh-280px)]"
                    />
                  ) : (
                    <div className="cyber-card flex items-center justify-center h-96">
                      <div className="text-center text-cyber-gray">
                        <History className="w-16 h-16 mx-auto mb-4 opacity-50" />
                        <p className="text-lg font-display mb-2">Select a run to replay</p>
                        <p className="text-sm">Choose from the history panel on the right</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Run selector sidebar */}
                <div className="col-span-3">
                  <RunSelector
                    onSelectRun={handleSelectRun}
                    selectedRunId={selectedRunId || undefined}
                  />
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
