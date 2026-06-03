/**
 * Environment-backed configuration helper.
 *
 * Centralises access to the environment variables the platform injects into
 * every cell so handlers never read `process.env` directly. Missing required
 * values fail fast with a clear error rather than surfacing as undefined deep
 * in business logic.
 */

export interface PlatformConfig {
  serviceName: string;
  eventBusName?: string;
  tableName?: string;
  /** Map of peer service name -> Lambda function name. */
  registry: Record<string, string>;
  /** Turso/libSQL connection settings, when relational persistence is enabled. */
  turso?: { url: string; authToken?: string };
}

export function getString(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function getOptional(key: string): string | undefined {
  const value = process.env[key];
  return value === undefined || value === '' ? undefined : value;
}

export function loadConfig(): PlatformConfig {
  const registryRaw = getOptional('SERVICE_REGISTRY');
  let registry: Record<string, string> = {};
  if (registryRaw) {
    try {
      registry = JSON.parse(registryRaw) as Record<string, string>;
    } catch {
      throw new Error('SERVICE_REGISTRY is not valid JSON');
    }
  }

  const tursoUrl = getOptional('TURSO_DATABASE_URL');

  return {
    serviceName: getString('SERVICE_NAME'),
    eventBusName: getOptional('EVENT_BUS_NAME'),
    tableName: getOptional('TABLE_NAME'),
    registry,
    turso: tursoUrl ? { url: tursoUrl, authToken: getOptional('TURSO_AUTH_TOKEN') } : undefined,
  };
}
