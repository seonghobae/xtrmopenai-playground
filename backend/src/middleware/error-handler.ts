/**
 * Global error handler
 * Ensures consistent error responses and logging
 */

import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';
import { isDevelopment } from '../config/index.js';

/**
 * Error handler
 */
export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  // Log error
  logger.error(
    {
      err: error,
      url: request.url,
      method: request.method,
      user_uuid: request.user?.user_uuid,
    },
    'Request error'
  );

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    return void reply.status(400).send({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: error.errors,
      },
    });
  }

  // Handle Fastify validation errors
  if (error.validation) {
    return void reply.status(400).send({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        details: error.validation,
      },
    });
  }

  // Handle rate limit errors
  if (error.statusCode === 429) {
    return void reply.status(429).send({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests',
      },
    });
  }

  // Handle authentication errors
  if (error.statusCode === 401) {
    return void reply.status(401).send({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: error.message || 'Authentication required',
      },
    });
  }

  // Handle authorization errors
  if (error.statusCode === 403) {
    return void reply.status(403).send({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: error.message || 'Permission denied',
      },
    });
  }

  // Handle not found errors
  if (error.statusCode === 404) {
    return void reply.status(404).send({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: error.message || 'Resource not found',
      },
    });
  }

  // Default to 500 internal server error
  void reply.status(error.statusCode || 500).send({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: isDevelopment ? error.message : 'An internal error occurred',
    },
  });
}

/**
 * Not found handler
 */
export function notFoundHandler(
  request: FastifyRequest,
  reply: FastifyReply
): void {
  void reply.status(404).send({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${request.method} ${request.url} not found`,
    },
  });
}
