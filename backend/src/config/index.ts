/**
 * Application configuration
 * Loads from environment variables with validation
 */

import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';
import type { AppConfig } from '../types/index.js';

// Load .env file
dotenvConfig();

// Configuration schema
const configSchema = z.object({
  SERVER_HOST: z.string().default('0.0.0.0'),
  SERVER_PORT: z.coerce.number().default(3000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  DATABASE_HOST: z.string().default('localhost'),
  DATABASE_PORT: z.coerce.number().default(5432),
  DATABASE_NAME: z.string().default('openai_playground'),
  DATABASE_USER: z.string().default('postgres'),
  DATABASE_PASSWORD: z.string(),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().default(10),

  OIDC_ISSUER: z.string().url(),
  OIDC_CLIENT_ID: z.string(),
  OIDC_CLIENT_SECRET: z.string(),
  OIDC_REDIRECT_URI: z.string().url(),
  OIDC_SCOPE: z.string().default('openid profile email'),

  OPENAI_API_KEY: z.string(),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),

  SESSION_SECRET: z.string().min(32),
  SESSION_TTL_SECONDS: z.coerce.number().default(86400), // 24 hours
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000), // 1 minute

  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

// Validate environment
const envResult = configSchema.safeParse(process.env);

if (!envResult.success) {
  console.error('Configuration validation failed:');
  console.error(envResult.error.format());
  process.exit(1);
}

const env = envResult.data;

// Export typed configuration
export const config: AppConfig = {
  server: {
    host: env.SERVER_HOST,
    port: env.SERVER_PORT,
    cors_origin: env.CORS_ORIGIN.split(',').map(s => s.trim()),
  },
  database: {
    host: env.DATABASE_HOST,
    port: env.DATABASE_PORT,
    database: env.DATABASE_NAME,
    user: env.DATABASE_USER,
    password: env.DATABASE_PASSWORD,
    max_connections: env.DATABASE_MAX_CONNECTIONS,
  },
  oidc: {
    issuer: env.OIDC_ISSUER,
    client_id: env.OIDC_CLIENT_ID,
    client_secret: env.OIDC_CLIENT_SECRET,
    redirect_uri: env.OIDC_REDIRECT_URI,
    scope: env.OIDC_SCOPE,
  },
  openai: {
    api_key: env.OPENAI_API_KEY,
    base_url: env.OPENAI_BASE_URL,
  },
  security: {
    session_secret: env.SESSION_SECRET,
    session_ttl_seconds: env.SESSION_TTL_SECONDS,
    rate_limit_max: env.RATE_LIMIT_MAX,
    rate_limit_window_ms: env.RATE_LIMIT_WINDOW_MS,
  },
};

export const isDevelopment = env.NODE_ENV === 'development';
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const logLevel = env.LOG_LEVEL;
