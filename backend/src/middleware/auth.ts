/**
 * Authentication middleware
 * Verifies session and attaches authenticated user to request
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  getSessionByKey,
  getUserByUuid,
  buildAuthenticatedUser,
  updateSessionLastUsed,
} from '../modules/auth/repository.js';
import { logger } from '../utils/logger.js';
import type { AuthenticatedUser } from '../types/index.js';

// Extend Fastify request type
declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
    session_uuid?: string;
  }
}

/**
 * Authentication middleware - requires valid session
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    // Get session from cookie
    const sessionCookieResult = request.unsignCookie(request.cookies.session_id || '');
    const sessionKey = sessionCookieResult.valid ? sessionCookieResult.value : null;

    if (!sessionKey) {
      return reply.status(401).send({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'No session found',
        },
      });
    }

    // Validate session
    const session = await getSessionByKey(sessionKey);

    if (!session) {
      return reply.status(401).send({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired session',
        },
      });
    }

    // Get user
    const userAccount = await getUserByUuid(session.user_uuid);

    if (!userAccount) {
      return reply.status(401).send({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'User not found',
        },
      });
    }

    // Build authenticated user with organizations
    const authenticatedUser = await buildAuthenticatedUser(userAccount);

    // Attach to request
    request.user = authenticatedUser;
    request.session_uuid = session.session_uuid;

    // Update session activity for inactivity timeout enforcement
    await updateSessionLastUsed(session.session_uuid);

    logger.debug(
      {
        user_uuid: authenticatedUser.user_uuid,
        session_uuid: session.session_uuid,
      },
      'Request authenticated'
    );
  } catch (err) {
    logger.error({ err }, 'Authentication middleware error');
    return reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Authentication failed',
      },
    });
  }
}

/**
 * Optional authentication - attaches user if session exists
 */
export async function optionalAuthenticate(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  try {
    const sessionCookieResult = request.unsignCookie(request.cookies.session_id || '');
    const sessionKey = sessionCookieResult.valid ? sessionCookieResult.value : null;

    if (!sessionKey) {
      return;
    }

    const session = await getSessionByKey(sessionKey);
    if (!session) {
      return;
    }

    const userAccount = await getUserByUuid(session.user_uuid);
    if (!userAccount) {
      return;
    }

    const authenticatedUser = await buildAuthenticatedUser(userAccount);
    request.user = authenticatedUser;
    request.session_uuid = session.session_uuid;
    await updateSessionLastUsed(session.session_uuid);
  } catch (err) {
    logger.warn({ err }, 'Optional authentication failed');
  }
}

/**
 * Require specific role in organization
 */
const orgUuidSchema = z.object({ org_uuid: z.string().uuid() });

export function requireRole(role: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      return reply.status(401).send({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
    }

    const sources = [request.query, request.params, request.body];
    let orgUuid: string | null = null;
    let validationError: z.ZodError | null = null;

    for (const source of sources) {
      if (!source) continue;
      const parsed = orgUuidSchema.safeParse(source);
      if (parsed.success) {
        orgUuid = parsed.data.org_uuid;
        validationError = null;
        break;
      }
      validationError = parsed.error;
    }

    if (!orgUuid) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Valid organization UUID required',
          details: validationError?.errors,
        },
      });
    }

    // Check if user has role in organization
    const org = request.user.organizations.find(o => o.org_uuid === orgUuid);

    if (!org) {
      return reply.status(403).send({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Not a member of this organization',
        },
      });
    }

    if (!org.role_list.includes(role) && !org.role_list.includes('admin')) {
      return reply.status(403).send({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `Role '${role}' required`,
        },
      });
    }
  };
}
