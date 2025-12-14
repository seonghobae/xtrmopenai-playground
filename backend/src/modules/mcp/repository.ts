/**
 * MCP test harness repository
 * Database operations for MCP servers, tools, and executions
 */

import { query } from '../../utils/database.js';
import { encrypt, decrypt } from '../../utils/encryption.js';
import type { McpServer, McpTool, McpExecution } from '../../types/index.js';

/**
 * Validate allow_domain is a non-empty array
 */
function validateAllowDomain(allowDomain: string[]): void {
  if (!Array.isArray(allowDomain) || allowDomain.length === 0) {
    throw new Error('allow_domain must be a non-empty array');
  }
}

/**
 * Create MCP server registration
 */
export async function createMcpServer(params: {
  org_uuid: string | null;
  name_text: string;
  base_url: string;
  auth_header?: string;
  allow_domain: string[];
  timeout_ms?: number;
  retry_count?: number;
  meta_json?: Record<string, unknown>;
}): Promise<McpServer> {
  // Validate allow_domain is a non-empty array
  validateAllowDomain(params.allow_domain);

  const result = await query<McpServer>(
    `INSERT INTO app_core.mcp_server
     (org_uuid, name_text, base_url, auth_header, allow_domain, timeout_ms, retry_count, meta_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      params.org_uuid,
      params.name_text,
      params.base_url,
      encrypt(params.auth_header),
      params.allow_domain,
      params.timeout_ms || 30000,
      params.retry_count || 3,
      params.meta_json || {},
    ]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to create MCP server');
  }

  const server = result.rows[0];
  return {
    ...server,
    auth_header: decrypt(server.auth_header),
  };
}

/**
 * Get MCP server by UUID
 */
export async function getMcpServer(mcpUuid: string): Promise<McpServer | null> {
  const result = await query<McpServer>(
    `SELECT * FROM app_core.mcp_server WHERE mcp_uuid = $1`,
    [mcpUuid]
  );

  const server = result.rows[0];
  if (!server) {
    return null;
  }

  return {
    ...server,
    auth_header: decrypt(server.auth_header),
  };
}

/**
 * List MCP servers for organization
 */
export async function listMcpServers(orgUuid: string | null): Promise<McpServer[]> {
  const result = await query<McpServer>(
    `SELECT * FROM app_core.mcp_server
     WHERE org_uuid = $1 OR org_uuid IS NULL
     ORDER BY created_at DESC`,
    [orgUuid]
  );

  return result.rows.map(server => ({
    ...server,
    auth_header: decrypt(server.auth_header),
  }));
}

/**
 * Update MCP server
 */
export async function updateMcpServer(
  mcpUuid: string,
  updates: Partial<Omit<McpServer, 'mcp_uuid' | 'created_at' | 'updated_at'>>
): Promise<McpServer> {
  // Validate allow_domain if provided
  if (updates.allow_domain !== undefined) {
    validateAllowDomain(updates.allow_domain);
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (updates.name_text !== undefined) {
    fields.push(`name_text = $${paramIndex++}`);
    values.push(updates.name_text);
  }

  if (updates.base_url !== undefined) {
    fields.push(`base_url = $${paramIndex++}`);
    values.push(updates.base_url);
  }

  if (updates.auth_header !== undefined) {
    fields.push(`auth_header = $${paramIndex++}`);
    values.push(encrypt(updates.auth_header));
  }

  if (updates.allow_domain !== undefined) {
    fields.push(`allow_domain = $${paramIndex++}`);
    values.push(updates.allow_domain);
  }

  if (updates.timeout_ms !== undefined) {
    fields.push(`timeout_ms = $${paramIndex++}`);
    values.push(updates.timeout_ms);
  }

  if (updates.retry_count !== undefined) {
    fields.push(`retry_count = $${paramIndex++}`);
    values.push(updates.retry_count);
  }

  if (updates.meta_json !== undefined) {
    fields.push(`meta_json = $${paramIndex++}`);
    values.push(updates.meta_json);
  }

  if (fields.length === 0) {
    throw new Error('No fields to update');
  }

  values.push(mcpUuid);

  const result = await query<McpServer>(
    `UPDATE app_core.mcp_server
     SET ${fields.join(', ')}
     WHERE mcp_uuid = $${paramIndex}
     RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    throw new Error('MCP server not found');
  }

  const server = result.rows[0];
  return {
    ...server,
    auth_header: decrypt(server.auth_header),
  };
}

/**
 * Delete MCP server
 */
export async function deleteMcpServer(mcpUuid: string): Promise<void> {
  await query(`DELETE FROM app_core.mcp_server WHERE mcp_uuid = $1`, [mcpUuid]);
}

/**
 * Upsert MCP tool (from tools/list response)
 */
