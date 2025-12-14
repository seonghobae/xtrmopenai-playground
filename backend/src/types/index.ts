/**
 * Type definitions for OpenAI Playground App
 * All database entities follow two-word snake_case naming convention
 */

// Database entities
export interface OrgUnit {
  org_uuid: string;
  org_key: string;
  name_text: string;
  created_at: Date;
  updated_at: Date;
}

export interface UserAccount {
  user_uuid: string;
  sub_text: string;
  email_text: string | null;
  name_text: string | null;
  meta_json: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface OrgMember {
  org_uuid: string;
  user_uuid: string;
  role_list: string[];
  created_at: Date;
  updated_at: Date;
}

export interface McpServer {
  mcp_uuid: string;
  org_uuid: string | null;
  name_text: string;
  base_url: string;
  auth_header: string | null;
  allow_domain: string[];
  timeout_ms: number;
  retry_count: number;
  meta_json: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface McpTool {
  tool_uuid: string;
  mcp_uuid: string;
  tool_name: string;
  schema_json: Record<string, unknown>;
  schema_hash: string;
  created_at: Date;
  updated_at: Date;
}

export interface McpExecution {
  exec_uuid: string;
  tool_uuid: string | null;
  org_uuid: string | null;
  user_uuid: string | null;
  params_json: Record<string, unknown>;
  result_json: Record<string, unknown> | null;
  status_text: 'success' | 'error' | 'timeout';
  duration_ms: number | null;
  error_text: string | null;
  created_at: Date;
}

export interface ResponseRun {
  run_uuid: string;
  org_uuid: string | null;
  user_uuid: string | null;
  model_name: string;
  request_json: Record<string, unknown>;
  response_json: Record<string, unknown> | null;
  token_input: number | null;
  token_output: number | null;
  cost_usd: number | null;
  status_text: 'success' | 'error' | 'partial';
  duration_ms: number | null;
  error_text: string | null;
  created_at: Date;
}

export interface StreamEvent {
  event_uuid: string;
  run_uuid: string;
  event_type: string;
  event_json: Record<string, unknown>;
  sequence_num: number;
  created_at: Date;
}

export interface AuditLog {
  log_uuid: string;
  org_uuid: string | null;
  user_uuid: string | null;
  action_name: string;
  target_type: string | null;
  target_id: string | null;
  result_code: string;
  detail_json: Record<string, unknown>;
  ip_addr: string | null;
  user_agent: string | null;
  created_at: Date;
}

export interface ModelPrice {
  price_uuid: string;
  model_name: string;
  input_price: number;
  output_price: number;
  effective_at: Date;
  created_at: Date;
}

export interface UserSession {
  session_uuid: string;
  user_uuid: string;
  session_key: string;
  token_json: Record<string, unknown>;
  expires_at: Date;
  created_at: Date;
  last_used: Date;
}

export interface RetentionPolicy {
  policy_uuid: string;
  org_uuid: string | null;
  policy_name: string;
  target_table: string;
  full_retention_days: number;
  partial_anon_days: number;
  full_anon_days: number;
  deletion_days: number;
  is_active: boolean;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface RetentionPolicyHistory {
  history_uuid: string;
  policy_uuid: string;
  changed_by: string;
  old_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
  change_reason: string | null;
  created_at: Date;
}

// OIDC types
export interface OidcConfig {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  response_types_supported: string[];
  subject_types_supported: string[];
  id_token_signing_alg_values_supported: string[];
}

export interface OidcTokens {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
}

export interface IdTokenPayload {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  nonce?: string;
  email?: string;
  name?: string;
  groups?: string[];
  roles?: string[];
}

// MCP Protocol types
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpToolsListResponse {
  tools: McpToolDefinition[];
}

export interface McpCallRequest {
  name: string;
  arguments: Record<string, unknown>;
}

export interface McpCallResponse {
  content: Array<{
    type: string;
    text?: string;
    data?: unknown;
  }>;
  isError?: boolean;
}

// OpenAI Responses API types
export interface ResponsesCreateRequest {
  model: string;
  messages?: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  modalities?: string[];
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
      strict?: boolean;
    };
  }>;
  response_format?: {
    type: 'json_schema';
    json_schema: {
      name: string;
      description?: string;
      schema: Record<string, unknown>;
      strict?: boolean;
    };
  };
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface ResponsesStreamEvent {
  type: string;
  delta?: {
    type?: string;
    text?: string;
    audio?: unknown;
  };
  output_index?: number;
  content_index?: number;
  tool_call_id?: string;
  name?: string;
  arguments?: string;
}

export interface ResponsesCreateResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices?: Array<{
    index: number;
    message: {
      role: string;
      content: string;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Authentication types
export interface AuthenticatedUser {
  user_uuid: string;
  sub_text: string;
  email_text: string | null;
  name_text: string | null;
  organizations: Array<{
    org_uuid: string;
    org_key: string;
    role_list: string[];
  }>;
}

// Request context
export interface RequestContext {
  user: AuthenticatedUser;
  session_uuid: string;
  ip_addr: string;
  user_agent: string;
}

// API Response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

// Configuration types
export interface AppConfig {
  server: {
    host: string;
    port: number;
    cors_origin: string[];
    default_origin: string;
  };
  database: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    max_connections: number;
    ssl?: {
      rejectUnauthorized: boolean;
      ca?: string;
      cert?: string;
      key?: string;
    };
  };
  oidc: {
    issuer: string;
    client_id: string;
    client_secret: string;
    redirect_uri: string;
    scope: string;
  };
  openai: {
    api_key: string;
    base_url: string;
  };
  security: {
    session_secret: string;
    session_ttl_seconds: number;
    session_inactivity_seconds: number;
    rate_limit_max: number;
    rate_limit_window_ms: number;
    audit_ip_hash_salt: string;
  };
  encryption: {
    key: string;
  };
}
