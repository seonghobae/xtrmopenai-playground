/**
 * Responses API repository
 * Database operations for response runs and streaming events
 */

import { query } from '../../utils/database.js';
import type { ResponseRun, StreamEvent, ModelPrice } from '../../types/index.js';

/**
 * Create response run
 */
export async function createResponseRun(params: {
  org_uuid?: string;
  user_uuid?: string;
  model_name: string;
  request_json: Record<string, unknown>;
  response_json?: Record<string, unknown>;
  token_input?: number;
  token_output?: number;
  cost_usd?: number;
  status_text: 'success' | 'error' | 'partial';
  duration_ms?: number;
  error_text?: string;
}): Promise<ResponseRun> {
  const result = await query<ResponseRun>(
    `INSERT INTO app_core.response_run
     (org_uuid, user_uuid, model_name, request_json, response_json, token_input, token_output, cost_usd, status_text, duration_ms, error_text)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      params.org_uuid || null,
      params.user_uuid || null,
      params.model_name,
      JSON.stringify(params.request_json),
      params.response_json ? JSON.stringify(params.response_json) : null,
      params.token_input || null,
      params.token_output || null,
      params.cost_usd || null,
      params.status_text,
      params.duration_ms || null,
      params.error_text || null,
    ]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to create response run');
  }

  return result.rows[0];
}

/**
 * Get response run by UUID
 */
export async function getResponseRun(runUuid: string): Promise<ResponseRun | null> {
  const result = await query<ResponseRun>(
    `SELECT * FROM app_core.response_run WHERE run_uuid = $1`,
    [runUuid]
  );

  return result.rows[0] || null;
}

/**
 * List response runs with pagination
 */
export async function listResponseRuns(params: {
  org_uuid?: string;
  user_uuid?: string;
  model_name?: string;
  status_text?: string;
  start_date?: Date;
  end_date?: Date;
  limit?: number;
  offset?: number;
}): Promise<{ items: ResponseRun[]; total: number }> {
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

  if (params.model_name) {
    conditions.push(`model_name = $${paramIndex++}`);
    values.push(params.model_name);
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
    `SELECT COUNT(*) as count FROM app_core.response_run ${whereClause}`,
    values
  );

  const total = parseInt(countResult.rows[0]?.count || '0', 10);

  const limit = params.limit || 50;
  const offset = params.offset || 0;

  const itemsResult = await query<ResponseRun>(
    `SELECT * FROM app_core.response_run
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
 * Create stream event
 */
export async function createStreamEvent(
  runUuid: string,
  eventType: string,
  eventJson: Record<string, unknown>,
  sequenceNum: number
): Promise<StreamEvent> {
  const result = await query<StreamEvent>(
    `INSERT INTO app_core.stream_event (run_uuid, event_type, event_json, sequence_num)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [runUuid, eventType, JSON.stringify(eventJson), sequenceNum]
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to create stream event');
  }

  return result.rows[0];
}

/**
 * Get stream events for a run
 */
export async function getStreamEvents(runUuid: string): Promise<StreamEvent[]> {
  const result = await query<StreamEvent>(
    `SELECT * FROM app_core.stream_event
     WHERE run_uuid = $1
     ORDER BY sequence_num ASC`,
    [runUuid]
  );

  return result.rows;
}

/**
 * Get model price
 */
export async function getModelPrice(modelName: string): Promise<ModelPrice | null> {
  const result = await query<ModelPrice>(
    `SELECT * FROM app_core.model_price
     WHERE model_name = $1
     ORDER BY effective_at DESC
     LIMIT 1`,
    [modelName]
  );

  return result.rows[0] || null;
}

/**
 * Calculate cost from tokens
 */
export async function calculateCost(
  modelName: string,
  inputTokens: number,
  outputTokens: number
): Promise<number | null> {
  const price = await getModelPrice(modelName);

  if (!price) {
    return null;
  }

  // Prices are per 1M tokens
  const inputCost = (inputTokens / 1_000_000) * Number(price.input_price);
  const outputCost = (outputTokens / 1_000_000) * Number(price.output_price);

  return inputCost + outputCost;
}

/**
 * Update response run with final data
 */
export async function updateResponseRun(
  runUuid: string,
  updates: {
    response_json?: Record<string, unknown>;
    token_input?: number;
    token_output?: number;
    cost_usd?: number;
    status_text?: 'success' | 'error' | 'partial';
    duration_ms?: number;
    error_text?: string;
  }
): Promise<ResponseRun> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (updates.response_json !== undefined) {
    fields.push(`response_json = $${paramIndex++}`);
    values.push(JSON.stringify(updates.response_json));
  }

  if (updates.token_input !== undefined) {
    fields.push(`token_input = $${paramIndex++}`);
    values.push(updates.token_input);
  }

  if (updates.token_output !== undefined) {
    fields.push(`token_output = $${paramIndex++}`);
    values.push(updates.token_output);
  }

  if (updates.cost_usd !== undefined) {
    fields.push(`cost_usd = $${paramIndex++}`);
    values.push(updates.cost_usd);
  }

  if (updates.status_text !== undefined) {
    fields.push(`status_text = $${paramIndex++}`);
    values.push(updates.status_text);
  }

  if (updates.duration_ms !== undefined) {
    fields.push(`duration_ms = $${paramIndex++}`);
    values.push(updates.duration_ms);
  }

  if (updates.error_text !== undefined) {
    fields.push(`error_text = $${paramIndex++}`);
    values.push(updates.error_text);
  }

  if (fields.length === 0) {
    throw new Error('No fields to update');
  }

  values.push(runUuid);

  const result = await query<ResponseRun>(
    `UPDATE app_core.response_run
     SET ${fields.join(', ')}
     WHERE run_uuid = $${paramIndex}
     RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    throw new Error('Response run not found');
  }

  return result.rows[0];
}

/**
 * Get usage summary for organization
 */
export async function getUsageSummary(params: {
  org_uuid?: string;
  user_uuid?: string;
  start_date?: Date;
  end_date?: Date;
}): Promise<{
  total_runs: number;
  total_tokens: number;
  total_cost_usd: number;
  by_model: Array<{
    model_name: string;
    runs: number;
    tokens: number;
    cost_usd: number;
  }>;
}> {
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

  if (params.start_date) {
    conditions.push(`created_at >= $${paramIndex++}`);
    values.push(params.start_date);
  }

  if (params.end_date) {
    conditions.push(`created_at <= $${paramIndex++}`);
    values.push(params.end_date);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Total summary
  const totalResult = await query<{
    total_runs: string;
    total_tokens: string;
    total_cost_usd: string;
  }>(
    `SELECT
       COUNT(*) as total_runs,
       SUM(COALESCE(token_input, 0) + COALESCE(token_output, 0)) as total_tokens,
       SUM(COALESCE(cost_usd, 0)) as total_cost_usd
     FROM app_core.response_run
     ${whereClause}`,
    values
  );

  // By model breakdown
  const byModelResult = await query<{
    model_name: string;
    runs: string;
    tokens: string;
    cost_usd: string;
  }>(
    `SELECT
       model_name,
       COUNT(*) as runs,
       SUM(COALESCE(token_input, 0) + COALESCE(token_output, 0)) as tokens,
       SUM(COALESCE(cost_usd, 0)) as cost_usd
     FROM app_core.response_run
     ${whereClause}
     GROUP BY model_name
     ORDER BY cost_usd DESC`,
    values
  );

  const totalRow = totalResult.rows[0] || {
    total_runs: '0',
    total_tokens: '0',
    total_cost_usd: '0',
  };

  return {
    total_runs: parseInt(totalRow.total_runs, 10),
    total_tokens: parseInt(totalRow.total_tokens, 10),
    total_cost_usd: parseFloat(totalRow.total_cost_usd),
    by_model: byModelResult.rows.map(row => ({
      model_name: row.model_name,
      runs: parseInt(row.runs, 10),
      tokens: parseInt(row.tokens, 10),
      cost_usd: parseFloat(row.cost_usd),
    })),
  };
}
