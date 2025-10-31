/**
 * Structured logging with Pino
 * Automatically masks sensitive fields (PII, secrets)
 */

import pino from 'pino';
import { logLevel, isDevelopment } from '../config/index.js';

// Fields to mask in logs
const SENSITIVE_FIELDS = [
  'password',
  'token',
  'secret',
  'api_key',
  'auth_header',
  'authorization',
  'cookie',
  'access_token',
  'refresh_token',
  'id_token',
  'client_secret',
  'email',
  'email_address',
  'ip_addr',
  'ip_address',
  'user_agent',
  'user_id',
  'user_email',
  'user_identifier',
  'username',
  'full_name',
  'given_name',
  'family_name',
  'first_name',
  'last_name',
  'phone',
  'phone_number',
  'address',
  'postal_code',
  'ssn',
  'social_security_number',
  'dob',
  'date_of_birth',
  'national_id',
  'passport',
];

// Redact sensitive fields
function redactSensitive(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(redactSensitive);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    const shouldRedact = SENSITIVE_FIELDS.some(field => lowerKey.includes(field));

    if (shouldRedact) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactSensitive(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

// Create logger
export const logger = pino({
  level: logLevel,
  ...(isDevelopment && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  }),
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      headers: redactSensitive(req.headers),
      remoteAddress: req.socket?.remoteAddress,
      remotePort: req.socket?.remotePort,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
      headers: redactSensitive(res.getHeaders()),
    }),
    err: pino.stdSerializers.err,
  },
  redact: {
    paths: SENSITIVE_FIELDS.flatMap(field => [
      field,
      `*.${field}`,
      `**.${field}`,
    ]),
    censor: '[REDACTED]',
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
});

/**
 * Create child logger with context
 */
export function createContextLogger(context: Record<string, unknown>) {
  return logger.child(redactSensitive(context) as Record<string, unknown>);
}
