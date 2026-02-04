"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw, Copy, ChevronDown, ChevronUp } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showStack: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    showStack: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  private handleCopyError = () => {
    const { error, errorInfo } = this.state;
    const errorText = `
Error: ${error?.message}
Stack: ${error?.stack}
Component Stack: ${errorInfo?.componentStack}
Time: ${new Date().toISOString()}
    `.trim();
    
    navigator.clipboard.writeText(errorText);
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="p-4 bg-cyber-red/10 border border-cyber-red/50 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-cyber-red flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-bold text-cyber-red mb-1">
                Component Error
              </h3>
              <p className="text-sm text-red-300 font-mono break-all">
                {this.state.error?.message}
              </p>
              
              {/* Stack toggle */}
              <button
                onClick={() => this.setState({ showStack: !this.state.showStack })}
                className="flex items-center gap-1 text-xs text-gray-500 mt-2 hover:text-gray-300"
              >
                {this.state.showStack ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {this.state.showStack ? "Hide" : "Show"} Stack Trace
              </button>
              
              {this.state.showStack && (
                <pre className="mt-2 p-3 bg-cyber-black/50 rounded text-xs text-gray-400 overflow-x-auto max-h-48 overflow-y-auto">
                  {this.state.error?.stack}
                  {this.state.errorInfo?.componentStack}
                </pre>
              )}
              
              <div className="flex gap-2 mt-3">
                <button
                  onClick={this.handleRetry}
                  className="flex items-center gap-1 px-3 py-1.5 bg-cyber-purple/20 text-cyber-purple rounded text-sm hover:bg-cyber-purple/30 border border-cyber-purple/30"
                >
                  <RefreshCw className="w-3 h-3" />
                  Retry
                </button>
                <button
                  onClick={this.handleCopyError}
                  className="flex items-center gap-1 px-3 py-1.5 bg-cyber-gray/50 text-gray-400 rounded text-sm hover:bg-cyber-gray/70 border border-gray-600"
                >
                  <Copy className="w-3 h-3" />
                  Copy Error
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
