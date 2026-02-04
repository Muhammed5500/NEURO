"use client";

/**
 * Speed Gauge Component
 * 
 * Glowing speed gauge showing Monad's performance
 * Turkish: "Parlayan bir 'Hız Göstergesi' (Gauge) kullan.
 * Monad'ın iğnesi her zaman 'Ultra Fast' bölgesinde kalsın."
 */

import { memo, useMemo } from "react";
import { motion } from "framer-motion";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { SourceBadge } from "./source-badge";
import type { GaugeData, SpeedZone } from "@/types/metrics";

interface SpeedGaugeProps {
  data: GaugeData;
  className?: string;
}

const ZONE_COLORS: Record<SpeedZone, { bg: string; glow: string; text: string }> = {
  ultra_fast: {
    bg: "bg-neon-green",
    glow: "shadow-[0_0_30px_rgba(74,222,128,0.8)]",
    text: "text-neon-green",
  },
  fast: {
    bg: "bg-cyber-green",
    glow: "shadow-[0_0_20px_rgba(34,197,94,0.6)]",
    text: "text-cyber-green",
  },
  moderate: {
    bg: "bg-cyber-yellow",
    glow: "shadow-[0_0_15px_rgba(251,191,36,0.5)]",
    text: "text-cyber-yellow",
  },
  slow: {
    bg: "bg-orange-500",
    glow: "shadow-[0_0_15px_rgba(249,115,22,0.5)]",
    text: "text-orange-500",
  },
  ultra_slow: {
    bg: "bg-cyber-red",
    glow: "shadow-[0_0_20px_rgba(239,68,68,0.6)]",
    text: "text-cyber-red",
  },
};

export const SpeedGauge = memo(function SpeedGauge({ data, className }: SpeedGaugeProps) {
  const zoneStyle = ZONE_COLORS[data.zone];
  
  // Calculate needle rotation (-135 to 135 degrees)
  // 0% = -135deg (fastest), 100% = 135deg (slowest)
  const needleRotation = useMemo(() => {
    return -135 + (data.needlePosition / 100) * 270;
  }, [data.needlePosition]);

  return (
    <div className={cn("cyber-card p-6", className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-neon-green" />
          <h3 className="font-display font-bold text-lg">SPEED GAUGE</h3>
        </div>
        <SourceBadge source={data.currentLatencyMs.source} />
      </div>

      {/* Gauge Display */}
      <div className="relative w-64 h-40 mx-auto mb-6">
        {/* Gauge background arc */}
        <svg
          viewBox="0 0 200 120"
          className="w-full h-full"
          style={{ transform: "rotate(0deg)" }}
        >
          {/* Background arc segments */}
          <defs>
            <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#4ade80" />
              <stop offset="25%" stopColor="#22c55e" />
              <stop offset="50%" stopColor="#fbbf24" />
              <stop offset="75%" stopColor="#f97316" />
              <stop offset="100%" stopColor="#ef4444" />
            </linearGradient>
          </defs>

          {/* Arc background */}
          <path
            d="M 20 100 A 80 80 0 0 1 180 100"
            fill="none"
            stroke="url(#gaugeGradient)"
            strokeWidth="12"
            strokeLinecap="round"
            opacity="0.3"
          />

          {/* Active arc (based on position) */}
          <path
            d="M 20 100 A 80 80 0 0 1 180 100"
            fill="none"
            stroke="url(#gaugeGradient)"
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={`${(1 - data.needlePosition / 100) * 251.2} 251.2`}
            className={zoneStyle.glow}
          />

          {/* Zone labels */}
          <text x="15" y="115" className="fill-neon-green text-[8px] font-mono">FAST</text>
          <text x="170" y="115" className="fill-cyber-red text-[8px] font-mono">SLOW</text>
        </svg>

        {/* Needle */}
        <motion.div
          className="absolute bottom-0 left-1/2 origin-bottom"
          style={{ width: "4px", height: "70px", marginLeft: "-2px" }}
          animate={{ rotate: needleRotation }}
          transition={{ type: "spring", stiffness: 100, damping: 15 }}
        >
          <div className={cn(
            "w-full h-full rounded-full",
            zoneStyle.bg,
            zoneStyle.glow
          )} />
        </motion.div>

        {/* Center cap */}
        <div className={cn(
          "absolute bottom-0 left-1/2 w-6 h-6 -ml-3 rounded-full",
          "bg-cyber-dark border-2",
          zoneStyle.bg.replace("bg-", "border-")
        )} />
      </div>

      {/* Zone Label */}
      <div className="text-center mb-6">
        <motion.div
          className={cn(
            "inline-block px-6 py-2 rounded-lg font-display font-bold text-2xl",
            "border-2",
            zoneStyle.text,
            zoneStyle.glow
          )}
          animate={{ scale: [1, 1.02, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
          style={{
            borderColor: data.zoneColor,
            backgroundColor: `${data.zoneColor}20`,
          }}
        >
          {data.zoneLabel}
        </motion.div>
      </div>

      {/* Latency Value */}
      <div className="text-center mb-6">
        <div className="text-4xl font-bold font-mono">
          <span className={zoneStyle.text}>
            {data.currentLatencyMs.value.toFixed(0)}
          </span>
          <span className="text-cyber-gray text-xl ml-1">ms</span>
        </div>
        <p className="text-sm text-cyber-gray mt-1">Average Transaction Latency</p>
      </div>

      {/* Comparison badges */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-cyber-dark/50 rounded-lg p-3 text-center">
          <p className="text-xs text-cyber-gray mb-1">vs Ethereum</p>
          <div className="flex items-center justify-center gap-1">
            <span className="text-2xl font-bold text-neon-green">
              {data.vsEthereum.value.toFixed(0)}x
            </span>
            <span className="text-neon-green text-xs">faster</span>
          </div>
          <SourceBadge source={data.vsEthereum.source} className="mt-1" />
        </div>
        <div className="bg-cyber-dark/50 rounded-lg p-3 text-center">
          <p className="text-xs text-cyber-gray mb-1">vs Solana</p>
          <div className="flex items-center justify-center gap-1">
            <span className="text-2xl font-bold text-cyber-cyan">
              {data.vsSolana.value.toFixed(1)}x
            </span>
            <span className="text-cyber-cyan text-xs">faster</span>
          </div>
          <SourceBadge source={data.vsSolana.source} className="mt-1" />
        </div>
      </div>
    </div>
  );
});
