"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Radio,
  Activity,
  Shield,
  Settings,
  Rocket,
  Target,
  TrendingUp,
  Twitter,
  Bot,
  Archive,
  History,
  Wallet,
  Coins,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { clsx } from "clsx";
import { useState } from "react";

// ============================================
// NAVIGATION CONFIG
// ============================================

interface NavItem {
  name: string;
  href: string;
  icon: React.ElementType;
  highlight?: boolean;
  badge?: string | number;
}

interface NavSection {
  title: string;
  items: NavItem[];
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

const navigation: NavSection[] = [
  {
    title: "COMMAND CENTER",
    items: [
      { name: "Launchpad", href: "/", icon: Rocket, highlight: true },
      { name: "Agent Stream", href: "/stream", icon: Radio, highlight: true },
      { name: "Metrics", href: "/metrics", icon: Activity },
    ],
  },
  {
    title: "OPERATIONS",
    items: [
      { name: "Trend Scanner", href: "/trends", icon: Target },
      { name: "Deployments", href: "/deployments", icon: TrendingUp },
      { name: "X Campaigns", href: "/campaigns", icon: Twitter },
      { name: "Pending Actions", href: "/approvals", icon: Shield, badge: 3 },
    ],
  },
  {
    title: "AI CONTROL",
    items: [
      { name: "Agent Decisions", href: "/decisions", icon: Bot },
      { name: "Settings", href: "/settings", icon: Settings },
    ],
  },
  {
    title: "ARCHIVE",
    collapsible: true,
    defaultCollapsed: true,
    items: [
      { name: "History", href: "/history", icon: History },
      { name: "Portfolio", href: "/portfolio", icon: Wallet },
      { name: "Token Registry", href: "/tokens", icon: Coins },
    ],
  },
];

// ============================================
// COMPONENT
// ============================================

export function Sidebar() {
  const pathname = usePathname();
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    navigation.forEach((section) => {
      if (section.collapsible && section.defaultCollapsed) {
        initial[section.title] = true;
      }
    });
    return initial;
  });

  const toggleSection = (title: string) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [title]: !prev[title],
    }));
  };

  return (
    <aside className="fixed left-0 top-16 bottom-0 w-64 bg-cyber-dark/50 backdrop-blur-sm border-r border-cyber-purple/30 overflow-y-auto">
      <nav className="p-4 space-y-6">
        {navigation.map((section) => {
          const isCollapsed = collapsedSections[section.title];

          return (
            <div key={section.title}>
              {/* Section Header */}
              <div
                className={clsx(
                  "flex items-center justify-between mb-2 px-2",
                  section.collapsible && "cursor-pointer hover:opacity-80"
                )}
                onClick={() => section.collapsible && toggleSection(section.title)}
              >
                <span className="text-[10px] font-bold text-gray-500 tracking-wider">
                  {section.title}
                </span>
                {section.collapsible && (
                  isCollapsed ? (
                    <ChevronRight className="w-3 h-3 text-gray-500" />
                  ) : (
                    <ChevronDown className="w-3 h-3 text-gray-500" />
                  )
                )}
              </div>

              {/* Section Items */}
              {!isCollapsed && (
                <div className="space-y-1">
                  {section.items.map((item) => {
                    const isActive = pathname === item.href;
                    return (
                      <Link
                        key={item.name}
                        href={item.href}
                        className={clsx(
                          "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200",
                          isActive
                            ? "bg-cyber-purple/20 text-cyber-purple border border-cyber-purple/50"
                            : "text-gray-400 hover:bg-cyber-gray/50 hover:text-white border border-transparent"
                        )}
                      >
                        <item.icon
                          className={clsx(
                            "w-4 h-4",
                            isActive && "neon-text"
                          )}
                        />
                        <span className={clsx("text-sm font-medium", isActive && "text-white")}>
                          {item.name}
                        </span>
                        {item.badge && (
                          <span className="ml-auto px-2 py-0.5 text-xs font-bold bg-cyber-red/20 text-cyber-red rounded-full border border-cyber-red/30">
                            {item.badge}
                          </span>
                        )}
                        {item.highlight && (
                          <span className="ml-auto w-2 h-2 rounded-full bg-neon-green animate-pulse" />
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Mode Notice */}
      <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-cyber-purple/30 bg-cyber-dark/80">
        <div className="flex items-start gap-3 p-3 bg-cyber-yellow/10 rounded-lg border border-cyber-yellow/30">
          <AlertTriangle className="w-5 h-5 text-cyber-yellow flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-cyber-yellow">
              Manual Approval Mode
            </p>
            <p className="text-xs text-gray-400 mt-1">
              All deployments require approval
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}
