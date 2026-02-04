/**
 * NEURO Logger
 * Structured logging with Pino
 */

import pino, { type Logger, type LoggerOptions } from "pino";

// ============================================
// LOGGER CONFIGURATION
// ============================================

const isDevelopment = process.env.NODE_ENV === "development";
const logLevel = process.env.LOG_LEVEL || "info";
const logFormat = process.env.LOG_FORMAT || "json";

const baseOptions: LoggerOptions = {
  level: logLevel,
  base: {
    service: "neuro",
    env: process.env.NODE_ENV || "production",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
    bindings: (bindings) => ({
      pid: bindings.pid,
      host: bindings.hostname,
      service: bindings.service,
      env: bindings.env,
    }),
  },
  redact: {
    paths: [
      "*.privateKey",
      "*.OPERATOR_PRIVATE_KEY",
      "*.password",
      "*.secret",
      "*.apiKey",
      "*.API_KEY",
      "*.token",
      "*.OPENAI_API_KEY",
      "*.ANTHROPIC_API_KEY",
    ],
    censor: "[REDACTED]",
  },
};

// Pretty printing for development
const devOptions: LoggerOptions = {
  ...baseOptions,
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:standard",
      ignore: "pid,hostname",
      messageFormat: "{msg}",
    },
  },
};

// ============================================
// LOGGER INSTANCE
// ============================================

export const logger: Logger =
  isDevelopment && logFormat === "pretty"
    ? pino(devOptions)
    : pino(baseOptions);

// ============================================
// CHILD LOGGERS FOR SERVICES
// ============================================

export function createServiceLogger(serviceName: string): Logger {
  return logger.child({ service: serviceName });
}

// Pre-configured service loggers
export const executionLogger = createServiceLogger("execution");
export const orchestratorLogger = createServiceLogger("orchestrator");
export const ingestionLogger = createServiceLogger("ingestion");
export const dashboardLogger = createServiceLogger("dashboard");

// ============================================
// STRUCTURED LOG HELPERS
// ============================================

interface TransactionLogContext {
  txHash?: string;
  from?: string;
  to?: string;
  value?: string;
  gasLimit?: string;
  type?: string;
}

interface ApprovalLogContext {
  approvalId: string;
  actionType: string;
  riskLevel: string;
  status: string;
}

interface AIDecisionLogContext {
  decisionId: string;
  decisionType: string;
  confidence: number;
  modelUsed: string;
}

/**
 * Logs a transaction event with structured context
 */
export function logTransaction(
  level: "info" | "warn" | "error",
  event: string,
  context: TransactionLogContext,
  message?: string
): void {
  executionLogger[level](
    {
      event,
      tx: context,
    },
    message || event
  );
}

/**
 * Logs an approval event with structured context
 */
export function logApproval(
  level: "info" | "warn" | "error",
  event: string,
  context: ApprovalLogContext,
  message?: string
): void {
  orchestratorLogger[level](
    {
      event,
      approval: context,
    },
    message || event
  );
}

/**
 * Logs an AI decision event with structured context
 */
export function logAIDecision(
  level: "info" | "warn" | "error",
  event: string,
  context: AIDecisionLogContext,
  message?: string
): void {
  orchestratorLogger[level](
    {
      event,
      aiDecision: context,
    },
    message || event
  );
}

/**
 * Logs a security event
 */
export function logSecurityEvent(
  level: "info" | "warn" | "error",
  event: string,
  details: Record<string, unknown>,
  message?: string
): void {
  logger[level](
    {
      event,
      security: true,
      ...details,
    },
    message || event
  );
}

// ============================================
// AUDIT LOGGING
// ============================================

interface AuditLogEntry {
  action: string;
  entityType: string;
  entityId?: string;
  actor: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}

/**
 * Creates an audit log entry
 * In production, this should also persist to the database
 */
export function audit(entry: AuditLogEntry): void {
  logger.info(
    {
      audit: true,
      ...entry,
      timestamp: new Date().toISOString(),
    },
    `AUDIT: ${entry.action} on ${entry.entityType}${entry.entityId ? ` (${entry.entityId})` : ""} by ${entry.actor}`
  );
}

// ============================================
// ERROR LOGGING
// ============================================

/**
 * Logs an error with stack trace and context
 */
export function logError(
  error: Error,
  context?: Record<string, unknown>,
  message?: string
): void {
  logger.error(
    {
      err: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      ...context,
    },
    message || error.message
  );
}

/**
 * Logs a fatal error (system should shut down)
 */
export function logFatal(
  error: Error,
  context?: Record<string, unknown>,
  message?: string
): void {
  logger.fatal(
    {
      err: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      ...context,
    },
    message || `FATAL: ${error.message}`
  );
}

// ============================================
// PERFORMANCE LOGGING
// ============================================

/**
 * Creates a timer for measuring operation duration
 */
export function createTimer(operationName: string): () => void {
  const start = performance.now();
  
  return () => {
    const duration = performance.now() - start;
    logger.debug(
      {
        operation: operationName,
        durationMs: duration.toFixed(2),
      },
      `${operationName} completed in ${duration.toFixed(2)}ms`
    );
  };
}

/**
 * Wraps an async function with timing
 */
export async function withTiming<T>(
  operationName: string,
  fn: () => Promise<T>
): Promise<T> {
  const done = createTimer(operationName);
  try {
    const result = await fn();
    done();
    return result;
  } catch (error) {
    done();
    throw error;
  }
}
