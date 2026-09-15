const REQUIRED_KEYS = ['DATABASE_URL'] as const;

/**
 * Fails fast at boot if required configuration is missing, instead of
 * surfacing a confusing failure later (e.g. on first database query).
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const missing = REQUIRED_KEYS.filter((key) => {
    const value = config[key];
    return value === undefined || value === null || value === '';
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        'Copy .env.example to .env and fill in the values.',
    );
  }

  return config;
}
