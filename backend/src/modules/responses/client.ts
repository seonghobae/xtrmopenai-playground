/**
 * OpenAI Responses API client
 * Supports Structured Outputs, Streaming, Tool calls
 */

import { fetch } from 'undici';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import type {
  ResponsesCreateRequest,
  ResponsesCreateResponse,
  ResponsesStreamEvent,
} from '../../types/index.js';

/**
 * Create non-streaming response
 */
export async function createResponse(
  request: ResponsesCreateRequest
): Promise<ResponsesCreateResponse> {
  try {
    const response = await fetch(`${config.openai.base_url}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openai.api_key}`,
      },
      body: JSON.stringify({
        ...request,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as ResponsesCreateResponse;

    logger.info(
      {
        model: request.model,
        usage: data.usage,
      },
      'OpenAI response created'
    );

    return data;
  } catch (err) {
    logger.error({ err, request }, 'Failed to create OpenAI response');
    throw err;
  }
}

/**
 * Parse SSE line
 */
function parseSSELine(line: string): { event?: string; data?: string } | null {
  if (!line.trim()) return null;

  if (line.startsWith('event:')) {
    return { event: line.substring(6).trim() };
  }

  if (line.startsWith('data:')) {
    return { data: line.substring(5).trim() };
  }

  return null;
}

/**
 * Create streaming response
 * Returns async generator for SSE events
 */
export async function* createStreamingResponse(
  request: ResponsesCreateRequest
): AsyncGenerator<ResponsesStreamEvent, void, undefined> {
  try {
    const response = await fetch(`${config.openai.base_url}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openai.api_key}`,
      },
      body: JSON.stringify({
        ...request,
        stream: true,
        stream_options: { include_usage: true },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    // Read stream
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });

      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        const parsed = parseSSELine(line);
        if (!parsed?.data) continue;

        // Handle [DONE] message
        if (parsed.data === '[DONE]') {
          logger.debug('OpenAI stream completed');
          return;
        }

        try {
          const event = JSON.parse(parsed.data) as ResponsesStreamEvent;
          yield event;
        } catch (err) {
          logger.warn({ line }, 'Failed to parse SSE event');
        }
      }
    }
  } catch (err) {
    logger.error({ err, request }, 'Failed to create streaming response');
    throw err;
  }
}

/**
 * Validate JSON Schema (basic validation)
 */
export function validateJsonSchema(schema: unknown): boolean {
  if (typeof schema !== 'object' || schema === null) {
    return false;
  }

  const s = schema as Record<string, unknown>;

  // Must have type
  if (!s.type) {
    return false;
  }

  // If object, must have properties
  if (s.type === 'object' && !s.properties) {
    return false;
  }

  return true;
}

/**
 * Extract token usage from response
 */
export function extractUsage(response: ResponsesCreateResponse): {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
} {
  return (
    response.usage || {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    }
  );
}

/**
 * Extract token usage from stream events
 */
export function extractUsageFromStream(events: ResponsesStreamEvent[]): {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
} | null {
  // Look for usage event at the end
  const usageEvent = events.find(e => (e as any).usage);
  if (usageEvent && (usageEvent as any).usage) {
    return (usageEvent as any).usage;
  }

  return null;
}
