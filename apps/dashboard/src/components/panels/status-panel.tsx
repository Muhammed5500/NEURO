"use client";

import { Server, Database, Brain, Radio } from "lucide-react";

interface ServiceStatus {
  name: string;
  status: "online" | "offline" | "degraded";
  latency?: number;
  icon: React.ElementType;
}

const services: ServiceStatus[] = [
  { name: "Execution", status: "online", latency: 45, icon: Server },
  { name: "Orchestrator", status: "online", latency: 120, icon: Brain },
  { name: "Ingestion", status: "online", latency: 12, icon: Radio },
  { name: "Database", status: "online", latency: 3, icon: Database },
];

export function StatusPanel() {
  return (
    <div className="cyber-card p-6">
      <h2 className="text-lg font-display font-bold text-white mb-4 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-cyber-green animate-pulse" />
        System Status
      </h2>

      <div className="grid grid-cols-4 gap-4">
        {services.map((service) => (
          <div
            key={service.name}
            className="p-4 bg-cyber-gray/30 rounded-lg border border-cyber-purple/20"
          >
            <div className="flex items-center justify-between mb-3">
              <service.icon className="w-5 h-5 text-cyber-purple" />
              <div
                className={`status-indicator ${
                  service.status === "online"
                    ? "online"
                    : service.status === "degraded"
                    ? "pending"
                    : "offline"
                }`}
              />
            </div>
            <p className="text-sm font-medium text-white">{service.name}</p>
            <p className="text-xs text-gray-500 mt-1">
              {service.latency ? `${service.latency}ms` : "N/A"}
            </p>
          </div>
        ))}
      </div>

      {/* Quick stats */}
      <div className="mt-4 pt-4 border-t border-cyber-purple/20 grid grid-cols-4 gap-4 text-center">
        <div>
          <p className="text-2xl font-bold text-cyber-cyan">$0.00</p>
          <p className="text-xs text-gray-500">Portfolio Value</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-cyber-purple">0</p>
          <p className="text-xs text-gray-500">Tokens Managed</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-cyber-green">0</p>
          <p className="text-xs text-gray-500">Trades Today</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-cyber-pink">0</p>
          <p className="text-xs text-gray-500">AI Decisions</p>
        </div>
      </div>
    </div>
  );
}
