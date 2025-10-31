/**
 * Audit logging repository
 * Records all security-relevant actions for compliance and forensics
 */

import { query } from '../../utils/database.js';
import type { AuditLog } from '../../types/index.js';
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
        JSON.stringify(params.detail_json || {}),
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
 * Delete old audit logs (retention policy)
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
