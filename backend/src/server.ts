/**
 * Main server entry point
 * Fastify server with security hardening (Helmet, CORS, rate limiting)
 */

import crypto from 'crypto';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import { config, isProduction } from './config/index.js';
import { logger } from './utils/logger.js';
import { healthCheck, closePool } from './utils/database.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { discoverOidcConfig } from './modules/auth/oidc.js';
import { deleteExpiredSessions } from './modules/auth/repository.js';

const OIDC_RETURN_URL_COOKIE = 'oidc_return_to';

function resolveRedirectTarget(target?: string): string {
  const defaultUrl = new URL('/dashboard', config.server.default_origin).toString();

  if (!target) {
    return defaultUrl;
  }

  try {
    const resolved = new URL(target, config.server.default_origin);
    if (!config.server.cors_origin.includes(resolved.origin)) {
      return defaultUrl;
    }
    return resolved.toString();
  } catch {
    return defaultUrl;
  }
}

// Create Fastify instance
const server = Fastify({
  logger: logger as any,
  requestIdHeader: 'x-request-id',
  requestIdLogLabel: 'request_id',
  disableRequestLogging: false,
  trustProxy: true,
});

// Session cleanup scheduler
let sessionCleanupInterval: NodeJS.Timeout | null = null;
let isCleanupRunning = false;

/**
 * Register plugins
 */
async function registerPlugins() {
  // Security headers
  await server.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", config.oidc.issuer],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  });

  // CORS
  await server.register(cors, {
    origin: config.server.cors_origin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['X-Request-Id'],
  });

  // Rate limiting
  await server.register(rateLimit, {
    global: true,
    max: config.security.rate_limit_max,
    timeWindow: config.security.rate_limit_window_ms,
    errorResponseBuilder: () => ({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests, please try again later',
      },
    }),
  });

  // Cookie support
  await server.register(cookie, {
    secret: config.security.session_secret,
    parseOptions: {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
    },
  });
}

/**
 * Register routes
 */
async function registerRoutes() {
  // Health check
  server.get('/health', async () => {
    const dbHealthy = await healthCheck();
    return {
      success: true,
      data: {
        status: dbHealthy ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
      },
    };
  });

  // Auth routes
  server.get('/api/auth/login', async (request, reply) => {
    const { buildAuthorizationUrl, generateState, generateNonce, generatePkce } = await import('./modules/auth/oidc.js');

    const state = generateState();
    const nonce = generateNonce();
    const { codeVerifier, codeChallenge } = generatePkce();

    // Store state, nonce, codeVerifier in session (temporary storage)
    const loginQuery = request.query as { return_to?: string };
    const returnTo = typeof loginQuery?.return_to === 'string' ? loginQuery.return_to : undefined;

    reply.setCookie('oidc_state', state, { httpOnly: true, secure: isProduction, maxAge: 600 });
    reply.setCookie('oidc_nonce', nonce, { httpOnly: true, secure: isProduction, maxAge: 600 });
    reply.setCookie('oidc_verifier', codeVerifier, { httpOnly: true, secure: isProduction, maxAge: 600 });

    if (returnTo) {
      reply.setCookie(OIDC_RETURN_URL_COOKIE, returnTo, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        maxAge: 600,
      });
    } else {
      reply.clearCookie(OIDC_RETURN_URL_COOKIE);
    }

    const authUrl = await buildAuthorizationUrl(state, nonce, codeChallenge);
    return reply.redirect(authUrl);
  });

  server.get('/api/auth/callback', async (request, reply) => {
    const { code, state } = request.query as { code?: string; state?: string };

    if (!code || !state) {
      return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: 'Missing code or state' } });
    }

    // Verify state
    const storedState = request.cookies.oidc_state;
    if (state !== storedState) {
      return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: 'State mismatch' } });
    }

    const codeVerifier = request.cookies.oidc_verifier;
    const nonce = request.cookies.oidc_nonce;

    if (!codeVerifier || !nonce) {
      return reply.status(400).send({ success: false, error: { code: 'BAD_REQUEST', message: 'Missing PKCE verifier or nonce' } });
    }

    const { exchangeCodeForTokens, verifyIdToken } = await import('./modules/auth/oidc.js');
    const { upsertUserAccount, createSession } = await import('./modules/auth/repository.js');
    const { createAuditLog, AuditAction, AuditResult } = await import('./modules/audit/repository.js');

    try {
      // Exchange code for tokens
      const tokens = await exchangeCodeForTokens(code, codeVerifier);

      // Verify ID token
      const idTokenPayload = await verifyIdToken(tokens.id_token, nonce);

      // Create or update user
      const user = await upsertUserAccount(
        idTokenPayload.sub,
        idTokenPayload.email || null,
        idTokenPayload.name || null,
        { groups: idTokenPayload.groups, roles: idTokenPayload.roles }
      );

      // Create session
      const expiresAt = new Date(Date.now() + config.security.session_ttl_seconds * 1000);
      const sessionKey = crypto.randomBytes(32).toString('base64url');

      await createSession(user.user_uuid, sessionKey, tokens as any, expiresAt);

      // Set session cookie
      reply.setCookie('session_id', sessionKey, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        maxAge: config.security.session_ttl_seconds,
      });

      // Clear temporary cookies
      reply.clearCookie('oidc_state');
      reply.clearCookie('oidc_nonce');
      reply.clearCookie('oidc_verifier');
      const requestedRedirect = request.cookies[OIDC_RETURN_URL_COOKIE];
      reply.clearCookie(OIDC_RETURN_URL_COOKIE);

      // Audit log
      await createAuditLog({
        user_uuid: user.user_uuid,
        action_name: AuditAction.LOGIN_SUCCESS,
        result_code: AuditResult.SUCCESS,
        ip_addr: request.ip,
        user_agent: request.headers['user-agent'],
      });

      return reply.redirect(resolveRedirectTarget(requestedRedirect));
    } catch (err) {
      logger.error({ err }, 'Login callback failed');
      return reply.status(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Login failed' } });
    }
  });

  server.post('/api/auth/logout', async (request, reply) => {
    const { authenticate } = await import('./middleware/auth.js');
    await authenticate(request, reply);

    if (!request.user) return;

    const { deleteSession } = await import('./modules/auth/repository.js');
    const { createAuditLog, AuditAction, AuditResult } = await import('./modules/audit/repository.js');

    const sessionKey = request.cookies.session_id;
    if (sessionKey) {
      await deleteSession(sessionKey);
    }

    reply.clearCookie('session_id');

    await createAuditLog({
      user_uuid: request.user.user_uuid,
      action_name: AuditAction.LOGOUT,
      result_code: AuditResult.SUCCESS,
      ip_addr: request.ip,
      user_agent: request.headers['user-agent'],
    });

    return { success: true };
  });

  // User info
  server.get('/api/auth/me', async (request, reply) => {
    const { authenticate } = await import('./middleware/auth.js');
    await authenticate(request, reply);

    if (!request.user) return;

    return { success: true, data: request.user };
  });

  // MCP routes - placeholder (full implementation would be extensive)
  server.post('/api/mcp/servers', async (request, reply) => {
    const { authenticate } = await import('./middleware/auth.js');
    await authenticate(request, reply);

    if (!request.user) return;

    // Implementation would go here
    return { success: true, message: 'MCP server creation endpoint' };
  });

  // Responses routes - placeholder
  server.post('/api/responses/run', async (request, reply) => {
    const { authenticate } = await import('./middleware/auth.js');
    await authenticate(request, reply);

    if (!request.user) return;

    // Implementation would go here
    return { success: true, message: 'Responses API execution endpoint' };
  });

  // Usage routes - placeholder
  server.get('/api/usage/summary', async (request, reply) => {
    const { authenticate } = await import('./middleware/auth.js');
    await authenticate(request, reply);

    if (!request.user) return;

    // Implementation would go here
    return { success: true, message: 'Usage summary endpoint' };
  });

  // Audit routes - placeholder
  server.get('/api/audits', async (request, reply) => {
    const { authenticate } = await import('./middleware/auth.js');
    await authenticate(request, reply);

    if (!request.user) return;

    // Implementation would go here
    return { success: true, message: 'Audit logs endpoint' };
  });
}

