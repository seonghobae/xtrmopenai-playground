/**
 * Casdoor OIDC Authentication Module
 * Implements Authorization Code Flow with PKCE, JWKS validation
 * Compliant with NIST SP 800-63B (AAL2) and OIDC Core 1.0
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { fetch } from 'undici';
import crypto from 'crypto';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import type { OidcConfig, OidcTokens, IdTokenPayload } from '../../types/index.js';

// Cache for OIDC discovery document
let oidcConfigCache: OidcConfig | null = null;
let oidcConfigCacheTime = 0;
const OIDC_CONFIG_CACHE_TTL = 3600000; // 1 hour

// JWKS for token verification
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/**
 * Discover OIDC configuration from issuer
 */
export async function discoverOidcConfig(): Promise<OidcConfig> {
  const now = Date.now();

  // Return cached config if still valid
  if (oidcConfigCache && now - oidcConfigCacheTime < OIDC_CONFIG_CACHE_TTL) {
    return oidcConfigCache;
  }

  try {
    const wellKnownUrl = new URL('.well-known/openid-configuration', config.oidc.issuer);
    const response = await fetch(wellKnownUrl.toString());

    if (!response.ok) {
      throw new Error(`OIDC discovery failed: ${response.status} ${response.statusText}`);
    }

    const discoveryDoc = (await response.json()) as OidcConfig;

    // Validate required fields
    if (!discoveryDoc.authorization_endpoint || !discoveryDoc.token_endpoint || !discoveryDoc.jwks_uri) {
      throw new Error('Invalid OIDC discovery document: missing required endpoints');
    }

    // Verify issuer matches configuration
    if (discoveryDoc.issuer !== config.oidc.issuer) {
      throw new Error(`Issuer mismatch: expected ${config.oidc.issuer}, got ${discoveryDoc.issuer}`);
    }

    oidcConfigCache = discoveryDoc;
    oidcConfigCacheTime = now;

    // Initialize JWKS
    jwks = createRemoteJWKSet(new URL(discoveryDoc.jwks_uri));

    logger.info({ issuer: discoveryDoc.issuer }, 'OIDC configuration discovered');

    return discoveryDoc;
  } catch (err) {
    logger.error({ err }, 'Failed to discover OIDC configuration');
    throw err;
  }
}

/**
 * Generate PKCE code verifier and challenge
 */
export function generatePkce(): { codeVerifier: string; codeChallenge: string } {
  // Generate code verifier (43-128 characters)
  const codeVerifier = crypto.randomBytes(32).toString('base64url');

  // Generate code challenge (S256)
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  return { codeVerifier, codeChallenge };
}

/**
 * Generate secure random state
 */
export function generateState(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Generate secure random nonce
 */
export function generateNonce(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Build authorization URL
 */
export async function buildAuthorizationUrl(
  state: string,
  nonce: string,
  codeChallenge: string
): Promise<string> {
  const oidcConfig = await discoverOidcConfig();

  const params = new URLSearchParams({
    client_id: config.oidc.client_id,
    redirect_uri: config.oidc.redirect_uri,
    response_type: 'code',
    scope: config.oidc.scope,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return `${oidcConfig.authorization_endpoint}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string
): Promise<OidcTokens> {
  const oidcConfig = await discoverOidcConfig();

  try {
    const response = await fetch(oidcConfig.token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.oidc.redirect_uri,
        client_id: config.oidc.client_id,
        client_secret: config.oidc.client_secret,
        code_verifier: codeVerifier,
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
    }

    const tokens = (await response.json()) as OidcTokens;

    // Validate required tokens
    if (!tokens.access_token || !tokens.id_token) {
      throw new Error('Token response missing required tokens');
    }

    return tokens;
  } catch (err) {
    logger.error({ err }, 'Failed to exchange code for tokens');
    throw err;
  }
}

/**
 * Verify and decode ID token
 */
export async function verifyIdToken(
  idToken: string,
  nonce?: string
): Promise<IdTokenPayload> {
  if (!jwks) {
    await discoverOidcConfig();
  }

  if (!jwks) {
    throw new Error('JWKS not initialized');
  }

  try {
    // Verify signature, issuer, audience, expiration
    const { payload } = await jwtVerify(idToken, jwks, {
      issuer: config.oidc.issuer,
      audience: config.oidc.client_id,
    });

    // Verify nonce if provided
    if (nonce && payload.nonce !== nonce) {
      throw new Error('Nonce mismatch');
    }

    return payload as IdTokenPayload;
  } catch (err) {
    logger.error({ err }, 'ID token verification failed');
    throw err;
  }
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<OidcTokens> {
  const oidcConfig = await discoverOidcConfig();

  try {
    const response = await fetch(oidcConfig.token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: config.oidc.client_id,
        client_secret: config.oidc.client_secret,
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
    }

    return (await response.json()) as OidcTokens;
  } catch (err) {
    logger.error({ err }, 'Failed to refresh access token');
    throw err;
  }
}

/**
 * Get user info from userinfo endpoint
 */
export async function getUserInfo(accessToken: string): Promise<Record<string, unknown>> {
  const oidcConfig = await discoverOidcConfig();

  try {
    const response = await fetch(oidcConfig.userinfo_endpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`UserInfo request failed: ${response.status}`);
    }

    return (await response.json()) as Record<string, unknown>;
  } catch (err) {
    logger.error({ err }, 'Failed to get user info');
    throw err;
  }
}
