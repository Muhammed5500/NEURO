/**
 * Environment Mode System
 * 
 * Three execution modes:
 * - DEMO_MODE=true → fully simulated execution
 * - MAINNET_READONLY=true → only reads + planning  
 * - MANUAL_APPROVAL=true → enables gated writes
 * 
 * Turkish: "Circuit Breaker Decorator" - Tüm cüzdan yazma fonksiyonlarını 
 * sarmalayan bir guard. READONLY ise sendTransaction çağrısı Security Alert olarak loglanır.
 */

// ============================================
// ENVIRONMENT MODE TYPES
// ============================================

export type ExecutionMode = "DEMO" | "READONLY" | "MANUAL_APPROVAL" | "AUTONOMOUS";

export interface EnvironmentConfig {
  /** Current execution mode */
  mode: ExecutionMode;
  /** Demo mode - all operations simulated */
  demoMode: boolean;
  /** Read-only mode - no write operations */
  mainnetReadonly: boolean;
  /** Manual approval required for writes */
  manualApproval: boolean;
  /** Kill switch active */
  killSwitchActive: boolean;
  /** Network (mainnet/testnet) */
  network: "mainnet" | "testnet" | "devnet";
  /** RPC endpoint */
  rpcEndpoint: string;
}

export interface ModeValidationResult {
  allowed: boolean;
  reason?: string;
  mode: ExecutionMode;
  requiresApproval: boolean;
  isSimulated: boolean;
}

export interface SecurityAlert {
  type: "WRITE_BLOCKED" | "MODE_VIOLATION" | "KILL_SWITCH" | "APPROVAL_REQUIRED";
  message: string;
  timestamp: number;
  mode: ExecutionMode;
  operation: string;
  details?: Record<string, unknown>;
}

// ============================================
// ENVIRONMENT MANAGER
// ============================================

export class EnvironmentManager {
  private config: EnvironmentConfig;
  private readonly alerts: SecurityAlert[] = [];
  private readonly maxAlerts = 1000;

  constructor() {
    this.config = this.loadFromEnv();
    this.printStartupBanner();
  }

  /**
   * Load configuration from environment variables
   */
  private loadFromEnv(): EnvironmentConfig {
    const demoMode = process.env.DEMO_MODE === "true";
    const mainnetReadonly = process.env.MAINNET_READONLY === "true";
    const manualApproval = process.env.MANUAL_APPROVAL === "true" || 
                          process.env.MANUAL_APPROVAL !== "false"; // Default true
    const killSwitchActive = process.env.KILL_SWITCH_ACTIVE === "true";
    
    // Determine execution mode
    let mode: ExecutionMode;
    if (demoMode) {
      mode = "DEMO";
    } else if (mainnetReadonly) {
      mode = "READONLY";
    } else if (manualApproval) {
      mode = "MANUAL_APPROVAL";
    } else {
      mode = "AUTONOMOUS";
    }

    return {
      mode,
      demoMode,
      mainnetReadonly,
      manualApproval,
      killSwitchActive,
      network: (process.env.NETWORK as any) || "mainnet",
      rpcEndpoint: process.env.MONAD_RPC_URL || "https://rpc.monad.xyz",
    };
  }

  /**
   * Print startup banner showing current mode
   * Turkish: "Uygulama her başladığında aktif modu büyük bir ASCII sanatı ile basarak 
   * geliştiricinin hangi modda olduğunu %100 bilmesini sağla"
   */
  private printStartupBanner(): void {
    const banner = this.getModeBanner(this.config.mode);
    console.log("\n" + "=".repeat(70));
    console.log(banner);
    console.log("=".repeat(70));
    console.log(`Network: ${this.config.network.toUpperCase()}`);
    console.log(`RPC: ${this.config.rpcEndpoint}`);
    console.log(`Kill Switch: ${this.config.killSwitchActive ? "🔴 ACTIVE" : "🟢 INACTIVE"}`);
    console.log("=".repeat(70) + "\n");
  }

