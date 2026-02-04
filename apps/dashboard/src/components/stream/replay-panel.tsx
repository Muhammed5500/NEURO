"use client";

/**
 * Replay Panel
 * 
 * Replay historical run events with play/pause controls
 * Turkish: "Geçmiş bir run_id seçildiğinde, logları zamana göre sıralayıp
 * bir 'Play/Pause' mekanizmasıyla sanki o an oluyormuş gibi yeniden oynat"
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  FastForward,
  RefreshCw,
  Clock,
  History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useRunEvents } from "@/hooks/use-agent-stream";
import { EventCard } from "./event-card";
import type { AgentEvent, ReplayState } from "@/types/agent-events";

interface ReplayPanelProps {
  runId: string;
  className?: string;
  onClose?: () => void;
}

const SPEED_OPTIONS = [0.5, 1, 2, 4, 8];

export function ReplayPanel({ runId, className, onClose }: ReplayPanelProps) {
  const { events, loading, error } = useRunEvents(runId);
  
  const [replayState, setReplayState] = useState<ReplayState>({
    isPlaying: false,
    isPaused: true,
    currentIndex: 0,
    speed: 1,
  });
  
  const [visibleEvents, setVisibleEvents] = useState<AgentEvent[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Calculate time until next event
  const getNextEventDelay = useCallback((currentIndex: number): number => {
    if (currentIndex >= events.length - 1) return 0;
    
    const current = events[currentIndex];
    const next = events[currentIndex + 1];
    const delay = next.timestamp - current.timestamp;
    
    // Cap at 5 seconds, scale by speed
    return Math.min(5000, delay) / replayState.speed;
  }, [events, replayState.speed]);

  // Play next event
  // Turkish: "sanki o an oluyormuş gibi yeniden oynat"
  const playNextEvent = useCallback(() => {
    if (replayState.currentIndex >= events.length) {
      setReplayState(prev => ({ ...prev, isPlaying: false, isPaused: true }));
      return;
    }

    // Add event to visible list
    setVisibleEvents(prev => [...prev, events[replayState.currentIndex]]);
    
    // Scroll to bottom
    setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, 50);

    // Schedule next event
    const nextIndex = replayState.currentIndex + 1;
    if (nextIndex < events.length) {
      const delay = getNextEventDelay(replayState.currentIndex);
      timeoutRef.current = setTimeout(() => {
        setReplayState(prev => ({ ...prev, currentIndex: nextIndex }));
      }, delay);
    } else {
      setReplayState(prev => ({ ...prev, isPlaying: false, isPaused: true }));
    }
  }, [events, replayState.currentIndex, getNextEventDelay]);

  // Effect to play events
  useEffect(() => {
    if (replayState.isPlaying && !replayState.isPaused) {
      playNextEvent();
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [replayState.isPlaying, replayState.isPaused, replayState.currentIndex, playNextEvent]);

  // Play/Pause toggle
  // Turkish: "'Play/Pause' mekanizması"
  const handlePlayPause = useCallback(() => {
    if (!replayState.isPlaying) {
      // Start playing
      setReplayState(prev => ({
        ...prev,
        isPlaying: true,
        isPaused: false,
        startTime: Date.now(),
      }));
    } else if (replayState.isPaused) {
      // Resume
      setReplayState(prev => ({ ...prev, isPaused: false }));
    } else {
      // Pause
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      setReplayState(prev => ({ ...prev, isPaused: true }));
    }
  }, [replayState.isPlaying, replayState.isPaused]);

  // Reset replay
  const handleReset = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setReplayState({
      isPlaying: false,
      isPaused: true,
      currentIndex: 0,
      speed: 1,
    });
    setVisibleEvents([]);
  }, []);

  // Skip to event
  const handleSkipTo = useCallback((index: number) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    // Show all events up to index
    setVisibleEvents(events.slice(0, index + 1));
    setReplayState(prev => ({
      ...prev,
      currentIndex: index + 1,
      isPaused: true,
    }));
  }, [events]);

  // Skip forward/back
  const handleSkipForward = useCallback(() => {
    const newIndex = Math.min(replayState.currentIndex + 5, events.length - 1);
    handleSkipTo(newIndex);
  }, [replayState.currentIndex, events.length, handleSkipTo]);

  const handleSkipBack = useCallback(() => {
    const newIndex = Math.max(replayState.currentIndex - 5, 0);
    handleSkipTo(newIndex);
  }, [replayState.currentIndex, handleSkipTo]);

  // Change speed
  const handleSpeedChange = useCallback(() => {
    const currentSpeedIndex = SPEED_OPTIONS.indexOf(replayState.speed);
    const nextIndex = (currentSpeedIndex + 1) % SPEED_OPTIONS.length;
    setReplayState(prev => ({ ...prev, speed: SPEED_OPTIONS[nextIndex] }));
  }, [replayState.speed]);

  // Progress percentage
  const progress = events.length > 0
    ? (replayState.currentIndex / events.length) * 100
    : 0;

  if (loading) {
    return (
      <div className={cn("cyber-card flex items-center justify-center h-96", className)}>
        <RefreshCw className="w-8 h-8 text-cyber-purple animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("cyber-card flex items-center justify-center h-96", className)}>
        <div className="text-center">
          <p className="text-cyber-red mb-2">Failed to load run events</p>
          <p className="text-sm text-cyber-gray">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("cyber-card flex flex-col h-full", className)}>
      {/* Header */}
      <div className="p-4 border-b border-cyber-purple/30">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <History className="w-5 h-5 text-cyber-purple" />
            <h2 className="text-lg font-display font-bold text-neon-purple">
              REPLAY MODE
            </h2>
            <span className="text-xs text-cyber-gray bg-cyber-dark px-2 py-1 rounded font-mono">
              {runId.slice(0, 8)}...
            </span>
          </div>

          {onClose && (
            <button
              onClick={onClose}
              className="text-cyber-gray hover:text-white transition-colors"
            >
              Exit Replay
            </button>
          )}
        </div>

        {/* Progress bar */}
        <div className="mb-4">
          <div className="h-2 bg-cyber-dark rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-cyber-purple to-cyber-pink"
              style={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
          <div className="flex justify-between text-xs text-cyber-gray mt-1">
            <span>{replayState.currentIndex} / {events.length} events</span>
            <span>{progress.toFixed(0)}%</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-4">
          {/* Reset */}
          <button
            onClick={handleReset}
            className="p-2 rounded bg-cyber-gray/20 text-cyber-gray hover:text-white transition-colors"
            title="Reset"
          >
            <RefreshCw className="w-5 h-5" />
          </button>

          {/* Skip Back */}
          <button
            onClick={handleSkipBack}
            disabled={replayState.currentIndex === 0}
            className="p-2 rounded bg-cyber-gray/20 text-cyber-gray hover:text-white 
                      disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Skip back 5 events"
          >
            <SkipBack className="w-5 h-5" />
          </button>

          {/* Play/Pause */}
          <button
            onClick={handlePlayPause}
            className={cn(
              "p-4 rounded-full transition-all",
              replayState.isPlaying && !replayState.isPaused
                ? "bg-cyber-yellow text-black"
                : "bg-neon-green text-black hover:scale-105"
            )}
            title={replayState.isPaused ? "Play" : "Pause"}
          >
            {replayState.isPaused ? (
              <Play className="w-6 h-6" />
            ) : (
              <Pause className="w-6 h-6" />
            )}
          </button>

          {/* Skip Forward */}
          <button
            onClick={handleSkipForward}
            disabled={replayState.currentIndex >= events.length - 1}
            className="p-2 rounded bg-cyber-gray/20 text-cyber-gray hover:text-white 
                      disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Skip forward 5 events"
          >
            <SkipForward className="w-5 h-5" />
          </button>

          {/* Speed */}
          <button
            onClick={handleSpeedChange}
            className="px-3 py-2 rounded bg-cyber-purple/20 text-cyber-purple hover:bg-cyber-purple/30 
                      transition-colors flex items-center gap-1"
            title="Change speed"
          >
            <FastForward className="w-4 h-4" />
            <span className="text-sm font-bold">{replayState.speed}x</span>
          </button>
        </div>
      </div>

      {/* Event Timeline */}
      <div className="flex-1 flex">
        {/* Mini timeline */}
        <div className="w-20 border-r border-cyber-gray/30 p-2 overflow-y-auto">
          {events.map((event, index) => (
            <button
              key={event.id}
              onClick={() => handleSkipTo(index)}
              className={cn(
                "w-full text-left p-1 rounded text-xs mb-1 transition-colors",
                index < replayState.currentIndex
                  ? "bg-cyber-purple/20 text-cyber-purple"
                  : index === replayState.currentIndex
                  ? "bg-neon-green/20 text-neon-green"
                  : "text-cyber-gray hover:text-white"
              )}
              title={`${event.type} - ${event.agent || "system"}`}
            >
              <Clock className="w-3 h-3 inline mr-1" />
              {new Date(event.timestamp).toLocaleTimeString().slice(0, 5)}
            </button>
          ))}
        </div>

        {/* Events display */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4"
        >
          {visibleEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-cyber-gray">
              <Play className="w-12 h-12 mb-4 opacity-50" />
              <p className="text-lg font-display">Press Play to start replay</p>
              <p className="text-sm">{events.length} events to replay</p>
            </div>
          ) : (
            visibleEvents.map((event, index) => (
              <EventCard
                key={event.id}
                event={event}
                showTypewriter={index === visibleEvents.length - 1 && !replayState.isPaused}
                isNew={index === visibleEvents.length - 1}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
