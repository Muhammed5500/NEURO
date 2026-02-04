"use client";

/**
 * Glitch Overlay
 * 
 * Red glitch effect for critical events
 * Turkish: "Kritik bir hata veya yüksek riskli bir 'Action Card' geldiğinde
 * ekranın kenarlarında hafif bir kırmızı glitch efekti tetikle."
 */

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { AgentEvent } from "@/types/agent-events";

interface GlitchOverlayProps {
  event?: AgentEvent | null;
  duration?: number;
}

export function GlitchOverlay({ event, duration = 2000 }: GlitchOverlayProps) {
  const [active, setActive] = useState(false);
  const [intensity, setIntensity] = useState<"low" | "medium" | "high">("low");

  // Trigger glitch effect
  const triggerGlitch = useCallback((newIntensity: "low" | "medium" | "high") => {
    setIntensity(newIntensity);
    setActive(true);
    setTimeout(() => setActive(false), duration);
  }, [duration]);

  // Watch for critical events
  useEffect(() => {
    if (!event) return;

    // Turkish: "Kritik bir hata veya yüksek riskli bir 'Action Card'"
    if (
      event.severity === "critical" ||
      event.severity === "error" ||
      (event.actionCard?.priority === "critical") ||
      event.type === "KILL_SWITCH"
    ) {
      const newIntensity = 
        event.severity === "critical" || event.actionCard?.priority === "critical"
          ? "high"
          : event.severity === "error" || event.actionCard?.priority === "high"
          ? "medium"
          : "low";
      
      triggerGlitch(newIntensity);
    }
  }, [event, triggerGlitch]);

  return (
    <AnimatePresence>
      {active && (
        <>
          {/* Top edge */}
          <motion.div
            initial={{ opacity: 0, scaleY: 0 }}
            animate={{ 
              opacity: [0, 0.8, 0.4, 0.9, 0],
              scaleY: [0, 1, 0.5, 1, 0],
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: duration / 1000, ease: "easeInOut" }}
            className="fixed top-0 left-0 right-0 h-2 z-[100] pointer-events-none"
            style={{
              background: intensity === "high"
                ? "linear-gradient(to bottom, rgba(239, 68, 68, 0.9), transparent)"
                : intensity === "medium"
                ? "linear-gradient(to bottom, rgba(239, 68, 68, 0.6), transparent)"
                : "linear-gradient(to bottom, rgba(239, 68, 68, 0.3), transparent)",
              boxShadow: `0 0 ${intensity === "high" ? 30 : intensity === "medium" ? 20 : 10}px rgba(239, 68, 68, 0.5)`,
            }}
          />

          {/* Bottom edge */}
          <motion.div
            initial={{ opacity: 0, scaleY: 0 }}
            animate={{ 
              opacity: [0, 0.8, 0.4, 0.9, 0],
              scaleY: [0, 1, 0.5, 1, 0],
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: duration / 1000, ease: "easeInOut", delay: 0.1 }}
            className="fixed bottom-0 left-0 right-0 h-2 z-[100] pointer-events-none"
            style={{
              background: intensity === "high"
                ? "linear-gradient(to top, rgba(239, 68, 68, 0.9), transparent)"
                : intensity === "medium"
                ? "linear-gradient(to top, rgba(239, 68, 68, 0.6), transparent)"
                : "linear-gradient(to top, rgba(239, 68, 68, 0.3), transparent)",
              boxShadow: `0 0 ${intensity === "high" ? 30 : intensity === "medium" ? 20 : 10}px rgba(239, 68, 68, 0.5)`,
            }}
          />

          {/* Left edge */}
          <motion.div
            initial={{ opacity: 0, scaleX: 0 }}
            animate={{ 
              opacity: [0, 0.7, 0.3, 0.8, 0],
              scaleX: [0, 1, 0.5, 1, 0],
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: duration / 1000, ease: "easeInOut", delay: 0.05 }}
            className="fixed top-0 bottom-0 left-0 w-2 z-[100] pointer-events-none"
            style={{
              background: intensity === "high"
                ? "linear-gradient(to right, rgba(239, 68, 68, 0.9), transparent)"
                : intensity === "medium"
                ? "linear-gradient(to right, rgba(239, 68, 68, 0.6), transparent)"
                : "linear-gradient(to right, rgba(239, 68, 68, 0.3), transparent)",
              boxShadow: `0 0 ${intensity === "high" ? 30 : intensity === "medium" ? 20 : 10}px rgba(239, 68, 68, 0.5)`,
            }}
          />

          {/* Right edge */}
          <motion.div
            initial={{ opacity: 0, scaleX: 0 }}
            animate={{ 
              opacity: [0, 0.7, 0.3, 0.8, 0],
              scaleX: [0, 1, 0.5, 1, 0],
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: duration / 1000, ease: "easeInOut", delay: 0.15 }}
            className="fixed top-0 bottom-0 right-0 w-2 z-[100] pointer-events-none"
            style={{
              background: intensity === "high"
                ? "linear-gradient(to left, rgba(239, 68, 68, 0.9), transparent)"
                : intensity === "medium"
                ? "linear-gradient(to left, rgba(239, 68, 68, 0.6), transparent)"
                : "linear-gradient(to left, rgba(239, 68, 68, 0.3), transparent)",
              boxShadow: `0 0 ${intensity === "high" ? 30 : intensity === "medium" ? 20 : 10}px rgba(239, 68, 68, 0.5)`,
            }}
          />

          {/* Glitch lines */}
          {intensity === "high" && (
            <>
              <motion.div
                animate={{
                  y: ["-100%", "100%"],
                  opacity: [0, 1, 1, 0],
                }}
                transition={{
                  duration: 0.3,
                  repeat: 3,
                  repeatType: "loop",
                }}
                className="fixed left-0 right-0 h-1 bg-cyber-red/50 z-[100] pointer-events-none"
                style={{ top: "30%" }}
              />
              <motion.div
                animate={{
                  y: ["-100%", "100%"],
                  opacity: [0, 1, 1, 0],
                }}
                transition={{
                  duration: 0.4,
                  repeat: 2,
                  repeatType: "loop",
                  delay: 0.2,
                }}
                className="fixed left-0 right-0 h-0.5 bg-cyber-red/30 z-[100] pointer-events-none"
                style={{ top: "60%" }}
              />
            </>
          )}

          {/* Corner flashes */}
          {intensity !== "low" && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 1, 0, 1, 0] }}
                transition={{ duration: 0.5, repeat: 2 }}
                className="fixed top-0 left-0 w-20 h-20 z-[100] pointer-events-none"
                style={{
                  background: "radial-gradient(circle at top left, rgba(239, 68, 68, 0.5), transparent 70%)",
                }}
              />
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 1, 0, 1, 0] }}
                transition={{ duration: 0.5, repeat: 2, delay: 0.1 }}
                className="fixed top-0 right-0 w-20 h-20 z-[100] pointer-events-none"
                style={{
                  background: "radial-gradient(circle at top right, rgba(239, 68, 68, 0.5), transparent 70%)",
                }}
              />
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 1, 0, 1, 0] }}
                transition={{ duration: 0.5, repeat: 2, delay: 0.2 }}
                className="fixed bottom-0 left-0 w-20 h-20 z-[100] pointer-events-none"
                style={{
                  background: "radial-gradient(circle at bottom left, rgba(239, 68, 68, 0.5), transparent 70%)",
                }}
              />
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 1, 0, 1, 0] }}
                transition={{ duration: 0.5, repeat: 2, delay: 0.3 }}
                className="fixed bottom-0 right-0 w-20 h-20 z-[100] pointer-events-none"
                style={{
                  background: "radial-gradient(circle at bottom right, rgba(239, 68, 68, 0.5), transparent 70%)",
                }}
              />
            </>
          )}
        </>
      )}
    </AnimatePresence>
  );
}

/**
 * Hook to manually trigger glitch effect
 */
export function useGlitch() {
  const [glitchEvent, setGlitchEvent] = useState<AgentEvent | null>(null);

  const triggerGlitch = useCallback((
    severity: "critical" | "error" = "error",
    message = "Critical event"
  ) => {
    setGlitchEvent({
      id: crypto.randomUUID(),
      runId: "manual",
      timestamp: Date.now(),
      type: "SYSTEM_MESSAGE",
      severity,
      message,
    });
    
    // Clear after animation
    setTimeout(() => setGlitchEvent(null), 2500);
  }, []);

  return { glitchEvent, triggerGlitch };
}
