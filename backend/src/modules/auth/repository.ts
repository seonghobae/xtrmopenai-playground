/**
 * Authentication repository for database operations
 * All queries use parameterized statements to prevent SQL injection
 */

import { query } from '../../utils/database.js';
import { config } from '../../config/index.js';
import type {
  UserAccount,
  UserSession,
  AuthenticatedUser,
} from '../../types/index.js';
import { logger } from '../../utils/logger.js';

/**
 * Find or create user account from OIDC claims
 */
export async function upsertUserAccount(
  subText: string,
  emailText: string | null,
  nameText: string | null,
  metaJson: Record<string, unknown> = {}
): Promise<UserAccount> {
  const result = await query<UserAccount>(
    `INSERT INTO app_core.user_account (sub_text, email_text, name_text, meta_json)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (sub_text) DO UPDATE
     SET email_text = EXCLUDED.email_text,
         name_text = EXCLUDED.name_text,
         meta_json = EXCLUDED.meta_json,
         updated_at = now()
     RETURNING *`,
    [subText, emailText, nameText, metaJson]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to upsert user account');
  }

  return result.rows[0];
}

/**
 * Get user by UUID
 */
export async function getUserByUuid(userUuid: string): Promise<UserAccount | null> {
  const result = await query<UserAccount>(
    `SELECT * FROM app_core.user_account WHERE user_uuid = $1`,
    [userUuid]
  );

  return result.rows[0] || null;
}

/**
 * Get user by OIDC subject
 */
export async function getUserBySub(subText: string): Promise<UserAccount | null> {
  const result = await query<UserAccount>(
    `SELECT * FROM app_core.user_account WHERE sub_text = $1`,
    [subText]
  );

  return result.rows[0] || null;
}

/**
 * Get user's organization memberships
 */
export async function getUserOrganizations(userUuid: string): Promise<
  Array<{
    org_uuid: string;
    org_key: string;
    name_text: string;
    role_list: string[];
  }>
> {
  const result = await query<{
    org_uuid: string;
    org_key: string;
    name_text: string;
    role_list: string[];
  }>(
    `SELECT o.org_uuid, o.org_key, o.name_text, om.role_list
     FROM app_core.org_member om
     JOIN app_core.org_unit o ON om.org_uuid = o.org_uuid
     WHERE om.user_uuid = $1`,
    [userUuid]
  );

  return result.rows;
}

/**
 * Build authenticated user object with organizations
 */
export async function buildAuthenticatedUser(
  userAccount: UserAccount
): Promise<AuthenticatedUser> {
  const organizations = await getUserOrganizations(userAccount.user_uuid);

  return {
    user_uuid: userAccount.user_uuid,
    sub_text: userAccount.sub_text,
    email_text: userAccount.email_text,
    name_text: userAccount.name_text,
    organizations: organizations.map(org => ({
      org_uuid: org.org_uuid,
      org_key: org.org_key,
      role_list: org.role_list,
    })),
  };
}

/**
 * Create session
 */
export async function createSession(
  userUuid: string,
  sessionKey: string,
  tokenJson: Record<string, unknown>,
  expiresAt: Date
): Promise<UserSession> {
  const result = await query<UserSession>(
    `INSERT INTO app_core.user_session (user_uuid, session_key, token_json, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [userUuid, sessionKey, tokenJson, expiresAt]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to create session');
  }

  return result.rows[0];
}

/**
 * Get session by key with real-time inactivity enforcement
 * 
 * Security: This function enforces BOTH absolute TTL (expires_at) AND inactivity timeout
 * (last_used) directly in the WHERE clause at every request, not just during cleanup.
 * This ensures expired sessions are rejected immediately, meeting AAL2 requirements.
 * 
 * The WHERE conditions:
 * - expires_at > now() : Absolute session TTL check (SESSION_TTL_SECONDS)
 * - last_used >= $2   : Inactivity timeout check (SESSION_INACTIVITY_SECONDS)
 * 
 * Scheduled cleanup (deleteExpiredSessions) removes stale records from DB but is NOT
 * relied upon for security - sessions are validated fresh on every authenticated request.
 */
export async function getSessionByKey(sessionKey: string): Promise<UserSession | null> {
  const inactivityCutoff = new Date(
    Date.now() - config.security.session_inactivity_seconds * 1000
  );

  const result = await query<UserSession>(
    `SELECT * FROM app_core.user_session
     WHERE session_key = $1
       AND expires_at > now()
       AND last_used >= $2`,
    [sessionKey, inactivityCutoff]
  );

  return result.rows[0] || null;
}

/**
 * Update session last used timestamp
 */
export async function updateSessionLastUsed(sessionUuid: string): Promise<void> {
  await query(
    `UPDATE app_core.user_session
     SET last_used = now()
     WHERE session_uuid = $1`,
    [sessionUuid]
  );
}

/**
 * Delete session (logout)
 */
export async function deleteSession(sessionKey: string): Promise<void> {
  await query(
    `DELETE FROM app_core.user_session WHERE session_key = $1`,
    [sessionKey]
  );
}

/**
 * Delete expired sessions (cleanup job)
 */
export async function deleteExpiredSessions(): Promise<number> {
  const result = await query(
    `DELETE FROM app_core.user_session
     WHERE expires_at <= now()
        OR last_used < now() - ($1::int * INTERVAL '1 second')`,
    [config.security.session_inactivity_seconds]
  );

  const deletedCount = result.rowCount || 0;

  if (deletedCount > 0) {
    logger.info({ deletedCount }, 'Deleted expired sessions');
  }

  return deletedCount;
}

/**
 * Check if user has role in organization
 */
export async function hasRole(
  userUuid: string,
  orgUuid: string,
  role: string
): Promise<boolean> {
  const result = await query<{ has_role: boolean }>(
    `SELECT $3 = ANY(role_list) as has_role
     FROM app_core.org_member
     WHERE user_uuid = $1 AND org_uuid = $2`,
    [userUuid, orgUuid, role]
  );

  return result.rows[0]?.has_role || false;
}

/**
 * Check if user is member of organization
 */
export async function isMemberOf(
  userUuid: string,
  orgUuid: string
): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM app_core.org_member
       WHERE user_uuid = $1 AND org_uuid = $2
     ) as exists`,
    [userUuid, orgUuid]
  );

  return result.rows[0]?.exists || false;
}
