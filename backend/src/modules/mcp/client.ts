/**
 * MCP Client for server-side tool execution
 * Implements security controls: allowlist, timeouts, retries, rate limiting
 */

import { fetch, Response } from 'undici';
import crypto from 'crypto';
import { logger } from '../../utils/logger.js';
import type {
  McpServer,
  McpToolDefinition,
  McpToolsListResponse,
  McpCallRequest,
  McpCallResponse,
} from '../../types/index.js';

const MAX_REQUEST_SIZE_BYTES = 1024 * 1024; // 1MB
const MAX_RESPONSE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * Custom error class for signaling non-retryable errors, such as client errors (HTTP 4xx).
 * 
 * Use this error to indicate that retrying the operation is not appropriate,
 * for example when the error is due to invalid input or other client-side issues.
 */
class NonRetryableError extends Error {
  readonly nonRetryable = true;
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'NonRetryableError';
    this.statusCode = statusCode;
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, NonRetryableError);
    }
  }
}

interface CallMcpToolOptions {
  userApproved: boolean;
  maxRequestSizeBytes?: number;
  maxResponseSizeBytes?: number;
}

function ensureRequestSize(body: string, maxBytes: number): void {
  const byteLength = Buffer.byteLength(body, 'utf8');
  if (byteLength > maxBytes) {
    throw new Error(
      `MCP request exceeds size limit: ${byteLength} bytes > ${maxBytes} bytes`
    );
  }
}

async function readJsonWithLimit<T>(response: Response, maxBytes: number): Promise<T> {
  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (!Number.isNaN(contentLength) && contentLength > maxBytes) {
      throw new Error(
        `MCP response exceeds size limit: ${contentLength} bytes > ${maxBytes} bytes`
      );
    }
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new Error('MCP response exceeds configured size limit');
    }
    return JSON.parse(text) as T;
  }

  const chunks: Buffer[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      received += value.length;
      if (received > maxBytes) {
        reader.releaseLock();
        throw new Error('MCP response exceeds configured size limit');
      }
      chunks.push(Buffer.from(value));
    }
  }

  const payload = Buffer.concat(chunks);
  return JSON.parse(payload.toString('utf8')) as T;
}

/**
 * Validate URL against allowlist
 */
function validateDomain(url: string, allowDomains: string[]): boolean {
  if (allowDomains.length === 0) {
    throw new Error('MCP server allowlist cannot be empty - configure allowed domains');
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
  args: Record<string, unknown>,
  options?: CallMcpToolOptions
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

  if (!options || !options.userApproved) {
    throw new Error('User approval required before invoking MCP tool');
  }

  const maxRequestSize = options.maxRequestSizeBytes ?? MAX_REQUEST_SIZE_BYTES;
  const maxResponseSize = options.maxResponseSizeBytes ?? MAX_RESPONSE_SIZE_BYTES;
  const userApproved = options.userApproved;

  const requestBody = JSON.stringify(request);
  ensureRequestSize(requestBody, maxRequestSize);

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
        body: requestBody,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const isClientError = response.status >= 400 && response.status < 500;
        const errorMessage = isClientError
          ? `MCP tool call failed with client error: ${response.status} ${response.statusText}`
          : `MCP tool call failed: ${response.status} ${response.statusText}`;

        if (isClientError) {
          throw new NonRetryableError(errorMessage, response.status);
        }
        throw new Error(errorMessage);
      }

      const data = await readJsonWithLimit<McpCallResponse>(response, maxResponseSize);

      logger.info(
        {
          mcp_uuid: server.mcp_uuid,
          tool_name: toolName,
          attempt: attempt + 1,
          user_approved: userApproved,
        },
        'MCP tool call succeeded'
      );

      return data;
    } catch (err) {
      lastError = err as Error;

      if (lastError instanceof NonRetryableError) {
        throw lastError;
      }

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
