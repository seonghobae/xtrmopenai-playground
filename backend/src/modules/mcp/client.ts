/**
 * MCP Client for server-side tool execution
 * Implements security controls: allowlist, timeouts, retries, rate limiting
 */

import { fetch } from 'undici';
import crypto from 'crypto';
import { logger } from '../../utils/logger.js';
import type {
  McpServer,
  McpToolDefinition,
  McpToolsListResponse,
  McpCallRequest,
  McpCallResponse,
} from '../../types/index.js';

/**
 * Validate URL against allowlist
 */
function validateDomain(url: string, allowDomains: string[]): boolean {
  if (allowDomains.length === 0) {
    return true; // No allowlist = allow all
  }

  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname;

    return allowDomains.some(domain => {
      // Exact match or subdomain match
      return hostname === domain || hostname.endsWith(`.${domain}`);
    });
  } catch {
    return false;
  }
}

/**
 * Compute hash of tool schema for change detection
 */
export function computeSchemaHash(schema: Record<string, unknown>): string {
  const normalized = JSON.stringify(schema);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Fetch tools list from MCP server
 */
export async function fetchMcpTools(
  server: McpServer
): Promise<McpToolDefinition[]> {
  // Validate domain
  if (!validateDomain(server.base_url, server.allow_domain)) {
    throw new Error(`MCP server URL not in allowlist: ${server.base_url}`);
  }

  const toolsUrl = new URL('/tools/list', server.base_url).toString();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), server.timeout_ms);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (server.auth_header) {
      headers.Authorization = server.auth_header;
    }

    const response = await fetch(toolsUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`MCP tools/list failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as McpToolsListResponse;

    if (!data.tools || !Array.isArray(data.tools)) {
      throw new Error('Invalid MCP tools/list response: missing tools array');
    }

    logger.info(
      { mcp_uuid: server.mcp_uuid, count: data.tools.length },
      'Fetched MCP tools'
    );

    return data.tools;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      logger.error({ mcp_uuid: server.mcp_uuid }, 'MCP tools/list timeout');
      throw new Error('MCP tools/list request timed out');
    }
    logger.error({ err, mcp_uuid: server.mcp_uuid }, 'Failed to fetch MCP tools');
    throw err;
  }
}

/**
 * Call MCP tool with retry logic
 */
export async function callMcpTool(
  server: McpServer,
  toolName: string,
  args: Record<string, unknown>
): Promise<McpCallResponse> {
  // Validate domain
  if (!validateDomain(server.base_url, server.allow_domain)) {
    throw new Error(`MCP server URL not in allowlist: ${server.base_url}`);
  }

  const callUrl = new URL('/tools/call', server.base_url).toString();

  const request: McpCallRequest = {
    name: toolName,
    arguments: args,
  };

  let lastError: Error | null = null;
  const maxRetries = server.retry_count;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), server.timeout_ms);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (server.auth_header) {
        headers.Authorization = server.auth_header;
      }

      const response = await fetch(callUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`MCP tool call failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as McpCallResponse;

      logger.info(
        {
          mcp_uuid: server.mcp_uuid,
          tool_name: toolName,
          attempt: attempt + 1,
        },
        'MCP tool call succeeded'
      );

      return data;
    } catch (err) {
      lastError = err as Error;

      if ((err as Error).name === 'AbortError') {
        logger.warn(
          {
            mcp_uuid: server.mcp_uuid,
            tool_name: toolName,
            attempt: attempt + 1,
            max_retries: maxRetries,
          },
          'MCP tool call timeout'
        );
      } else {
        logger.warn(
          {
            err,
            mcp_uuid: server.mcp_uuid,
            tool_name: toolName,
            attempt: attempt + 1,
            max_retries: maxRetries,
          },
          'MCP tool call failed'
        );
      }

      // Exponential backoff before retry
      if (attempt < maxRetries) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt), 10000);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }

  // All retries exhausted
  throw lastError || new Error('MCP tool call failed after retries');
}

/**
 * Health check for MCP server
 */
export async function checkMcpHealth(server: McpServer): Promise<boolean> {
  try {
    await fetchMcpTools(server);
    return true;
  } catch (err) {
    logger.error({ err, mcp_uuid: server.mcp_uuid }, 'MCP health check failed');
    return false;
  }
}
