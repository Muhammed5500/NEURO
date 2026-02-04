"use client";

/**
 * Event Card Component
 * 
 * Displays a single agent event with typewriter effect
 * Turkish: "Terminal benzeri 'typewriter' efekti olsun"
 */

import { useState, useEffect, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  MessageSquare,
  Zap,
  Shield,
  Eye,
  TrendingUp,
  Server,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { JsonViewer } from "./json-viewer";
import type { AgentEvent, AgentRole, EventSeverity, EventType } from "@/types/agent-events";

interface EventCardProps {
  event: AgentEvent;
  showTypewriter?: boolean;
  isNew?: boolean;
}

// Agent icons
const AGENT_ICONS: Record<AgentRole, React.ElementType> = {
  scout: Eye,
  macro: TrendingUp,
  onchain: Server,
  risk: Shield,
  adversarial: AlertTriangle,
};

// Agent colors
const AGENT_COLORS: Record<AgentRole, string> = {
  scout: "text-neon-cyan border-neon-cyan",
  macro: "text-neon-green border-neon-green",
  onchain: "text-cyber-purple border-cyber-purple",
  risk: "text-cyber-yellow border-cyber-yellow",
  adversarial: "text-cyber-red border-cyber-red",
};

// Severity styles
const SEVERITY_STYLES: Record<EventSeverity, string> = {
  debug: "border-cyber-gray/30 bg-cyber-gray/5",
  info: "border-cyber-purple/30 bg-cyber-purple/5",
  warn: "border-cyber-yellow/30 bg-cyber-yellow/5",
  error: "border-cyber-red/30 bg-cyber-red/5",
  critical: "border-cyber-red bg-cyber-red/10 animate-pulse",
};

// Event type icons
const EVENT_ICONS: Record<EventType, React.ElementType> = {
  AGENT_START: Loader2,
  AGENT_THINKING: Brain,
  AGENT_OPINION: MessageSquare,
  AGENT_COMPLETE: CheckCircle2,
  CONSENSUS_START: Zap,
  CONSENSUS_VOTE: CheckCircle2,
  CONSENSUS_RESULT: CheckCircle2,
  ACTION_CARD: AlertTriangle,
  EXECUTION_PLAN: Server,
  KILL_SWITCH: XCircle,
  SYSTEM_MESSAGE: Server,
};

export const EventCard = memo(function EventCard({
  event,
  showTypewriter = false,
  isNew = false,
}: EventCardProps) {
  const [displayedMessage, setDisplayedMessage] = useState(
    showTypewriter ? "" : event.message
  );
  const [showJson, setShowJson] = useState(false);

  // Typewriter effect
  // Turkish: "terminal benzeri 'typewriter' efekti"
  useEffect(() => {
    if (!showTypewriter) {
      setDisplayedMessage(event.message);
      return;
    }

    let index = 0;
    const interval = setInterval(() => {
      if (index <= event.message.length) {
        setDisplayedMessage(event.message.slice(0, index));
        index++;
      } else {
        clearInterval(interval);
      }
    }, 15); // 15ms per character

    return () => clearInterval(interval);
  }, [event.message, showTypewriter]);

  const AgentIcon = event.agent ? AGENT_ICONS[event.agent] : EVENT_ICONS[event.type];
  const agentColor = event.agent ? AGENT_COLORS[event.agent] : "text-cyber-purple border-cyber-purple";

  return (
    <motion.div
      initial={isNew ? { opacity: 0, x: -20 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3 }}
      className={cn(
        "cyber-card p-4 mb-3 border-l-4 transition-all",
        SEVERITY_STYLES[event.severity],
        agentColor.split(" ")[1], // border color
        isNew && "ring-1 ring-neon-green/50"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {/* Agent/Event Icon */}
          <div className={cn("p-1.5 rounded bg-cyber-dark/50", agentColor.split(" ")[0])}>
            <AgentIcon className="w-4 h-4" />
          </div>

          {/* Agent name or event type */}
          <span className={cn("font-bold uppercase text-sm", agentColor.split(" ")[0])}>
            {event.agent || event.type}
          </span>

          {/* Event type badge */}
          {event.agent && (
            <span className="text-xs px-2 py-0.5 rounded bg-cyber-gray/50 text-cyber-gray">
              {event.type}
            </span>
          )}

          {/* Severity badge */}
          {event.severity !== "info" && (
            <span className={cn(
              "text-xs px-2 py-0.5 rounded uppercase font-bold",
              event.severity === "warn" && "bg-cyber-yellow/20 text-cyber-yellow",
              event.severity === "error" && "bg-cyber-red/20 text-cyber-red",
              event.severity === "critical" && "bg-cyber-red/30 text-cyber-red animate-pulse"
            )}>
              {event.severity}
            </span>
          )}
        </div>

        {/* Timestamp */}
        <span className="text-xs text-cyber-gray font-mono">
          {new Date(event.timestamp).toLocaleTimeString()}
        </span>
      </div>

      {/* Message */}
      <div className="font-mono text-sm text-white/90 mb-2">
        {displayedMessage}
        {showTypewriter && displayedMessage.length < event.message.length && (
          <span className="inline-block w-2 h-4 bg-neon-green animate-pulse ml-0.5" />
        )}
      </div>

      {/* Action Card Preview */}
      {event.actionCard && (
        <div className={cn(
          "mt-3 p-3 rounded border",
          event.actionCard.priority === "critical" && "border-cyber-red bg-cyber-red/10",
          event.actionCard.priority === "high" && "border-orange-500 bg-orange-500/10",
          event.actionCard.priority === "medium" && "border-cyber-yellow bg-cyber-yellow/10",
          event.actionCard.priority === "low" && "border-cyber-green bg-cyber-green/10"
        )}>
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className={cn(
              "w-4 h-4",
              event.actionCard.priority === "critical" && "text-cyber-red",
              event.actionCard.priority === "high" && "text-orange-500",
              event.actionCard.priority === "medium" && "text-cyber-yellow",
              event.actionCard.priority === "low" && "text-cyber-green"
            )} />
            <span className="text-sm font-bold uppercase">
              {event.actionCard.priority} Priority Action
            </span>
          </div>
          <p className="text-sm text-white/80">
            {event.actionCard.suggestedAction}
            {event.actionCard.tokenSymbol && (
              <span className="ml-2 text-cyber-cyan">
                [{event.actionCard.tokenSymbol}]
              </span>
            )}
          </p>
        </div>
      )}

      {/* Chain of Thought */}
      {event.chainOfThought && (
        <div className="mt-3 p-3 rounded bg-cyber-gray/20 border border-cyber-gray/30">
          <p className="text-xs text-cyber-gray mb-1 uppercase font-bold">Chain of Thought</p>
          <p className="text-sm text-white/70 italic">{event.chainOfThought}</p>
        </div>
      )}

      {/* JSON Data Toggle */}
      {event.data && Object.keys(event.data).length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowJson(!showJson)}
            className="text-xs text-cyber-purple hover:text-neon-purple transition-colors flex items-center gap-1"
          >
            {showJson ? "Hide" : "Show"} Data
            <span className="text-cyber-gray">({Object.keys(event.data).length} fields)</span>
          </button>

          <AnimatePresence>
            {showJson && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-2 p-3 rounded bg-cyber-black/50 border border-cyber-gray/30 overflow-hidden"
              >
                <JsonViewer data={event.data} maxDepth={3} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
});
