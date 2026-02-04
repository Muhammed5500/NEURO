"use client";

/**
 * Live Stream Panel
 * 
 * Real-time agent event stream with filters
 * Turkish: "Orchestrator'dan gelen AgentEvent akışını kesintisiz şekilde dinle"
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  Pause,
  RefreshCw,
  Filter,
  X,
  Wifi,
  WifiOff,
  Trash2,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentStream } from "@/hooks/use-agent-stream";
import { EventCard } from "./event-card";
import type { AgentRole, EventSeverity, EventType, StreamFilters } from "@/types/agent-events";

interface LiveStreamPanelProps {
  className?: string;
  initialFilters?: StreamFilters;
}

const AGENT_OPTIONS: AgentRole[] = ["scout", "macro", "onchain", "risk", "adversarial"];
const SEVERITY_OPTIONS: EventSeverity[] = ["debug", "info", "warn", "error", "critical"];
const EVENT_TYPE_OPTIONS: EventType[] = [
  "AGENT_START",
  "AGENT_THINKING",
  "AGENT_OPINION",
  "AGENT_COMPLETE",
  "CONSENSUS_RESULT",
  "ACTION_CARD",
];

export function LiveStreamPanel({ className, initialFilters }: LiveStreamPanelProps) {
  const [autoScroll, setAutoScroll] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<StreamFilters>(initialFilters || {});
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastEventIdRef = useRef<string | null>(null);

  const {
    events,
    latestEvent,
    status,
    connect,
    disconnect,
    setFilters: applyFilters,
    clearEvents,
    isConnected,
  } = useAgentStream({
    filters,
    autoConnect: true,
  });

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && scrollRef.current && latestEvent) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [latestEvent, autoScroll]);

  // Track latest event for "new" indicator
  useEffect(() => {
    if (latestEvent) {
      lastEventIdRef.current = latestEvent.id;
    }
  }, [latestEvent]);

  // Apply filters
  const handleApplyFilters = useCallback(() => {
    applyFilters(filters);
    setShowFilters(false);
  }, [filters, applyFilters]);

  // Clear filters
  const handleClearFilters = useCallback(() => {
    setFilters({});
    applyFilters({});
  }, [applyFilters]);

  // Export events
  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(events, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `agent-events-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [events]);

  // Filter toggle handler
  const toggleFilter = <T extends string>(
    key: keyof StreamFilters,
    value: T,
    current: T[] | undefined
  ) => {
    const arr = current || [];
    const newArr = arr.includes(value)
      ? arr.filter(v => v !== value)
      : [...arr, value];
    setFilters(prev => ({ ...prev, [key]: newArr.length ? newArr : undefined }));
  };

  return (
    <div className={cn("cyber-card flex flex-col h-full", className)}>
      {/* Header */}
      <div className="p-4 border-b border-cyber-purple/30">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-display font-bold text-neon-purple neon-text">
              LIVE STREAM
            </h2>
            
            {/* Connection status */}
            <div className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded text-xs font-bold",
              isConnected
                ? "bg-neon-green/20 text-neon-green"
                : status === "connecting"
                ? "bg-cyber-yellow/20 text-cyber-yellow animate-pulse"
                : "bg-cyber-red/20 text-cyber-red"
            )}>
              {isConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {status.toUpperCase()}
            </div>

            {/* Event count */}
            <span className="text-xs text-cyber-gray bg-cyber-dark px-2 py-1 rounded">
              {events.length} events
            </span>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            {/* Auto-scroll toggle */}
            <button
              onClick={() => setAutoScroll(!autoScroll)}
              className={cn(
                "p-2 rounded transition-colors",
                autoScroll
                  ? "bg-neon-green/20 text-neon-green"
                  : "bg-cyber-gray/20 text-cyber-gray hover:text-white"
              )}
              title={autoScroll ? "Auto-scroll ON" : "Auto-scroll OFF"}
            >
              {autoScroll ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            </button>

            {/* Filter button */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={cn(
                "p-2 rounded transition-colors",
                showFilters || Object.keys(filters).some(k => filters[k as keyof StreamFilters])
                  ? "bg-cyber-purple/20 text-cyber-purple"
                  : "bg-cyber-gray/20 text-cyber-gray hover:text-white"
              )}
              title="Filters"
            >
              <Filter className="w-4 h-4" />
            </button>

            {/* Connect/Disconnect */}
            <button
              onClick={isConnected ? disconnect : connect}
              className={cn(
                "p-2 rounded transition-colors",
                isConnected
                  ? "bg-cyber-red/20 text-cyber-red hover:bg-cyber-red/30"
                  : "bg-neon-green/20 text-neon-green hover:bg-neon-green/30"
              )}
              title={isConnected ? "Disconnect" : "Connect"}
            >
              <RefreshCw className={cn("w-4 h-4", status === "connecting" && "animate-spin")} />
            </button>

            {/* Clear */}
            <button
              onClick={clearEvents}
              className="p-2 rounded bg-cyber-gray/20 text-cyber-gray hover:text-white transition-colors"
              title="Clear events"
            >
              <Trash2 className="w-4 h-4" />
            </button>

            {/* Export */}
            <button
              onClick={handleExport}
              className="p-2 rounded bg-cyber-gray/20 text-cyber-gray hover:text-white transition-colors"
              title="Export JSON"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filters Panel */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="pt-3 border-t border-cyber-gray/30 space-y-3">
                {/* Run ID */}
                <div>
                  <label className="text-xs text-cyber-gray uppercase mb-1 block">Run ID</label>
                  <input
                    type="text"
                    value={filters.runId || ""}
                    onChange={e => setFilters(prev => ({ ...prev, runId: e.target.value || undefined }))}
                    placeholder="Filter by run ID..."
                    className="w-full bg-cyber-dark border border-cyber-gray/30 rounded px-3 py-2 text-sm
                              focus:border-cyber-purple focus:outline-none"
                  />
                </div>

                {/* Agents */}
                <div>
                  <label className="text-xs text-cyber-gray uppercase mb-1 block">Agents</label>
                  <div className="flex flex-wrap gap-1">
                    {AGENT_OPTIONS.map(agent => (
                      <button
                        key={agent}
                        onClick={() => toggleFilter("agents", agent, filters.agents)}
                        className={cn(
                          "px-2 py-1 rounded text-xs uppercase transition-colors",
                          filters.agents?.includes(agent)
                            ? "bg-cyber-purple text-white"
                            : "bg-cyber-gray/20 text-cyber-gray hover:text-white"
                        )}
                      >
                        {agent}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Severity */}
                <div>
                  <label className="text-xs text-cyber-gray uppercase mb-1 block">Severity</label>
                  <div className="flex flex-wrap gap-1">
                    {SEVERITY_OPTIONS.map(severity => (
                      <button
                        key={severity}
                        onClick={() => toggleFilter("severities", severity, filters.severities)}
                        className={cn(
                          "px-2 py-1 rounded text-xs uppercase transition-colors",
                          filters.severities?.includes(severity)
                            ? severity === "critical" || severity === "error"
                              ? "bg-cyber-red text-white"
                              : severity === "warn"
                              ? "bg-cyber-yellow text-black"
                              : "bg-cyber-purple text-white"
                            : "bg-cyber-gray/20 text-cyber-gray hover:text-white"
                        )}
                      >
                        {severity}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Event Types */}
                <div>
                  <label className="text-xs text-cyber-gray uppercase mb-1 block">Event Types</label>
                  <div className="flex flex-wrap gap-1">
                    {EVENT_TYPE_OPTIONS.map(type => (
                      <button
                        key={type}
                        onClick={() => toggleFilter("eventTypes", type, filters.eventTypes)}
                        className={cn(
                          "px-2 py-1 rounded text-xs transition-colors",
                          filters.eventTypes?.includes(type)
                            ? "bg-cyber-purple text-white"
                            : "bg-cyber-gray/20 text-cyber-gray hover:text-white"
                        )}
                      >
                        {type.replace("_", " ")}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Filter Actions */}
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={handleApplyFilters}
                    className="cyber-button text-sm py-2"
                  >
                    Apply Filters
                  </button>
                  <button
                    onClick={handleClearFilters}
                    className="px-4 py-2 text-sm text-cyber-gray hover:text-white transition-colors"
                  >
                    Clear All
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Event Stream */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-1"
        style={{ maxHeight: "calc(100vh - 300px)" }}
      >
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-cyber-gray">
            <WifiOff className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-lg font-display">No events yet</p>
            <p className="text-sm">Waiting for agent activity...</p>
          </div>
        ) : (
          events.map((event, index) => (
            <EventCard
              key={event.id}
              event={event}
              showTypewriter={index === events.length - 1}
              isNew={event.id === lastEventIdRef.current}
            />
          ))
        )}
      </div>
    </div>
  );
}
