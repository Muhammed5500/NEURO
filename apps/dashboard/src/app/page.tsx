import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import { StatusPanel } from "@/components/panels/status-panel";
import { ApprovalQueue } from "@/components/panels/approval-queue";
import { MarketOverview } from "@/components/panels/market-overview";
import { ActivityFeed } from "@/components/panels/activity-feed";
import { KillSwitch } from "@/components/controls/kill-switch";

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-cyber-black bg-cyber-grid">
      {/* Scanline overlay effect */}
      <div className="pointer-events-none fixed inset-0 z-50 bg-[linear-gradient(transparent_50%,_rgba(0,0,0,0.1)_50%)] bg-[length:100%_4px]" />
      
      <Header />
      
      <div className="flex">
        <Sidebar />
        
        <main className="flex-1 p-6 ml-64">
          {/* Top row - Status and Kill Switch */}
          <div className="mb-6 flex gap-6">
            <div className="flex-1">
              <StatusPanel />
            </div>
            <div className="w-80">
              <KillSwitch />
            </div>
          </div>
          
          {/* Main content grid */}
          <div className="grid grid-cols-12 gap-6">
            {/* Approval Queue - Takes 8 columns */}
            <div className="col-span-8">
              <ApprovalQueue />
            </div>
            
            {/* Activity Feed - Takes 4 columns */}
            <div className="col-span-4">
              <ActivityFeed />
            </div>
            
            {/* Market Overview - Full width */}
            <div className="col-span-12">
              <MarketOverview />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
