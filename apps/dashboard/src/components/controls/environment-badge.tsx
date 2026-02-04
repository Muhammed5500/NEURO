"use client";

/**
 * Environment Badge Component
 * 
 * Shows current execution mode with visual warnings
 * Turkish: "UI Interlocks - MANUAL_APPROVAL modunda onay butonu parlamadan önce 
 * 'Bu gerçek bir ana ağ işlemidir' şeklinde bir onay kutusu ekle."
 * 
 * Acceptance criteria: "Modes are obvious in UI"
 */

import { memo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  AlertTriangle,
  Lock,
  Gamepad2,
  Eye,
  CheckCircle2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================
// TYPES
// ============================================

export type ExecutionMode = "DEMO" | "READONLY" | "MANUAL_APPROVAL" | "AUTONOMOUS";

export interface EnvironmentBadgeProps {
  mode: ExecutionMode;
  network?: "mainnet" | "testnet" | "devnet";
  killSwitchActive?: boolean;
  className?: string;
}

export interface ApprovalInterlockProps {
  mode: ExecutionMode;
  network: "mainnet" | "testnet" | "devnet";
  onConfirm: () => void;
  onCancel: () => void;
  actionDescription: string;
  className?: string;
}

// ============================================
// MODE CONFIGURATIONS
// ============================================

const MODE_CONFIG: Record<ExecutionMode, {
  icon: React.ElementType;
  label: string;
  shortLabel: string;
  color: string;
  bgColor: string;
  borderColor: string;
  glowColor: string;
  description: string;
}> = {
  DEMO: {
    icon: Gamepad2,
    label: "DEMO MODE",
    shortLabel: "DEMO",
    color: "text-cyber-cyan",
    bgColor: "bg-cyber-cyan/20",
    borderColor: "border-cyber-cyan",
    glowColor: "shadow-[0_0_15px_rgba(6,182,212,0.5)]",
    description: "All operations are simulated - no real transactions",
  },
  READONLY: {
    icon: Lock,
    label: "READ ONLY",
    shortLabel: "READ",
    color: "text-cyber-yellow",
    bgColor: "bg-cyber-yellow/20",
    borderColor: "border-cyber-yellow",
    glowColor: "shadow-[0_0_15px_rgba(251,191,36,0.5)]",
    description: "Write operations are blocked",
  },
  MANUAL_APPROVAL: {
    icon: CheckCircle2,
    label: "MANUAL APPROVAL",
    shortLabel: "MANUAL",
    color: "text-neon-green",
    bgColor: "bg-neon-green/20",
    borderColor: "border-neon-green",
    glowColor: "shadow-[0_0_15px_rgba(74,222,128,0.5)]",
    description: "All writes require human approval",
  },
  AUTONOMOUS: {
    icon: AlertTriangle,
    label: "⚠️ AUTONOMOUS",
    shortLabel: "AUTO",
    color: "text-cyber-red",
    bgColor: "bg-cyber-red/20",
    borderColor: "border-cyber-red",
    glowColor: "shadow-[0_0_20px_rgba(239,68,68,0.6)]",
    description: "Transactions execute without approval",
  },
};

// ============================================
// ENVIRONMENT BADGE
// ============================================

export const EnvironmentBadge = memo(function EnvironmentBadge({
  mode,
  network = "mainnet",
  killSwitchActive = false,
  className,
}: EnvironmentBadgeProps) {
  const config = MODE_CONFIG[mode];
  const Icon = config.icon;
  const [showTooltip, setShowTooltip] = useState(false);

  // Kill switch overrides everything
  if (killSwitchActive) {
    return (
      <motion.div
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-lg",
          "bg-cyber-red/30 border-2 border-cyber-red",
          "shadow-[0_0_30px_rgba(239,68,68,0.8)]",
          className
        )}
        animate={{
          boxShadow: [
            "0 0 30px rgba(239,68,68,0.8)",
            "0 0 50px rgba(239,68,68,1)",
            "0 0 30px rgba(239,68,68,0.8)",
          ],
        }}
        transition={{ duration: 1, repeat: Infinity }}
      >
        <Shield className="w-5 h-5 text-cyber-red animate-pulse" />
        <span className="text-sm font-bold text-cyber-red">KILL SWITCH ACTIVE</span>
      </motion.div>
    );
  }

  return (
    <div className="relative">
      <motion.div
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-help",
          "border transition-all duration-300",
          config.bgColor,
          config.borderColor,
          config.glowColor,
          className
        )}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        whileHover={{ scale: 1.02 }}
      >
        <Icon className={cn("w-4 h-4", config.color)} />
        <span className={cn("text-sm font-bold", config.color)}>
          {config.label}
        </span>
        {network === "mainnet" && mode !== "DEMO" && (
          <span className="px-1.5 py-0.5 text-[10px] bg-cyber-red/30 text-cyber-red rounded font-bold">
            MAINNET
          </span>
        )}
      </motion.div>

      {/* Tooltip */}
      <AnimatePresence>
        {showTooltip && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            className="absolute top-full left-0 mt-2 p-3 bg-cyber-dark border border-cyber-gray/50 rounded-lg shadow-xl z-50 min-w-[250px]"
          >
            <p className="text-sm text-white mb-2">{config.description}</p>
            <div className="text-xs text-cyber-gray">
              Network: <span className="text-white">{network.toUpperCase()}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

// ============================================
// ENVIRONMENT WARNINGS
// ============================================

interface EnvironmentWarningsProps {
  mode: ExecutionMode;
  network: "mainnet" | "testnet" | "devnet";
  killSwitchActive: boolean;
  className?: string;
}

export const EnvironmentWarnings = memo(function EnvironmentWarnings({
  mode,
  network,
  killSwitchActive,
  className,
}: EnvironmentWarningsProps) {
  const warnings: Array<{ type: "critical" | "warning" | "info"; message: string }> = [];

  if (killSwitchActive) {
    warnings.push({
      type: "critical",
      message: "🚨 Kill switch is active - all operations are blocked",
    });
  }

  if (mode === "AUTONOMOUS") {
    warnings.push({
      type: "critical",
      message: "⚠️ Autonomous mode - transactions will execute without approval",
    });
  }

  if (network === "mainnet" && mode !== "DEMO") {
    warnings.push({
      type: "warning",
      message: "💰 Connected to Mainnet - real funds at risk",
    });
  }

  if (mode === "DEMO") {
    warnings.push({
      type: "info",
      message: "🎮 Demo mode - all operations are simulated",
    });
  }

  if (warnings.length === 0) return null;

  return (
    <div className={cn("space-y-2", className)}>
      {warnings.map((warning, idx) => (
        <motion.div
          key={idx}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg text-sm",
            warning.type === "critical" && "bg-cyber-red/20 border border-cyber-red/50 text-cyber-red",
            warning.type === "warning" && "bg-cyber-yellow/20 border border-cyber-yellow/50 text-cyber-yellow",
            warning.type === "info" && "bg-cyber-cyan/20 border border-cyber-cyan/50 text-cyber-cyan"
          )}
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{warning.message}</span>
        </motion.div>
      ))}
    </div>
  );
});

