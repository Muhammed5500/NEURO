"use client";

import { AlertTriangle, WifiOff, RefreshCw, Copy, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import type { DataSourceError } from "@/lib/live-data-client";

interface ConnectionErrorProps {
  error: DataSourceError;
  onRetry?: () => void;
  compact?: boolean;
}

export function ConnectionErrorDisplay({ error, onRetry, compact = false }: ConnectionErrorProps) {
  const [showRaw, setShowRaw] = useState(false);

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-cyber-red/20 border border-cyber-red/50 rounded text-sm">
        <WifiOff className="w-4 h-4 text-cyber-red" />
        <span className="text-cyber-red font-mono">[{error.source}]</span>
        <span className="text-red-300 truncate">{error.message}</span>
        {onRetry && (
          <button
            onClick={onRetry}
            className="ml-auto p-1 hover:bg-cyber-red/20 rounded"
          >
            <RefreshCw className="w-3 h-3 text-cyber-red" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 bg-cyber-red/10 border border-cyber-red/50 rounded-lg">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-cyber-red/20 rounded-lg">
          <WifiOff className="w-5 h-5 text-cyber-red" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-lg font-bold text-cyber-red">
              CONNECTION FAILED
            </h3>
            <span className="px-2 py-0.5 bg-cyber-red/20 text-cyber-red text-xs font-mono rounded">
              {error.code}
            </span>
          </div>
          
          <p className="text-sm text-gray-400 mb-2">
            Source: <span className="text-cyber-red font-mono">{error.source}</span>
          </p>
          
          <p className="text-sm text-red-300 font-mono bg-cyber-black/50 p-2 rounded break-all">
            {error.message}
          </p>
          
          <p className="text-xs text-gray-600 mt-2">
            {error.timestamp.toISOString()}
          </p>

          {error.raw && (
            <>
              <button
                onClick={() => setShowRaw(!showRaw)}
                className="flex items-center gap-1 text-xs text-gray-500 mt-2 hover:text-gray-300"
              >
                {showRaw ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {showRaw ? "Hide" : "Show"} Raw Error
              </button>
              
              {showRaw && (
                <pre className="mt-2 p-3 bg-cyber-black/50 rounded text-xs text-gray-400 overflow-x-auto max-h-32 overflow-y-auto">
                  {JSON.stringify(error.raw, null, 2)}
                </pre>
              )}
            </>
          )}
          
          {onRetry && (
            <button
              onClick={onRetry}
              className="flex items-center gap-1 px-3 py-1.5 bg-cyber-red/20 text-cyber-red rounded text-sm hover:bg-cyber-red/30 border border-cyber-red/30 mt-3"
            >
              <RefreshCw className="w-3 h-3" />
              Retry Connection
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Disconnected state display
interface DisconnectedProps {
  source: string;
  onConnect?: () => void;
}

export function DisconnectedDisplay({ source, onConnect }: DisconnectedProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <WifiOff className="w-12 h-12 text-gray-600 mb-3" />
      <h3 className="text-lg font-bold text-gray-400 mb-1">DISCONNECTED</h3>
      <p className="text-sm text-gray-600 mb-4">
        {source} stream not connected
      </p>
      {onConnect && (
        <button
          onClick={onConnect}
          className="flex items-center gap-2 px-4 py-2 bg-cyber-purple/20 text-cyber-purple rounded border border-cyber-purple/30 hover:bg-cyber-purple/30"
        >
          <RefreshCw className="w-4 h-4" />
          Connect
        </button>
      )}
    </div>
  );
}

// Loading state
export function LoadingDisplay({ source }: { source: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <div className="relative w-12 h-12 mb-3">
        <div className="absolute inset-0 border-2 border-cyber-purple/30 rounded-full" />
        <div className="absolute inset-0 border-2 border-cyber-purple border-t-transparent rounded-full animate-spin" />
      </div>
      <h3 className="text-lg font-bold text-gray-400 mb-1">CONNECTING...</h3>
      <p className="text-sm text-gray-600">
        Establishing connection to {source}
      </p>
    </div>
  );
}
