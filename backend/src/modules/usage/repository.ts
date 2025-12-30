/**
 * Usage tracking and cost monitoring repository
 */

import { query } from '../../utils/database.js';

/**
 * Get usage summary for date range
 */
export async function getUsageSummary(params: {
  org_uuid?: string;
  user_uuid?: string;
  start_date: Date;
  end_date: Date;
}): Promise<{
  responses: {
    total_runs: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_cost_usd: number;
  };
  mcp: {
    total_executions: number;
    success_count: number;
    error_count: number;
  };
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

  conditions.push(`created_at >= $${paramIndex++}`);
  values.push(params.start_date);

  conditions.push(`created_at <= $${paramIndex++}`);
  values.push(params.end_date);

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  // Responses summary
  const responsesResult = await query<{
    total_runs: string;
    total_input_tokens: string;
    total_output_tokens: string;
    total_cost_usd: string;
  }>(
    `SELECT
       COUNT(*) as total_runs,
       SUM(COALESCE(token_input, 0)) as total_input_tokens,
       SUM(COALESCE(token_output, 0)) as total_output_tokens,
       SUM(COALESCE(cost_usd, 0)) as total_cost_usd
     FROM app_core.response_run
     ${whereClause}`,
    values
  );

  // MCP summary
  const mcpResult = await query<{
    total_executions: string;
    success_count: string;
    error_count: string;
  }>(
    `SELECT
       COUNT(*) as total_executions,
       COUNT(*) FILTER (WHERE status_text = 'success') as success_count,
       COUNT(*) FILTER (WHERE status_text = 'error') as error_count
     FROM app_core.mcp_execution
     ${whereClause}`,
    values
  );

  const responsesRow = responsesResult.rows[0] || {
    total_runs: '0',
    total_input_tokens: '0',
    total_output_tokens: '0',
    total_cost_usd: '0',
  };

  const mcpRow = mcpResult.rows[0] || {
    total_executions: '0',
    success_count: '0',
    error_count: '0',
  };

  return {
    responses: {
      total_runs: parseInt(responsesRow.total_runs, 10),
      total_input_tokens: parseInt(responsesRow.total_input_tokens, 10),
      total_output_tokens: parseInt(responsesRow.total_output_tokens, 10),
      total_cost_usd: parseFloat(responsesRow.total_cost_usd),
    },
    mcp: {
      total_executions: parseInt(mcpRow.total_executions, 10),
      success_count: parseInt(mcpRow.success_count, 10),
      error_count: parseInt(mcpRow.error_count, 10),
    },
  };
}

/**
 * Get usage by model
 */
export async function getUsageByModel(params: {
  org_uuid?: string;
  start_date: Date;
  end_date: Date;
}): Promise<
  Array<{
    model_name: string;
    runs: number;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
  }>
> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (params.org_uuid) {
    conditions.push(`org_uuid = $${paramIndex++}`);
    values.push(params.org_uuid);
  }

  conditions.push(`created_at >= $${paramIndex++}`);
  values.push(params.start_date);

  conditions.push(`created_at <= $${paramIndex++}`);
  values.push(params.end_date);

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  const result = await query<{
    model_name: string;
    runs: string;
    input_tokens: string;
    output_tokens: string;
    cost_usd: string;
  }>(
    `SELECT
       model_name,
       COUNT(*) as runs,
       SUM(COALESCE(token_input, 0)) as input_tokens,
       SUM(COALESCE(token_output, 0)) as output_tokens,
       SUM(COALESCE(cost_usd, 0)) as cost_usd
     FROM app_core.response_run
     ${whereClause}
     GROUP BY model_name
     ORDER BY cost_usd DESC`,
    values
  );

  return result.rows.map(row => ({
    model_name: row.model_name,
    runs: parseInt(row.runs, 10),
    input_tokens: parseInt(row.input_tokens, 10),
    output_tokens: parseInt(row.output_tokens, 10),
    cost_usd: parseFloat(row.cost_usd),
  }));
}

/**
 * Get daily usage trend
 */
export async function getDailyUsageTrend(params: {
  org_uuid?: string;
  start_date: Date;
  end_date: Date;
  limit?: number;
}): Promise<
  Array<{
    date: string;
    runs: number;
    cost_usd: number;
  }>
> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (params.org_uuid) {
    conditions.push(`org_uuid = $${paramIndex++}`);
    values.push(params.org_uuid);
  }

  conditions.push(`created_at >= $${paramIndex++}`);
  values.push(params.start_date);

  conditions.push(`created_at <= $${paramIndex++}`);
  values.push(params.end_date);

  const whereClause = `WHERE ${conditions.join(' AND ')}`;
  let limitClause = '';

  if (params.limit && params.limit > 0) {
    limitClause = `LIMIT $${paramIndex++}`;
    values.push(params.limit);
  }

  const result = await query<{
    date: string;
    runs: string;
    cost_usd: string;
  }>(
    `SELECT
       DATE(created_at) as date,
       COUNT(*) as runs,
       SUM(COALESCE(cost_usd, 0)) as cost_usd
     FROM app_core.response_run
     ${whereClause}
     GROUP BY DATE(created_at)
     ORDER BY date DESC
     ${limitClause}`,
    values
  );

  return result.rows.map(row => ({
    date: row.date,
    runs: parseInt(row.runs, 10),
    cost_usd: parseFloat(row.cost_usd),
  }));
}
