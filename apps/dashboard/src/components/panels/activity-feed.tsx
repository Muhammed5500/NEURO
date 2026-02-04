"use client";

import { 
  Activity, 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  Bot,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type ActivityType = "approval" | "rejection" | "decision" | "trade" | "alert";

interface ActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  description: string;
  timestamp: Date;
}

const activities: ActivityItem[] = [
  {
    id: "1",
    type: "decision",
    title: "AI Decision Made",
    description: "Recommended buying PEPE with 85% confidence",
    timestamp: new Date(Date.now() - 30000),
  },
  {
    id: "2",
    type: "approval",
    title: "Trade Approved",
    description: "Sold 500 DOGE tokens",
    timestamp: new Date(Date.now() - 120000),
  },
  {
    id: "3",
    type: "alert",
    title: "Price Alert",
    description: "SHIB dropped 10% in 1 hour",
    timestamp: new Date(Date.now() - 300000),
  },
  {
    id: "4",
    type: "rejection",
    title: "Trade Rejected",
    description: "High risk token launch blocked",
    timestamp: new Date(Date.now() - 600000),
  },
  {
    id: "5",
    type: "trade",
    title: "Trade Executed",
    description: "Bought 1000 WOJAK for 0.2 MON",
    timestamp: new Date(Date.now() - 900000),
  },
];

const iconMap: Record<ActivityType, React.ElementType> = {
  approval: CheckCircle,
  rejection: XCircle,
  decision: Bot,
  trade: ArrowUpRight,
  alert: AlertTriangle,
};

const colorMap: Record<ActivityType, string> = {
  approval: "text-cyber-green",
  rejection: "text-cyber-red",
  decision: "text-cyber-purple",
  trade: "text-cyber-cyan",
  alert: "text-cyber-yellow",
};

export function ActivityFeed() {
  return (
    <div className="cyber-card p-6 h-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-display font-bold text-white flex items-center gap-2">
          <Activity className="w-5 h-5 text-cyber-pink" />
          Activity Feed
        </h2>
        <button className="text-sm text-cyber-purple hover:text-cyber-pink transition-colors">
          View All
        </button>
      </div>

      <div className="space-y-3 max-h-96 overflow-y-auto">
        {activities.map((activity) => {
          const Icon = iconMap[activity.type];
          const colorClass = colorMap[activity.type];

          return (
            <div
              key={activity.id}
              className="flex items-start gap-3 p-3 bg-cyber-gray/30 rounded-lg border border-cyber-purple/10 hover:border-cyber-purple/30 transition-colors"
            >
              <div className={`p-2 rounded-lg bg-cyber-black/50 ${colorClass}`}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">
                  {activity.title}
                </p>
                <p className="text-xs text-gray-500 truncate">
                  {activity.description}
                </p>
              </div>
              <span className="text-xs text-gray-600 whitespace-nowrap">
                {formatDistanceToNow(activity.timestamp, { addSuffix: true })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