  private getModeBanner(mode: ExecutionMode): string {
    switch (mode) {
      case "DEMO":
        return `
 ██████╗ ███████╗███╗   ███╗ ██████╗     ███╗   ███╗ ██████╗ ██████╗ ███████╗
 ██╔══██╗██╔════╝████╗ ████║██╔═══██╗    ████╗ ████║██╔═══██╗██╔══██╗██╔════╝
 ██║  ██║█████╗  ██╔████╔██║██║   ██║    ██╔████╔██║██║   ██║██║  ██║█████╗  
 ██║  ██║██╔══╝  ██║╚██╔╝██║██║   ██║    ██║╚██╔╝██║██║  ██║██║  ██║██╔══╝  
 ██████╔╝███████╗██║ ╚═╝ ██║╚██████╔╝    ██║ ╚═╝ ██║╚██████╔╝██████╔╝███████╗
 ╚═════╝ ╚══════╝╚═╝     ╚═╝ ╚═════╝     ╚═╝     ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝
 
 🎮 ALL OPERATIONS SIMULATED - NO REAL TRANSACTIONS
`;
      case "READONLY":
        return `
 ██████╗ ███████╗ █████╗ ██████╗      ██████╗ ███╗   ██╗██╗  ██╗   ██╗
 ██╔══██╗██╔════╝██╔══██╗██╔══██╗    ██╔═══██╗████╗  ██║██║  ╚██╗ ██╔╝
 ██████╔╝█████╗  ███████║██║  ██║    ██║   ██║██╔██╗ ██║██║   ╚████╔╝ 
 ██╔══██╗██╔══╝  ██╔══██║██║  ██║    ██║   ██║██║╚██╗██║██║    ╚██╔╝  
 ██║  ██║███████╗██║  ██║██████╔╝    ╚██████╔╝██║ ╚████║███████╗██║   
 ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═════╝      ╚═════╝ ╚═╝  ╚═══╝╚══════╝╚═╝   
 
 🔒 READ-ONLY MODE - ALL WRITE OPERATIONS BLOCKED
`;
      case "MANUAL_APPROVAL":
        return `
 ███╗   ███╗ █████╗ ███╗   ██╗██╗   ██╗ █████╗ ██╗          █████╗ ██████╗ ██████╗ ██████╗  ██████╗ ██╗   ██╗ █████╗ ██╗     
 ████╗ ████║██╔══██╗████╗  ██║██║   ██║██╔══██╗██║         ██╔══██╗██╔══██╗██╔══██╗██╔══██╗██╔═══██╗██║   ██║██╔══██╗██║     
 ██╔████╔██║███████║██╔██╗ ██║██║   ██║███████║██║         ███████║██████╔╝██████╔╝██████╔╝██║   ██║██║   ██║███████║██║     
 ██║╚██╔╝██║██╔══██║██║╚██╗██║██║   ██║██╔══██║██║         ██╔══██║██╔═══╝ ██╔═══╝ ██╔══██╗██║   ██║╚██╗ ██╔╝██╔══██║██║     
 ██║ ╚═╝ ██║██║  ██║██║ ╚████║╚██████╔╝██║  ██║███████╗    ██║  ██║██║     ██║     ██║  ██║╚██████╔╝ ╚████╔╝ ██║  ██║███████╗
 ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝    ╚═╝  ╚═╝╚═╝     ╚═╝     ╚═╝  ╚═╝ ╚═════╝   ╚═══╝  ╚═╝  ╚═╝╚══════╝
 
 ✅ WRITES REQUIRE HUMAN APPROVAL
`;
      case "AUTONOMOUS":
        return `
 ⚠️  ██╗    ██╗ █████╗ ██████╗ ███╗   ██╗██╗███╗   ██╗ ██████╗ ⚠️
 ⚠️  ██║    ██║██╔══██╗██╔══██╗████╗  ██║██║████╗  ██║██╔════╝ ⚠️
 ⚠️  ██║ █╗ ██║███████║██████╔╝██╔██╗ ██║██║██╔██╗ ██║██║  ███╗⚠️
 ⚠️  ██║███╗██║██╔══██║██╔══██╗██║╚██╗██║██║██║╚██╗██║██║   ██║⚠️
 ⚠️  ╚███╔███╔╝██║  ██║██║  ██║██║ ╚████║██║██║ ╚████║╚██████╔╝⚠️
 ⚠️   ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝  ╚═══╝ ╚═════╝ ⚠️
 
 🚨 AUTONOMOUS MODE - REAL TRANSACTIONS WITHOUT APPROVAL 🚨
`;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<EnvironmentConfig> {
    return { ...this.config };
  }

  /**
   * Get current execution mode
   */
  getMode(): ExecutionMode {
    return this.config.mode;
  }

  /**
   * Check if a write operation is allowed
   */
  canWrite(): ModeValidationResult {
    if (this.config.killSwitchActive) {
      return {
        allowed: false,
        reason: "Kill switch is active - all writes blocked",
        mode: this.config.mode,
        requiresApproval: false,
        isSimulated: false,
      };
    }

    if (this.config.demoMode) {
      return {
        allowed: true,
        reason: "Demo mode - operation will be simulated",
        mode: "DEMO",
        requiresApproval: false,
        isSimulated: true,
      };
    }

    if (this.config.mainnetReadonly) {
      return {
        allowed: false,
        reason: "Read-only mode - write operations are blocked",
        mode: "READONLY",
        requiresApproval: false,
        isSimulated: false,
      };
    }

    if (this.config.manualApproval) {
      return {
        allowed: true,
        reason: "Manual approval required before execution",
        mode: "MANUAL_APPROVAL",
        requiresApproval: true,
        isSimulated: false,
      };
    }

    return {
      allowed: true,
      reason: "Autonomous mode - operation will execute immediately",
      mode: "AUTONOMOUS",
      requiresApproval: false,
      isSimulated: false,
    };
  }

  /**
   * Validate an operation before execution
   * Turkish: "READONLY ise ve sendTransaction çağrısı gelirse, Security Alert olarak logla"
   */
  validateOperation(
    operationType: "read" | "write" | "admin",
    operationName: string
  ): ModeValidationResult {
    if (operationType === "read") {
      return {
        allowed: true,
        mode: this.config.mode,
        requiresApproval: false,
        isSimulated: this.config.demoMode,
      };
    }

    const writeResult = this.canWrite();

    if (!writeResult.allowed) {
      this.logSecurityAlert({
        type: writeResult.mode === "READONLY" ? "WRITE_BLOCKED" : "KILL_SWITCH",
        message: `Blocked ${operationType} operation: ${operationName}`,
        timestamp: Date.now(),
        mode: this.config.mode,
        operation: operationName,
        details: { operationType, reason: writeResult.reason },
      });
    }

    return writeResult;
  }

  /**
   * Log a security alert
   */
  logSecurityAlert(alert: SecurityAlert): void {
    this.alerts.push(alert);
    
    // Trim old alerts
    if (this.alerts.length > this.maxAlerts) {
      this.alerts.splice(0, this.alerts.length - this.maxAlerts);
    }

    // Console output with severity indicator
    const severityIcon = alert.type === "KILL_SWITCH" ? "🚨" : 
                        alert.type === "WRITE_BLOCKED" ? "🔒" :
                        alert.type === "APPROVAL_REQUIRED" ? "✋" : "⚠️";
    
    console.error(`\n${severityIcon} SECURITY ALERT [${alert.type}]`);
    console.error(`   Mode: ${alert.mode}`);
    console.error(`   Operation: ${alert.operation}`);
    console.error(`   Message: ${alert.message}`);
    console.error(`   Time: ${new Date(alert.timestamp).toISOString()}`);
    if (alert.details) {
      console.error(`   Details:`, JSON.stringify(alert.details, null, 2));
    }
    console.error("");
  }

  /**
   * Get recent security alerts
   */
  getSecurityAlerts(limit = 100): SecurityAlert[] {
    return this.alerts.slice(-limit);
  }

  /**
   * Activate kill switch
   */
  activateKillSwitch(reason: string): void {
    this.config.killSwitchActive = true;
    this.logSecurityAlert({
      type: "KILL_SWITCH",
      message: `Kill switch activated: ${reason}`,
      timestamp: Date.now(),
      mode: this.config.mode,
      operation: "SYSTEM",
      details: { reason },
    });
  }

  /**
   * Deactivate kill switch
   */
  deactivateKillSwitch(): void {
    this.config.killSwitchActive = false;
  }

  /**
   * Update mode at runtime (for testing/admin)
   */
  setMode(mode: ExecutionMode): void {
    this.config.mode = mode;
    this.config.demoMode = mode === "DEMO";
    this.config.mainnetReadonly = mode === "READONLY";
    this.config.manualApproval = mode === "MANUAL_APPROVAL";
    
    console.log(`\n⚙️ Mode changed to: ${mode}\n`);
    this.printStartupBanner();
  }

  /**
   * Get UI display info
   */
  getUIInfo(): {
    mode: ExecutionMode;
    badge: { text: string; color: string; icon: string };
    warnings: string[];
    canExecute: boolean;
  } {
    const badge = this.getModeBadge();
    const warnings = this.getModeWarnings();
    const canExecute = !this.config.mainnetReadonly && !this.config.killSwitchActive;

    return {
      mode: this.config.mode,
      badge,
      warnings,
      canExecute,
    };
  }

  private getModeBadge(): { text: string; color: string; icon: string } {
    switch (this.config.mode) {
      case "DEMO":
        return { text: "DEMO MODE", color: "cyan", icon: "🎮" };
      case "READONLY":
        return { text: "READ ONLY", color: "yellow", icon: "🔒" };
      case "MANUAL_APPROVAL":
        return { text: "MANUAL APPROVAL", color: "green", icon: "✅" };
      case "AUTONOMOUS":
        return { text: "⚠️ AUTONOMOUS", color: "red", icon: "🚨" };
    }
  }

  private getModeWarnings(): string[] {
    const warnings: string[] = [];
    
    if (this.config.killSwitchActive) {
      warnings.push("🚨 KILL SWITCH ACTIVE - All operations blocked");
    }
    
    if (this.config.mode === "AUTONOMOUS") {
      warnings.push("⚠️ Running in AUTONOMOUS mode - transactions will execute without approval");
    }
    
    if (this.config.network === "mainnet" && !this.config.demoMode) {
      warnings.push("💰 Connected to MAINNET - Real funds at risk");
    }
    
    return warnings;
  }
}

// Singleton instance
let environmentManager: EnvironmentManager | null = null;

export function getEnvironmentManager(): EnvironmentManager {
  if (!environmentManager) {
    environmentManager = new EnvironmentManager();
  }
  return environmentManager;
}

// ============================================
// ENVIRONMENT GUARD DECORATOR
// ============================================

/**
 * Environment Guard Decorator
 * Turkish: "@EnvironmentGuard decorator'ı - READONLY ise sendTransaction çağrısı 
 * sadece hata vermekle kalmasın, durumu 'Security Alert' olarak loglasın"
 */
export function EnvironmentGuard(operationType: "read" | "write" | "admin" = "write") {
  return function (
    _target: unknown,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = function (...args: unknown[]) {
      const env = getEnvironmentManager();
      const validation = env.validateOperation(operationType, propertyKey);

      if (!validation.allowed) {
        const error = new EnvironmentModeError(
          `Operation '${propertyKey}' blocked: ${validation.reason}`,
          validation.mode,
          propertyKey
        );
        throw error;
      }

      // If simulated, wrap the result
      if (validation.isSimulated) {
        console.log(`🎮 [DEMO] Simulating: ${propertyKey}`);
        return createMockResult(originalMethod, args);
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * Environment Mode Error
 */
export class EnvironmentModeError extends Error {
  constructor(
    message: string,
    public readonly mode: ExecutionMode,
    public readonly operation: string
  ) {
    super(message);
    this.name = "EnvironmentModeError";
  }
}

/**
 * Create mock result for demo mode
 */
function createMockResult(_method: unknown, _args: unknown[]): unknown {
  return {
    success: true,
    simulated: true,
    txHash: `0x${"0".repeat(64)}`,
    message: "This operation was simulated in DEMO mode",
  };
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Check if current environment allows writes
 */
export function canPerformWrite(): boolean {
  return getEnvironmentManager().canWrite().allowed;
}

/**
 * Get current execution mode
 */
export function getCurrentMode(): ExecutionMode {
  return getEnvironmentManager().getMode();
}

/**
 * Check if in demo mode
 */
export function isDemoMode(): boolean {
  return getEnvironmentManager().getConfig().demoMode;
}

/**
 * Check if read-only
 */
export function isReadOnly(): boolean {
  return getEnvironmentManager().getConfig().mainnetReadonly;
}

/**
 * Require manual approval
 */
export function requiresManualApproval(): boolean {
  return getEnvironmentManager().getConfig().manualApproval;
}
