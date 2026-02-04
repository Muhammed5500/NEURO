"use client";

import { useState } from "react";
import { Power, AlertOctagon, ShieldOff, ShieldCheck } from "lucide-react";

export function KillSwitch() {
  const [isEnabled, setIsEnabled] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleToggle = () => {
    if (!isEnabled) {
      // Activating - requires confirmation
      setShowConfirm(true);
    } else {
      // Deactivating - requires confirmation code
      // In production, this would require a confirmation code/OTP
      setShowConfirm(true);
    }
  };

  const handleConfirm = () => {
    setIsEnabled(!isEnabled);
    setShowConfirm(false);
  };

  return (
    <div
      className={`cyber-card p-6 transition-all ${
        isEnabled ? "border-cyber-red" : "border-cyber-purple/30"
      }`}
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-display font-bold text-white flex items-center gap-2">
          {isEnabled ? (
            <ShieldOff className="w-5 h-5 text-cyber-red" />
          ) : (
            <ShieldCheck className="w-5 h-5 text-cyber-green" />
          )}
          Kill Switch
        </h2>
        <div
          className={`px-3 py-1 text-xs font-bold rounded ${
            isEnabled
              ? "bg-cyber-red/20 text-cyber-red"
              : "bg-cyber-green/20 text-cyber-green"
          }`}
        >
          {isEnabled ? "ACTIVE" : "INACTIVE"}
        </div>
      </div>

      <p className="text-sm text-gray-400 mb-4">
        {isEnabled
          ? "Kill switch is active. All write operations are blocked."
          : "Instantly disable all write operations in case of emergency."}
      </p>

      <button
        onClick={handleToggle}
        className={`w-full py-4 rounded-lg font-display font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${
          isEnabled
            ? "bg-cyber-red/20 text-cyber-red border border-cyber-red hover:bg-cyber-red hover:text-white"
            : "bg-cyber-gray/50 text-gray-400 border border-gray-600 hover:border-cyber-red hover:text-cyber-red"
        }`}
      >
        <Power className="w-5 h-5" />
        {isEnabled ? "Deactivate Kill Switch" : "Activate Kill Switch"}
      </button>

      {/* Confirmation modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="cyber-card p-6 max-w-md mx-4">
            <div className="flex items-center gap-3 mb-4">
              <AlertOctagon className="w-8 h-8 text-cyber-red" />
              <h3 className="text-xl font-display font-bold text-white">
                {isEnabled ? "Deactivate Kill Switch?" : "Activate Kill Switch?"}
              </h3>
            </div>

            <p className="text-gray-400 mb-6">
              {isEnabled
                ? "This will re-enable write operations. Make sure the issue has been resolved."
                : "This will immediately block ALL write operations including pending approvals. Use only in emergencies."}
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-3 bg-cyber-gray/50 text-gray-400 rounded-lg font-medium hover:bg-cyber-gray transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                className={`flex-1 py-3 rounded-lg font-bold transition-colors ${
                  isEnabled
                    ? "bg-cyber-green text-white hover:bg-cyber-green/80"
                    : "bg-cyber-red text-white hover:bg-cyber-red/80"
                }`}
              >
                {isEnabled ? "Deactivate" : "Activate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
