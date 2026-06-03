/**
 * Structured logger.
 *
 * Emits single-line JSON to stdout in a fixed shape so every service produces
 * uniform, queryable logs without pulling in a logging framework. Correlation
 * and trace identifiers are bound once per request and threaded through every
 * line.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  service: string;
  requestId?: string;
  traceId?: string;
  correlationId?: string;
}

export interface LogRecord extends LogContext {
  level: LogLevel;
  message: string;
  time: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  /** Return a child logger with additional bound context. */
  child(context: Partial<LogContext>): Logger;
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function resolveThreshold(): number {
  const configured = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as LogLevel;
  return LEVELS[configured] ?? LEVELS.info;
}

export function createLogger(context: LogContext): Logger {
  const threshold = resolveThreshold();

  function emit(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (LEVELS[level] < threshold) return;
    const record: LogRecord = {
      ...context,
      level,
      message,
      time: new Date().toISOString(),
      ...fields,
    };
    // A single structured line keeps CloudWatch parsing trivial.
    process.stdout.write(`${JSON.stringify(record)}\n`);
  }

  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (extra) => createLogger({ ...context, ...extra }),
  };
}
