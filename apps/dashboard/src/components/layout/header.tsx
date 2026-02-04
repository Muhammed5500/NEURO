"use client";

/**
 * Header - LIVE DATA ONLY
 * 
 * Shows real chain status and block data.
 * NO MOCK DATA - shows disconnected state if RPC unavailable.
 */

import { Activity, Rocket, Zap, Target, WifiOff } from "lucide-react";
import { EnvironmentBadge, type ExecutionMode } from "../controls/environment-badge";
import { useLiveChainMetrics } from "@/hooks/use-live-metrics";

// In real app, this would come from context/store
const getEnvironmentMode = (): {
  mode: ExecutionMode;
  network: "mainnet" | "testnet" | "devnet";
  killSwitchActive: boolean;
} => {
  const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
  const isReadOnly = process.env.NEXT_PUBLIC_MAINNET_READONLY === "true";
  const isManualApproval = process.env.NEXT_PUBLIC_MANUAL_APPROVAL !== "false";
  const killSwitchActive = process.env.NEXT_PUBLIC_KILL_SWITCH_ACTIVE === "true";
  const network = (process.env.NEXT_PUBLIC_NETWORK as any) || "mainnet";

  let mode: ExecutionMode = "MANUAL_APPROVAL";
  if (isDemoMode) mode = "DEMO";
  else if (isReadOnly) mode = "READONLY";
  else if (!isManualApproval) mode = "AUTONOMOUS";

  return { mode, network, killSwitchActive };
};

export function Header() {
  const { mode, network, killSwitchActive } = getEnvironmentMode();
  const { metrics: chainMetrics, error: chainError } = useLiveChainMetrics();

  return (
    <header className="fixed top-0 left-0 right-0 z-40 h-16 bg-cyber-dark/90 backdrop-blur-sm border-b border-cyber-purple/30">
      <div className="flex items-center justify-between h-full px-6">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyber-purple to-cyber-pink flex items-center justify-center">
              <Rocket className="w-6 h-6 text-white" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-neon-green flex items-center justify-center">
              <Target className="w-2.5 h-2.5 text-cyber-black" />
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold text-gradient glitch" data-text="NEURO">
              NEURO
            </h1>
            <p className="text-[10px] text-gray-500 tracking-widest font-mono">
              STRATEGIC TREND LAUNCHPAD • MONAD
            </p>
          </div>
        </div>

        {/* Status indicators */}
        <div className="flex items-center gap-4">
          {/* RPC Status */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded border ${
            chainMetrics.connected
              ? "bg-neon-green/10 border-neon-green/30"
              : "bg-cyber-red/10 border-cyber-red/30"
          }`}>
            {chainMetrics.connected ? (
              <>
                <span className="w-2 h-2 rounded-full bg-neon-green animate-pulse" />
                <span className="text-xs font-mono text-neon-green">RPC LIVE</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3 text-cyber-red" />
                <span className="text-xs font-mono text-cyber-red">DISCONNECTED</span>
              </>
            )}
          </div>

          {/* Block info - LIVE */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-cyber-gray/50 rounded border border-cyber-purple/20">
            <Activity className={`w-4 h-4 ${chainMetrics.connected ? "text-cyber-cyan" : "text-gray-600"}`} />
            <span className="text-sm font-mono text-cyber-cyan">
              Block #<span className="text-white">
                {chainMetrics.blockNumber !== null
                  ? chainMetrics.blockNumber.toLocaleString()
                  : "---"}
              </span>
            </span>
          </div>

          {/* Gas price - LIVE */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-cyber-gray/50 rounded border border-cyber-purple/20">
            <Zap className={`w-4 h-4 ${chainMetrics.connected ? "text-neon-green" : "text-gray-600"}`} />
            <span className="text-sm font-mono text-neon-green">
              <span className="text-white">
                {chainMetrics.gasPrice !== null
                  ? chainMetrics.gasPrice.toFixed(3)
                  : "---"}
              </span> gwei
            </span>
            {chainMetrics.finality !== null && (
              <span className="text-[10px] text-gray-500">
                {chainMetrics.finality}ms
              </span>
            )}
          </div>

          {/* Environment Mode Badge */}
          <EnvironmentBadge
            mode={mode}
            network={network}
            killSwitchActive={killSwitchActive}
          />
        </div>
      </div>

      {/* Chain Error Banner */}
      {chainError && (
        <div className="absolute bottom-0 left-0 right-0 translate-y-full bg-cyber-red/20 border-b border-cyber-red/50 px-6 py-2 text-xs">
          <span className="text-cyber-red font-mono">[CHAIN ERROR]</span>
          <span className="text-red-300 ml-2">{chainError.message}</span>
        </div>
      )}
    </header>
  );
}
