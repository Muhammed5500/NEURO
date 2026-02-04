"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Coins,
  History,
  Settings,
  Shield,
  TrendingUp,
  Wallet,
  Bot,
  AlertTriangle,
  Radio,
  Activity,
} from "lucide-react";
import { clsx } from "clsx";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Agent Stream", href: "/stream", icon: Radio, highlight: true },
  { name: "Metrics", href: "/metrics", icon: Activity, highlight: true },
  { name: "Approvals", href: "/approvals", icon: Shield },
  { name: "Portfolio", href: "/portfolio", icon: Wallet },
  { name: "Tokens", href: "/tokens", icon: Coins },
  { name: "Market", href: "/market", icon: TrendingUp },
  { name: "AI Decisions", href: "/decisions", icon: Bot },
  { name: "History", href: "/history", icon: History },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-16 bottom-0 w-64 bg-cyber-dark/50 backdrop-blur-sm border-r border-cyber-purple/30 overflow-y-auto">
      <nav className="p-4 space-y-2">
        {navigation.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={clsx(
                "flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200",
                isActive
                  ? "bg-cyber-purple/20 text-cyber-purple border border-cyber-purple/50"
                  : "text-gray-400 hover:bg-cyber-gray/50 hover:text-white border border-transparent"
              )}
            >
              <item.icon className={clsx("w-5 h-5", isActive && "neon-text")} />
              <span className={clsx("font-medium", isActive && "text-white")}>
                {item.name}
              </span>
              {item.name === "Approvals" && (
                <span className="ml-auto px-2 py-0.5 text-xs font-bold bg-cyber-red/20 text-cyber-red rounded-full">
                  3
                </span>
              )}
              {(item as any).highlight && (
                <span className="ml-auto w-2 h-2 rounded-full bg-neon-green animate-pulse" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Security notice */}
      <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-cyber-purple/30 bg-cyber-dark/80">
        <div className="flex items-start gap-3 p-3 bg-cyber-yellow/10 rounded-lg border border-cyber-yellow/30">
          <AlertTriangle className="w-5 h-5 text-cyber-yellow flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-cyber-yellow">
              Manual Approval
            </p>
            <p className="text-xs text-gray-400 mt-1">
              All write operations require manual approval
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}
