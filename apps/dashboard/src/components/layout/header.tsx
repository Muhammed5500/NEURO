"use client";

import { Activity, Cpu, Zap } from "lucide-react";

export function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-40 h-16 bg-cyber-dark/90 backdrop-blur-sm border-b border-cyber-purple/30">
      <div className="flex items-center justify-between h-full px-6">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <Cpu className="w-8 h-8 text-cyber-purple" />
            <div className="absolute inset-0 animate-ping">
              <Cpu className="w-8 h-8 text-cyber-purple opacity-30" />
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold text-gradient glitch" data-text="NEURO">
              NEURO
            </h1>
            <p className="text-xs text-gray-500 tracking-widest">
              MONAD MAINNET • CHAIN ID 143
            </p>
          </div>
        </div>

        {/* Status indicators */}
        <div className="flex items-center gap-6">
          {/* Connection status */}
          <div className="flex items-center gap-2">
            <div className="status-indicator online" />
            <span className="text-sm text-gray-400">RPC Connected</span>
          </div>

          {/* Block info */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-cyber-gray/50 rounded border border-cyber-purple/20">
            <Activity className="w-4 h-4 text-cyber-cyan" />
            <span className="text-sm font-mono text-cyber-cyan">
              Block #<span className="text-white">---</span>
            </span>
          </div>

          {/* Gas price */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-cyber-gray/50 rounded border border-cyber-purple/20">
            <Zap className="w-4 h-4 text-cyber-yellow" />
            <span className="text-sm font-mono text-cyber-yellow">
              <span className="text-white">--</span> gwei
            </span>
          </div>

          {/* Execution mode badge */}
          <div className="px-3 py-1.5 bg-cyber-green/10 rounded border border-cyber-green/30">
            <span className="text-sm font-bold text-cyber-green tracking-wide">
              READ-ONLY
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
