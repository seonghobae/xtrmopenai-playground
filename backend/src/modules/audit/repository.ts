/**
 * Audit logging repository
 * Records all security-relevant actions for compliance and forensics
 */

import { query } from '../../utils/database.js';
import type { AuditLog, RetentionPolicy } from '../../types/index.js';
import { logger } from '../../utils/logger.js';

export interface CreateAuditLogParams {
  org_uuid?: string;
  user_uuid?: string;
  action_name: string;
  target_type?: string;
  target_id?: string;
  result_code: string;
  detail_json?: Record<string, unknown>;
  ip_addr?: string;
  user_agent?: string;
}

/**
 * Create audit log entry
 */
export async function createAuditLog(params: CreateAuditLogParams): Promise<AuditLog | null> {
  try {
    const result = await query<AuditLog>(
      `INSERT INTO app_core.audit_log
       (org_uuid, user_uuid, action_name, target_type, target_id, result_code, detail_json, ip_addr, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        params.org_uuid || null,
        params.user_uuid || null,
        params.action_name,
        params.target_type || null,
        params.target_id || null,
        params.result_code,
        params.detail_json || {},
        params.ip_addr || null,
        params.user_agent || null,
      ]
    );

    if (result.rows.length === 0) {
      throw new Error('Failed to create audit log');
    }

    return result.rows[0];
  } catch (err) {
    // Log but don't throw - audit failures should not break application flow
    logger.error({ err, params }, 'Failed to create audit log');
    return null;
  }
}

/**
 * Get audit logs with pagination and filters
 */
export async function getAuditLogs(params: {
  org_uuid?: string;
  user_uuid?: string;
  action_name?: string;
  target_type?: string;
  result_code?: string;
  start_date?: Date;
  end_date?: Date;
  limit?: number;
  offset?: number;
}): Promise<{ items: AuditLog[]; total: number }> {
  // Build WHERE clause dynamically
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (params.org_uuid) {
    conditions.push(`org_uuid = $${paramIndex++}`);
    values.push(params.org_uuid);
  }

  if (params.user_uuid) {
    conditions.push(`user_uuid = $${paramIndex++}`);
    values.push(params.user_uuid);
  }

  if (params.action_name) {
    conditions.push(`action_name = $${paramIndex++}`);
    values.push(params.action_name);
  }

  if (params.target_type) {
    conditions.push(`target_type = $${paramIndex++}`);
    values.push(params.target_type);
  }

  if (params.result_code) {
    conditions.push(`result_code = $${paramIndex++}`);
    values.push(params.result_code);
  }

  if (params.start_date) {
    conditions.push(`created_at >= $${paramIndex++}`);
    values.push(params.start_date);
  }

  if (params.end_date) {
    conditions.push(`created_at <= $${paramIndex++}`);
    values.push(params.end_date);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total count
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM app_core.audit_log ${whereClause}`,
    values
  );

  const total = parseInt(countResult.rows[0]?.count || '0', 10);

  // Get paginated results
  const limit = params.limit || 50;
  const offset = params.offset || 0;

  const itemsResult = await query<AuditLog>(
    `SELECT * FROM app_core.audit_log
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    [...values, limit, offset]
  );

  return {
    items: itemsResult.rows,
    total,
  };
}

/**
 * Get active retention policy for a target table and optional organization
 */
export async function getRetentionPolicy(
  targetTable: string,
  orgUuid?: string
): Promise<RetentionPolicy | null> {
  const result = await query<RetentionPolicy>(
    `SELECT * FROM app_core.retention_policy
     WHERE target_table = $1
       AND (org_uuid = $2 OR (org_uuid IS NULL AND $2 IS NULL))
       AND is_active = true
     ORDER BY org_uuid NULLS LAST
     LIMIT 1`,
    [targetTable, orgUuid || null]
  );

  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Apply multi-tier retention policy to audit logs
 * Returns statistics on actions taken
 */
export async function applyAuditRetentionPolicy(
  orgUuid?: string
): Promise<{
  deleted: number;
  fullAnonymized: number;
  partialAnonymized: number;
}> {
  const policy = await getRetentionPolicy('audit_log', orgUuid);

  if (!policy) {
    logger.warn({ orgUuid }, 'No retention policy found for audit_log');
    return { deleted: 0, fullAnonymized: 0, partialAnonymized: 0 };
  }

  const stats = {
    deleted: 0,
    fullAnonymized: 0,
    partialAnonymized: 0,
  };

  // Step 1: Delete logs older than deletion_days
  const deleteResult = await query(
    `DELETE FROM app_core.audit_log
     WHERE created_at < NOW() - INTERVAL '1 day' * $1
       AND (org_uuid = $2 OR $2 IS NULL)`,
    [policy.deletion_days, orgUuid || null]
  );
  stats.deleted = deleteResult.rowCount || 0;

  // Step 2: Full anonymization (remove all PII and sensitive details)
  const fullAnonResult = await query(
    `UPDATE app_core.audit_log
     SET ip_addr = NULL,
         user_agent = NULL,
         detail_json = jsonb_set(
           detail_json,
           '{_anonymized}',
           to_jsonb(NOW())
         )
     WHERE created_at < NOW() - INTERVAL '1 day' * $1
       AND created_at >= NOW() - INTERVAL '1 day' * $2
       AND (org_uuid = $3 OR $3 IS NULL)
       AND ip_addr IS NOT NULL`,
    [policy.full_anon_days, policy.deletion_days, orgUuid || null]
  );
  stats.fullAnonymized = fullAnonResult.rowCount || 0;

  // Step 3: Partial anonymization (hash IP, keep user_agent for security analysis)
  const partialAnonResult = await query(
    `UPDATE app_core.audit_log
     SET ip_addr = CASE
         WHEN ip_addr IS NOT NULL THEN
           substring(encode(digest(ip_addr::text || 'salt', 'sha256'), 'hex'), 1, 16)
         ELSE NULL
       END,
         detail_json = jsonb_set(
           detail_json,
           '{_partial_anonymized}',
           to_jsonb(NOW())
         )
     WHERE created_at < NOW() - INTERVAL '1 day' * $1
       AND created_at >= NOW() - INTERVAL '1 day' * $2
       AND (org_uuid = $3 OR $3 IS NULL)
       AND ip_addr IS NOT NULL
       AND NOT (detail_json ? '_partial_anonymized')`,
    [policy.partial_anon_days, policy.full_anon_days, orgUuid || null]
  );
  stats.partialAnonymized = partialAnonResult.rowCount || 0;

  if (stats.deleted > 0 || stats.fullAnonymized > 0 || stats.partialAnonymized > 0) {
    logger.info(
      {
        orgUuid,
        policy: policy.policy_name,
        stats,
      },
      'Applied retention policy to audit logs'
    );
  }

  return stats;
}

/**
 * Create or update retention policy
 * Automatically records changes in retention_policy_history
 */
export async function upsertRetentionPolicy(params: {
  org_uuid?: string;
  policy_name: string;
  target_table: string;
  full_retention_days: number;
  partial_anon_days: number;
  full_anon_days: number;
  deletion_days: number;
  changed_by: string;
  change_reason?: string;
}): Promise<RetentionPolicy> {
  // Check if policy exists
  const existing = await getRetentionPolicy(params.target_table, params.org_uuid);

  let result: RetentionPolicy;

  if (existing) {
    // Update existing policy
    const updateResult = await query<RetentionPolicy>(
      `UPDATE app_core.retention_policy
       SET policy_name = $1,
           full_retention_days = $2,
           partial_anon_days = $3,
           full_anon_days = $4,
           deletion_days = $5,
           updated_at = NOW()
       WHERE policy_uuid = $6
       RETURNING *`,
      [
        params.policy_name,
        params.full_retention_days,
        params.partial_anon_days,
        params.full_anon_days,
        params.deletion_days,
        existing.policy_uuid,
      ]
    );

    result = updateResult.rows[0];

    // Record change in history
    await query(
      `INSERT INTO app_core.retention_policy_history
       (policy_uuid, changed_by, old_values, new_values, change_reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        existing.policy_uuid,
        params.changed_by,
        {
          full_retention_days: existing.full_retention_days,
          partial_anon_days: existing.partial_anon_days,
          full_anon_days: existing.full_anon_days,
          deletion_days: existing.deletion_days,
        },
        {
          full_retention_days: params.full_retention_days,
          partial_anon_days: params.partial_anon_days,
          full_anon_days: params.full_anon_days,
          deletion_days: params.deletion_days,
        },
        params.change_reason || null,
      ]
    );
  } else {
    // Create new policy
    const createResult = await query<RetentionPolicy>(
      `INSERT INTO app_core.retention_policy
       (org_uuid, policy_name, target_table, full_retention_days,
        partial_anon_days, full_anon_days, deletion_days, created_by, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
       RETURNING *`,
      [
        params.org_uuid || null,
        params.policy_name,
        params.target_table,
        params.full_retention_days,
        params.partial_anon_days,
        params.full_anon_days,
        params.deletion_days,
        params.changed_by,
      ]
    );

    result = createResult.rows[0];
  }

  logger.info(
    {
      policy_uuid: result.policy_uuid,
      org_uuid: params.org_uuid,
      target_table: params.target_table,
    },
    'Retention policy upserted'
  );

  return result;
}