// ============================================
// APPROVAL INTERLOCK
// ============================================

/**
 * Approval Interlock Component
 * Turkish: "MANUAL_APPROVAL modunda onay butonu parlamadan önce 
 * 'Bu gerçek bir ana ağ işlemidir' şeklinde bir onay kutusu ekle"
 */
export const ApprovalInterlock = memo(function ApprovalInterlock({
  mode,
  network,
  onConfirm,
  onCancel,
  actionDescription,
  className,
}: ApprovalInterlockProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const isMainnet = network === "mainnet" && mode !== "DEMO";
  const requiresConfirmation = isMainnet && mode === "MANUAL_APPROVAL";

  const canConfirm = requiresConfirmation 
    ? acknowledged && confirmText === "CONFIRM"
    : true;

  return (
    <div className={cn("p-4 bg-cyber-dark rounded-lg border border-cyber-purple/30", className)}>
      {/* Action description */}
      <div className="mb-4">
        <h4 className="text-sm text-cyber-gray mb-1">Action to approve:</h4>
        <p className="text-white">{actionDescription}</p>
      </div>

      {/* Mode badge */}
      <div className="mb-4">
        <EnvironmentBadge mode={mode} network={network} />
      </div>

      {/* Mainnet interlock */}
      {requiresConfirmation && (
        <div className="space-y-4 mb-4 p-3 bg-cyber-red/10 rounded-lg border border-cyber-red/30">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-cyber-red flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-cyber-red mb-1">
                ⚠️ This is a REAL MAINNET transaction
              </p>
              <p className="text-xs text-cyber-gray">
                This action will execute on Monad Mainnet and may involve real funds.
              </p>
            </div>
          </div>

          {/* Acknowledgment checkbox */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="w-4 h-4 rounded border-cyber-red bg-transparent checked:bg-cyber-red"
            />
            <span className="text-sm text-white">
              I understand this is a real mainnet transaction
            </span>
          </label>

          {/* Type CONFIRM */}
          {acknowledged && (
            <div>
              <label className="text-xs text-cyber-gray block mb-1">
                Type &quot;CONFIRM&quot; to proceed:
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                placeholder="CONFIRM"
                className="w-full px-3 py-2 bg-cyber-dark border border-cyber-gray/50 rounded text-white text-sm font-mono"
              />
            </div>
          )}
        </div>
      )}

      {/* Demo mode notice */}
      {mode === "DEMO" && (
        <div className="mb-4 p-3 bg-cyber-cyan/10 rounded-lg border border-cyber-cyan/30">
          <div className="flex items-center gap-2">
            <Gamepad2 className="w-4 h-4 text-cyber-cyan" />
            <span className="text-sm text-cyber-cyan">
              This operation will be simulated (Demo Mode)
            </span>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={onCancel}
          className="flex-1 px-4 py-2 bg-cyber-gray/20 border border-cyber-gray/50 rounded text-cyber-gray hover:text-white hover:bg-cyber-gray/30 transition-colors"
        >
          <X className="w-4 h-4 inline mr-2" />
          Cancel
        </button>
        <motion.button
          onClick={onConfirm}
          disabled={!canConfirm}
          className={cn(
            "flex-1 px-4 py-2 rounded font-bold transition-all",
            canConfirm
              ? "bg-neon-green/20 border border-neon-green text-neon-green hover:bg-neon-green/30"
              : "bg-cyber-gray/10 border border-cyber-gray/30 text-cyber-gray cursor-not-allowed"
          )}
          animate={canConfirm ? {
            boxShadow: [
              "0 0 0px rgba(74,222,128,0)",
              "0 0 20px rgba(74,222,128,0.5)",
              "0 0 0px rgba(74,222,128,0)",
            ],
          } : {}}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <CheckCircle2 className="w-4 h-4 inline mr-2" />
          {mode === "DEMO" ? "Simulate" : "Approve"}
        </motion.button>
      </div>
    </div>
  );
});

// ============================================
// COMPACT HEADER BADGE
// ============================================

export const CompactModeBadge = memo(function CompactModeBadge({
  mode,
  killSwitchActive,
}: {
  mode: ExecutionMode;
  killSwitchActive?: boolean;
}) {
  if (killSwitchActive) {
    return (
      <span className="px-2 py-1 text-xs font-bold bg-cyber-red/30 text-cyber-red border border-cyber-red rounded animate-pulse">
        🚨 KILL SWITCH
      </span>
    );
  }

  const config = MODE_CONFIG[mode];
  
  return (
    <span className={cn(
      "px-2 py-1 text-xs font-bold rounded border",
      config.bgColor,
      config.color,
      config.borderColor
    )}>
      {config.shortLabel}
    </span>
  );
});