/**
 * Start server
 */
async function start() {
  try {
    // Discover OIDC configuration at startup
    await discoverOidcConfig();
    logger.info('OIDC configuration discovered');

    // Check database connection
    const dbHealthy = await healthCheck();
    if (!dbHealthy) {
      throw new Error('Database health check failed');
    }
    logger.info('Database connection established');

    // Register plugins and routes
    await registerPlugins();
    await registerRoutes();

    // Set error handlers
    server.setErrorHandler(errorHandler);
    server.setNotFoundHandler(notFoundHandler);

    // Start listening
    await server.listen({
      host: config.server.host,
      port: config.server.port,
    });

    // Start session cleanup scheduler
    // NOTE: This is for database housekeeping only. Session expiry and inactivity
    // enforcement happens at every authenticated request in getSessionByKey() WHERE clause.
    // This scheduler just removes stale records to prevent table bloat.
    const cleanupIntervalMs = config.security.session_cleanup_interval_seconds * 1000;
    
    sessionCleanupInterval = setInterval(async () => {
      if (isCleanupRunning) {
        logger.warn('Session cleanup already running, skipping this interval');
        return;
      }
      
      isCleanupRunning = true;
      try {
        await deleteExpiredSessions();
      } catch (err) {
        logger.error({ err }, 'Session cleanup failed');
      } finally {
        isCleanupRunning = false;
      }
    }, cleanupIntervalMs);
    
    logger.info(
      { intervalSeconds: config.security.session_cleanup_interval_seconds },
      'Session cleanup scheduler started'
    );

    logger.info(
      {
        host: config.server.host,
        port: config.server.port,
      },
      'Server started'
    );
  } catch (err) {
    logger.error({ err }, 'Server startup failed');
    process.exit(1);
  }
}

/**
 * Graceful shutdown
 */
async function shutdown() {
  logger.info('Shutting down server...');

  try {
    // Stop session cleanup scheduler
    if (sessionCleanupInterval) {
      clearInterval(sessionCleanupInterval);
      sessionCleanupInterval = null;
      
      // Wait for any running cleanup to complete
      if (isCleanupRunning) {
        logger.info('Waiting for session cleanup to complete...');
        while (isCleanupRunning) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      logger.info('Session cleanup scheduler stopped');
    }

    await server.close();
    await closePool();
    logger.info('Server shut down gracefully');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
start();