/**
 * Delete old audit logs (deprecated - use applyAuditRetentionPolicy instead)
 * @deprecated Use applyAuditRetentionPolicy for multi-tier retention
 */
export async function deleteOldAuditLogs(retentionDays: number): Promise<number> {
  const result = await query(
    `DELETE FROM app_core.audit_log
     WHERE created_at < now() - interval '1 day' * $1`,
    [retentionDays]
  );

  const deletedCount = result.rowCount || 0;

  if (deletedCount > 0) {
    logger.info({ deletedCount, retentionDays }, 'Deleted old audit logs');
  }

  return deletedCount;
}

/**
 * Audit action types (enum for consistency)
 */
export const AuditAction = {
  // Authentication
  LOGIN_SUCCESS: 'auth.login.success',
  LOGIN_FAILURE: 'auth.login.failure',
  LOGOUT: 'auth.logout',
  TOKEN_REFRESH: 'auth.token.refresh',

  // MCP
  MCP_SERVER_CREATE: 'mcp.server.create',
  MCP_SERVER_UPDATE: 'mcp.server.update',
  MCP_SERVER_DELETE: 'mcp.server.delete',
  MCP_TOOL_CALL: 'mcp.tool.call',

  // Responses API
  RESPONSE_RUN: 'response.run',

  // Configuration
  CONFIG_UPDATE: 'config.update',

  // RBAC
  ROLE_ASSIGN: 'rbac.role.assign',
  ROLE_REVOKE: 'rbac.role.revoke',
} as const;

/**
 * Result codes
 */
export const AuditResult = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  DENIED: 'denied',
  ERROR: 'error',
} as const;
