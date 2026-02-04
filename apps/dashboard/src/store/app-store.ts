import { create } from "zustand";

interface AppState {
  // Kill switch state
  killSwitchEnabled: boolean;
  setKillSwitch: (enabled: boolean) => void;

  // Execution mode
  executionMode: "READ_ONLY" | "WRITE_ENABLED";
  setExecutionMode: (mode: "READ_ONLY" | "WRITE_ENABLED") => void;

  // Pending approvals count
  pendingApprovalsCount: number;
  setPendingApprovalsCount: (count: number) => void;

  // Selected approval for detail view
  selectedApprovalId: string | null;
  setSelectedApprovalId: (id: string | null) => void;

  // Notifications
  notifications: Notification[];
  addNotification: (notification: Omit<Notification, "id" | "timestamp">) => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
}

interface Notification {
  id: string;
  type: "info" | "success" | "warning" | "error";
  title: string;
  message: string;
  timestamp: Date;
}

export const useAppStore = create<AppState>((set) => ({
  // Kill switch
  killSwitchEnabled: false,
  setKillSwitch: (enabled) => set({ killSwitchEnabled: enabled }),

  // Execution mode
  executionMode: "READ_ONLY",
  setExecutionMode: (mode) => set({ executionMode: mode }),

  // Pending approvals
  pendingApprovalsCount: 0,
  setPendingApprovalsCount: (count) => set({ pendingApprovalsCount: count }),

  // Selected approval
  selectedApprovalId: null,
  setSelectedApprovalId: (id) => set({ selectedApprovalId: id }),

  // Notifications
  notifications: [],
  addNotification: (notification) =>
    set((state) => ({
      notifications: [
        ...state.notifications,
        {
          ...notification,
          id: crypto.randomUUID(),
          timestamp: new Date(),
        },
      ],
    })),
  removeNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),
  clearNotifications: () => set({ notifications: [] }),
}));
