"use client";

/**
 * useAgentStream Hook
 * 
 * SSE hook for streaming agent events with typewriter effect
 * Turkish: "Orchestrator'dan gelen AgentEvent akışını SSE üzerinden kesintisiz dinleyen bir hook"
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type {
  AgentEvent,
  StreamFilters,
  ConnectionStatus,
} from "@/types/agent-events";

interface UseAgentStreamOptions {
  url?: string;
  filters?: StreamFilters;
  autoConnect?: boolean;
  onEvent?: (event: AgentEvent) => void;
  onError?: (error: Error) => void;
}

interface UseAgentStreamReturn {
  // Events
  events: AgentEvent[];
  latestEvent: AgentEvent | null;
  
  // Connection
  status: ConnectionStatus;
  connect: () => void;
  disconnect: () => void;
  
  // Filters
  setFilters: (filters: StreamFilters) => void;
  
  // Clear
  clearEvents: () => void;
  
  // Stats
  eventCount: number;
  isConnected: boolean;
}

const DEFAULT_SSE_URL = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || "http://localhost:4000";

export function useAgentStream(options: UseAgentStreamOptions = {}): UseAgentStreamReturn {
  const {
    url = `${DEFAULT_SSE_URL}/api/stream/events`,
    filters: initialFilters,
    autoConnect = false,
    onEvent,
    onError,
  } = options;

  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [latestEvent, setLatestEvent] = useState<AgentEvent | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [filters, setFilters] = useState<StreamFilters>(initialFilters || {});

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Build URL with filters
  const buildStreamUrl = useCallback(() => {
    const params = new URLSearchParams();
    
    if (filters.runId) {
      params.append("runId", filters.runId);
    }
    if (filters.agents?.length) {
      params.append("agents", filters.agents.join(","));
    }
    if (filters.severities?.length) {
      params.append("severities", filters.severities.join(","));
    }
    if (filters.eventTypes?.length) {
      params.append("types", filters.eventTypes.join(","));
    }
    
    const queryString = params.toString();
    return queryString ? `${url}?${queryString}` : url;
  }, [url, filters]);

  // Connect to SSE stream
  // Turkish: "SSE üzerinden kesintisiz şekilde dinle"
  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setStatus("connecting");

    try {
      const streamUrl = buildStreamUrl();
      const eventSource = new EventSource(streamUrl);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setStatus("connected");
        console.log("[useAgentStream] Connected to SSE stream");
      };

      eventSource.onmessage = (event) => {
        try {
          const agentEvent: AgentEvent = JSON.parse(event.data);
          
          setEvents((prev) => [...prev, agentEvent]);
          setLatestEvent(agentEvent);
          
          onEvent?.(agentEvent);
        } catch (err) {
          console.error("[useAgentStream] Failed to parse event:", err);
        }
      };

      eventSource.onerror = (event) => {
        console.error("[useAgentStream] SSE error:", event);
        setStatus("error");
        
        // Auto-reconnect after 5 seconds
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }
        reconnectTimeoutRef.current = setTimeout(() => {
          if (eventSourceRef.current?.readyState === EventSource.CLOSED) {
            connect();
          }
        }, 5000);
        
        onError?.(new Error("SSE connection error"));
      };

      // Listen for specific event types
      eventSource.addEventListener("agent_event", (event) => {
        try {
          const agentEvent: AgentEvent = JSON.parse(event.data);
          setEvents((prev) => [...prev, agentEvent]);
          setLatestEvent(agentEvent);
          onEvent?.(agentEvent);
        } catch (err) {
          console.error("[useAgentStream] Failed to parse agent_event:", err);
        }
      });

      eventSource.addEventListener("heartbeat", () => {
        // Keep-alive, no action needed
      });

    } catch (err) {
      console.error("[useAgentStream] Failed to connect:", err);
      setStatus("error");
      onError?.(err as Error);
    }
  }, [buildStreamUrl, onEvent, onError]);

  // Disconnect
  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    setStatus("disconnected");
    console.log("[useAgentStream] Disconnected from SSE stream");
  }, []);

  // Clear events
  const clearEvents = useCallback(() => {
    setEvents([]);
    setLatestEvent(null);
  }, []);

  // Auto-connect
  useEffect(() => {
    if (autoConnect) {
      connect();
    }
    
    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  // Reconnect when filters change
  useEffect(() => {
    if (status === "connected") {
      disconnect();
      connect();
    }
  }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    events,
    latestEvent,
    status,
    connect,
    disconnect,
    setFilters,
    clearEvents,
    eventCount: events.length,
    isConnected: status === "connected",
  };
}

/**
 * Hook for fetching historical run events (for replay)
 */
export function useRunEvents(runId: string | null) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!runId) {
      setEvents([]);
      return;
    }

    const fetchEvents = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `${DEFAULT_SSE_URL}/api/runs/${runId}/events`
        );
        
        if (!response.ok) {
          throw new Error(`Failed to fetch events: ${response.statusText}`);
        }
        
        const data = await response.json();
        setEvents(data.events || []);
      } catch (err) {
        setError(err as Error);
        console.error("[useRunEvents] Failed to fetch:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
  }, [runId]);

  return { events, loading, error };
}
