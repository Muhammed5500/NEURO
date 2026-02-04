/**
 * @neuro/shared
 * Shared utilities, schemas, and security policies for NEURO
 */

// Export schemas (includes type definitions)
export * from "./schemas/index.js";

// Export constants (includes MONAD_MAINNET, GAS_CONFIG, etc.)
export * from "./constants/index.js";

// Export logger (includes logger, orchestratorLogger, executionLogger, etc.)
export {
  logger,
  createServiceLogger,
  executionLogger,
  orchestratorLogger,
  ingestionLogger,
  dashboardLogger,
  logTransaction,
  logApproval,
  logAIDecision,
  logSecurityEvent,
  audit,
  logError,
  logFatal,
  createTimer,
  withTiming,
} from "./logger/index.js";

// Export security (avoid re-exporting types that conflict with schemas)
export {
  // Kill switch and security state
  activateKillSwitch,
  deactivateKillSwitch,
  isKillSwitchActive,
  getKillSwitchState,
  // Execution mode
  setExecutionMode,
  getExecutionMode,
  canWrite,
  isManualApprovalRequired,
  // Security config
  getSecurityConfig,
  updateSecurityConfig,
  // Transaction validation
  validateTransactionExecution,
  // Gas calculation
  calculateGasWithBuffer,
  calculateStorageOptimizedGas,
  // Finality
  getFinalityWaitMs,
  getFinalityBlocks,
  waitForFinality,
  // Security initialization
  initializeSecurity,
} from "./security/index.js";

// Export security layer components
export {
  SecurityLayer,
  getSecurityLayer,
  resetSecurityLayer,
  quickSecurityCheck,
  initializeSecurity as initializeSecurityLayer,
  // Adversarial patterns
  getAdversarialPatternDatabase,
  resetAdversarialPatternDatabase,
  scanForAdversarialPatterns,
  isTextSafe,
  AdversarialPatternDatabase,
  // Content sanitization  
  sanitizeContent,
  ContentSanitizer,
  createContentSanitizer,
  // Message bus
  ZeroTrustMessageBus,
  getMessageBus,
  resetMessageBus,
  createSecureMessage,
  validateSecureMessage,
  createChannel,
  Channels,
  // Rate limiting
  RateLimiter,
  getRateLimiter,
  resetRateLimiter,
  checkRateLimit,
  checkRateLimits,
  createRateLimitMiddleware,
  // Anomaly detection
  AnomalyDetector,
  getAnomalyDetector,
  resetAnomalyDetector,
  detectAnomalies,
  onAnomaly,
  onKillSwitchTrigger,
  // Signature verification
  SignatureVerifier,
  getSignatureVerifier,
  signWithHmac,
  verifySignature,
  generateSigningKeyPair,
  isSignatureValid,
  // Allowlist
  AllowlistManager,
  getAllowlistManager,
  isAddressAllowed,
  isTokenAllowed,
  isSourceAllowed,
  allowAddress,
  blockAddress,
  initializeDefaultAllowlists,
  // Proof of intent
  ProofOfIntentService,
  createProofOfIntentService,
  // Secure message
  SecureMessageService,
  createSecureMessageService,
  generateSecretKey,
  // Environment mode
  EnvironmentManager,
  getEnvironmentManager,
  EnvironmentGuard,
  EnvironmentModeError,
  canPerformWrite,
  getCurrentMode,
  isDemoMode,
  isReadOnly,
  requiresManualApproval,
} from "./security/index.js";

// Export types from types/index.ts that don't conflict with schemas
export type {
  WalletConfig,
  PendingTransaction,
  ApiResponse,
  PaginatedResponse,
  NeuroEvent,
} from "./types/index.js";
