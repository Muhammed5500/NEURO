"use client";

/**
 * Run Selector Component
 * 
 * Select historical runs for replay
 */

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  History,
  Play,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Search,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { RunMetadata } from "@/types/agent-events";

interface RunSelectorProps {
  onSelectRun: (runId: string) => void;
  selectedRunId?: string;
  className?: string;
}

const API_URL = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || "http://localhost:4000";

export function RunSelector({ onSelectRun, selectedRunId, className }: RunSelectorProps) {
  const [runs, setRuns] = useState<RunMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch runs
  const fetchRuns = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/runs`);
      if (!response.ok) throw new Error("Failed to fetch runs");
      
      const data = await response.json();
      setRuns(data.runs || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRuns();
  }, []);

  // Filter runs
  const filteredRuns = runs.filter(run => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      run.id.toLowerCase().includes(query) ||
      run.query?.toLowerCase().includes(query) ||
      run.tokenSymbol?.toLowerCase().includes(query)
    );
  });

  // Status icon
  const getStatusIcon = (status: RunMetadata["status"]) => {
    switch (status) {
      case "running":
        return <Loader2 className="w-4 h-4 text-cyber-yellow animate-spin" />;
      case "completed":
        return <CheckCircle2 className="w-4 h-4 text-neon-green" />;
      case "failed":
        return <XCircle className="w-4 h-4 text-cyber-red" />;
      case "cancelled":
        return <XCircle className="w-4 h-4 text-cyber-gray" />;
      default:
        return <Clock className="w-4 h-4 text-cyber-gray" />;
    }
  };

  return (
    <div className={cn("cyber-card", className)}>
      {/* Header */}
      <div className="p-4 border-b border-cyber-purple/30">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-cyber-purple" />
            <h2 className="text-lg font-display font-bold text-neon-purple">
              RUN HISTORY
            </h2>
            <span className="text-xs text-cyber-gray bg-cyber-dark px-2 py-1 rounded">
              {runs.length} runs
            </span>
          </div>

          <button
            onClick={fetchRuns}
            disabled={loading}
            className="p-2 rounded bg-cyber-gray/20 text-cyber-gray hover:text-white 
                      disabled:opacity-50 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyber-gray" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search runs..."
            className="w-full bg-cyber-dark border border-cyber-gray/30 rounded pl-10 pr-4 py-2 text-sm
                      focus:border-cyber-purple focus:outline-none"
          />
        </div>
      </div>

      {/* Run list */}
      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-cyber-purple animate-spin" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 text-cyber-gray">
            <XCircle className="w-8 h-8 mb-2 text-cyber-red" />
            <p>{error}</p>
            <button
              onClick={fetchRuns}
              className="mt-2 text-cyber-purple hover:text-neon-purple text-sm"
            >
              Try again
            </button>
          </div>
        ) : filteredRuns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-cyber-gray">
            <History className="w-8 h-8 mb-2 opacity-50" />
            <p>No runs found</p>
          </div>
        ) : (
          <AnimatePresence>
            {filteredRuns.map(run => (
              <motion.button
                key={run.id}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                onClick={() => onSelectRun(run.id)}
                className={cn(
                  "w-full p-4 text-left border-b border-cyber-gray/20 transition-colors",
                  "hover:bg-cyber-purple/10",
                  selectedRunId === run.id && "bg-cyber-purple/20 border-l-2 border-l-cyber-purple"
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(run.status)}
                    <span className="font-mono text-sm text-cyber-cyan">
                      {run.id.slice(0, 8)}...
                    </span>
                    {run.tokenSymbol && (
                      <span className="px-2 py-0.5 rounded bg-cyber-purple/20 text-cyber-purple text-xs">
                        {run.tokenSymbol}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-cyber-gray">
                    {new Date(run.startedAt).toLocaleString()}
                  </span>
                </div>

                {run.query && (
                  <p className="text-sm text-white/70 truncate mb-2">
                    {run.query}
                  </p>
                )}

                <div className="flex items-center gap-4 text-xs text-cyber-gray">
                  <span>{run.eventCount} events</span>
                  {run.decision && (
                    <>
                      <span className={cn(
                        "px-2 py-0.5 rounded",
                        run.decision.status === "EXECUTE" && "bg-neon-green/20 text-neon-green",
                        run.decision.status === "REJECT" && "bg-cyber-red/20 text-cyber-red",
                        run.decision.status === "HOLD" && "bg-cyber-yellow/20 text-cyber-yellow"
                      )}>
                        {run.decision.status}
                      </span>
                      <span>
                        {(run.decision.confidence * 100).toFixed(0)}% confidence
                      </span>
                    </>
                  )}
                </div>

                {/* Play icon on hover */}
                <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Play className="w-6 h-6 text-neon-green" />
                </div>
              </motion.button>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