export async function upsertMcpTool(
  mcpUuid: string,
  toolName: string,
  schemaJson: Record<string, unknown>,
  schemaHash: string
): Promise<McpTool> {
  const result = await query<McpTool>(
    `INSERT INTO app_core.mcp_tool (mcp_uuid, tool_name, schema_json, schema_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (mcp_uuid, tool_name) DO UPDATE
     SET schema_json = EXCLUDED.schema_json,
         schema_hash = EXCLUDED.schema_hash,
         updated_at = now()
     RETURNING *`,
    [mcpUuid, toolName, schemaJson, schemaHash]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to upsert MCP tool');
  }

  return result.rows[0];
}

/**
 * Get tools for MCP server
 */
export async function getMcpTools(mcpUuid: string): Promise<McpTool[]> {
  const result = await query<McpTool>(
    `SELECT * FROM app_core.mcp_tool WHERE mcp_uuid = $1 ORDER BY tool_name`,
    [mcpUuid]
  );

  return result.rows;
}

/**
 * Get tool by UUID
 */
export async function getMcpTool(toolUuid: string): Promise<McpTool | null> {
  const result = await query<McpTool>(
    `SELECT * FROM app_core.mcp_tool WHERE tool_uuid = $1`,
    [toolUuid]
  );

  return result.rows[0] || null;
}

/**
 * Create execution log
 */
export async function createMcpExecution(params: {
  tool_uuid?: string;
  org_uuid?: string;
  user_uuid?: string;
  params_json: Record<string, unknown>;
  result_json?: Record<string, unknown>;
  status_text: 'success' | 'error' | 'timeout';
  duration_ms?: number;
  error_text?: string;
}): Promise<McpExecution> {
  const result = await query<McpExecution>(
    `INSERT INTO app_core.mcp_execution
     (tool_uuid, org_uuid, user_uuid, params_json, result_json, status_text, duration_ms, error_text)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      params.tool_uuid || null,
      params.org_uuid || null,
      params.user_uuid || null,
      params.params_json,
      params.result_json || null,
      params.status_text,
      params.duration_ms || null,
      params.error_text || null,
    ]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to create MCP execution');
  }

  return result.rows[0];
}

/**
 * Get execution logs with pagination
 */
export async function getMcpExecutions(params: {
  tool_uuid?: string;
  org_uuid?: string;
  user_uuid?: string;
  status_text?: string;
  start_date?: Date;
  end_date?: Date;
  limit?: number;
  offset?: number;
}): Promise<{ items: McpExecution[]; total: number }> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (params.tool_uuid) {
    conditions.push(`tool_uuid = $${paramIndex++}`);
    values.push(params.tool_uuid);
  }

  if (params.org_uuid) {
    conditions.push(`org_uuid = $${paramIndex++}`);
    values.push(params.org_uuid);
  }

  if (params.user_uuid) {
    conditions.push(`user_uuid = $${paramIndex++}`);
    values.push(params.user_uuid);
  }

  if (params.status_text) {
    conditions.push(`status_text = $${paramIndex++}`);
    values.push(params.status_text);
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

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM app_core.mcp_execution ${whereClause}`,
    values
  );

  const total = parseInt(countResult.rows[0]?.count || '0', 10);

  const limit = params.limit || 50;
  const offset = params.offset || 0;

  const itemsResult = await query<McpExecution>(
    `SELECT * FROM app_core.mcp_execution
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
 * Get execution statistics for a tool
 */
export async function getMcpToolStats(toolUuid: string, hours: number = 24): Promise<{
  total: number;
  success: number;
  error: number;
  timeout: number;
  avg_duration_ms: number;
  p95_duration_ms: number;
}> {
  const result = await query<{
    total: string;
    success: string;
    error: string;
    timeout: string;
    avg_duration_ms: string;
    p95_duration_ms: string;
  }>(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE status_text = 'success') as success,
       COUNT(*) FILTER (WHERE status_text = 'error') as error,
       COUNT(*) FILTER (WHERE status_text = 'timeout') as timeout,
       AVG(duration_ms) as avg_duration_ms,
       PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95_duration_ms
     FROM app_core.mcp_execution
     WHERE tool_uuid = $1 AND created_at >= now() - interval '1 hour' * $2`,
    [toolUuid, hours]
  );

  const row = result.rows[0] || {
    total: '0',
    success: '0',
    error: '0',
    timeout: '0',
    avg_duration_ms: '0',
    p95_duration_ms: '0',
  };

  return {
    total: parseInt(row.total, 10),
    success: parseInt(row.success, 10),
    error: parseInt(row.error, 10),
    timeout: parseInt(row.timeout, 10),
    avg_duration_ms: parseFloat(row.avg_duration_ms) || 0,
    p95_duration_ms: parseFloat(row.p95_duration_ms) || 0,
  };
}
