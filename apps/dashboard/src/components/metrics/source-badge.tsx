"use client";

/**
 * Source Badge Component
 * 
 * Displays data source label for transparency
 * Turkish: "Her rakamın yanında [measured] veya [config-ref] etiketi olsun"
 * Acceptance criteria: "All numbers cite their input sources"
 */

import { memo } from "react";
import { cn } from "@/lib/utils";
import type { DataSource } from "@/types/metrics";

interface SourceBadgeProps {
  source: DataSource;
  className?: string;
  showIcon?: boolean;
}

const SOURCE_STYLES: Record<DataSource, { color: string; label: string; icon: string }> = {
  measured: {
    color: "bg-neon-green/20 text-neon-green border-neon-green/30",
    label: "measured",
    icon: "●",
  },
  "config-ref": {
    color: "bg-cyber-purple/20 text-cyber-purple border-cyber-purple/30",
    label: "config-ref",
    icon: "◆",
  },
  simulated: {
    color: "bg-cyber-cyan/20 text-cyber-cyan border-cyber-cyan/30",
    label: "simulated",
    icon: "◇",
  },
  estimated: {
    color: "bg-cyber-yellow/20 text-cyber-yellow border-cyber-yellow/30",
    label: "estimated",
    icon: "○",
  },
};

export const SourceBadge = memo(function SourceBadge({
  source,
  className,
  showIcon = true,
}: SourceBadgeProps) {
  const style = SOURCE_STYLES[source];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border",
        style.color,
        className
      )}
      title={`Data source: ${style.label}`}
    >
      {showIcon && <span className="text-[8px]">{style.icon}</span>}
      [{style.label}]
    </span>
  );
});

/**
 * Value with source badge
 */
interface SourcedValueDisplayProps {
  value: string | number;
  source: DataSource;
  unit?: string;
  className?: string;
  valueClassName?: string;
  size?: "sm" | "md" | "lg" | "xl";
}

export const SourcedValueDisplay = memo(function SourcedValueDisplay({
  value,
  source,
  unit,
  className,
  valueClassName,
  size = "md",
}: SourcedValueDisplayProps) {
  const sizeStyles = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-xl",
    xl: "text-3xl font-bold",
  };

  return (
    <div className={cn("flex items-baseline gap-2", className)}>
      <span className={cn(sizeStyles[size], valueClassName)}>
        {typeof value === "number" ? value.toLocaleString() : value}
        {unit && <span className="text-cyber-gray ml-1">{unit}</span>}
      </span>
      <SourceBadge source={source} />
    </div>
  );
});
