-- OpenAI Playground App Database Schema
-- All objects follow strict two-word snake_case naming convention
-- UUID primary keys with gen_random_uuid()
-- TIMESTAMP WITH TIME ZONE for all temporal data
-- jsonb for semi-structured data

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Main application schema
CREATE SCHEMA IF NOT EXISTS app_core;

-- Organization/tenant table
CREATE TABLE app_core.org_unit (
  org_uuid   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_key    TEXT UNIQUE NOT NULL,
  name_text  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User accounts table
CREATE TABLE app_core.user_account (
  user_uuid  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_text   TEXT UNIQUE NOT NULL, -- OIDC subject identifier
  email_text TEXT,
  name_text  TEXT,
  meta_json  JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Organization membership with roles
CREATE TABLE app_core.org_member (
  org_uuid   UUID NOT NULL REFERENCES app_core.org_unit(org_uuid) ON DELETE CASCADE,
  user_uuid  UUID NOT NULL REFERENCES app_core.user_account(user_uuid) ON DELETE CASCADE,
  role_list  TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT om_pkey PRIMARY KEY (org_uuid, user_uuid)
);

-- MCP server registrations
CREATE TABLE app_core.mcp_server (
  mcp_uuid     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_uuid     UUID REFERENCES app_core.org_unit(org_uuid) ON DELETE CASCADE,
  name_text    TEXT NOT NULL,
  base_url     TEXT NOT NULL,
  auth_header  TEXT, -- Encrypted or reference to secrets vault
  -- No DEFAULT clause: allow_domain must be explicitly provided at creation time due to the CHECK constraint requiring non-empty arrays.
  allow_domain TEXT[] NOT NULL,
  timeout_ms   INT NOT NULL DEFAULT 30000,
  retry_count  INT NOT NULL DEFAULT 3,
  meta_json    JSONB DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mcp_unique UNIQUE (org_uuid, name_text),
  CONSTRAINT mcp_allow_domain_not_empty CHECK (array_length(allow_domain, 1) > 0)
);

-- MCP tool catalog (cached from tools/list)
CREATE TABLE app_core.mcp_tool (
  tool_uuid    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mcp_uuid     UUID NOT NULL REFERENCES app_core.mcp_server(mcp_uuid) ON DELETE CASCADE,
  tool_name    TEXT NOT NULL,
  schema_json  JSONB NOT NULL,
  schema_hash  TEXT NOT NULL, -- For change detection
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tool_unique UNIQUE (mcp_uuid, tool_name)
);

-- MCP tool execution logs
CREATE TABLE app_core.mcp_execution (
  exec_uuid     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_uuid     UUID REFERENCES app_core.mcp_tool(tool_uuid) ON DELETE SET NULL,
  org_uuid      UUID REFERENCES app_core.org_unit(org_uuid) ON DELETE SET NULL,
  user_uuid     UUID REFERENCES app_core.user_account(user_uuid) ON DELETE SET NULL,
  params_json   JSONB NOT NULL,
  result_json   JSONB,
  status_text   TEXT NOT NULL CHECK (status_text IN ('success', 'error', 'timeout')),
  duration_ms   INT,
  error_text    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- OpenAI Responses API execution runs
CREATE TABLE app_core.response_run (
  run_uuid      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_uuid      UUID REFERENCES app_core.org_unit(org_uuid) ON DELETE SET NULL,
  user_uuid     UUID REFERENCES app_core.user_account(user_uuid) ON DELETE SET NULL,
  model_name    TEXT NOT NULL,
  request_json  JSONB NOT NULL,
  response_json JSONB,
  token_input   INT,
  token_output  INT,
  cost_usd      NUMERIC(12,6),
  status_text   TEXT NOT NULL CHECK (status_text IN ('success', 'error', 'partial')),
  duration_ms   INT,
  error_text    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Streaming events for Responses API (timeline visualization)
CREATE TABLE app_core.stream_event (
  event_uuid    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_uuid      UUID NOT NULL REFERENCES app_core.response_run(run_uuid) ON DELETE CASCADE,
  event_type    TEXT NOT NULL CHECK (event_type IN ('output_text.delta', 'tool_call.start', 'tool_call.complete')), -- Valid event types for streaming
  event_json    JSONB NOT NULL,
  sequence_num  INT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT event_unique UNIQUE (run_uuid, sequence_num)
);

-- Audit log for all security-relevant actions
CREATE TABLE app_core.audit_log (
  log_uuid    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_uuid    UUID,
  user_uuid   UUID,
  action_name TEXT NOT NULL,
  target_type TEXT, -- 'mcp_server', 'response_run', 'config', etc.
  target_id   TEXT,
  result_code TEXT NOT NULL, -- 'success', 'failure', 'denied'
  detail_json JSONB DEFAULT '{}'::jsonb,
  ip_addr     INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Model pricing table (for cost calculation)
CREATE TABLE app_core.model_price (
  price_uuid    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name    TEXT UNIQUE NOT NULL,
  input_price   NUMERIC(12,6) NOT NULL, -- Per 1M tokens
  output_price  NUMERIC(12,6) NOT NULL, -- Per 1M tokens
  effective_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Session storage (for OIDC sessions)
CREATE TABLE app_core.user_session (
  session_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_uuid    UUID NOT NULL REFERENCES app_core.user_account(user_uuid) ON DELETE CASCADE,
  session_key  TEXT UNIQUE NOT NULL,
  token_json   JSONB NOT NULL, -- id_token, access_token, refresh_token
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX org_member_user_idx ON app_core.org_member(user_uuid);
CREATE INDEX mcp_server_org_idx ON app_core.mcp_server(org_uuid);
CREATE INDEX mcp_tool_server_idx ON app_core.mcp_tool(mcp_uuid);
CREATE INDEX mcp_execution_org_idx ON app_core.mcp_execution(org_uuid);
CREATE INDEX mcp_execution_user_idx ON app_core.mcp_execution(user_uuid);
CREATE INDEX mcp_execution_created_idx ON app_core.mcp_execution(created_at DESC);

-- response_run indexes: Optimized to avoid redundancy
-- Composite indexes can serve single-column queries on leftmost columns (PostgreSQL B-tree index property)
-- Partial indexes exclude NULL values to reduce index size
-- Monitor index usage in production:
--   SELECT * FROM pg_stat_user_indexes WHERE schemaname = 'app_core' AND relname = 'response_run';
CREATE INDEX response_run_created_idx ON app_core.response_run(created_at DESC); -- Time-based queries without org/user filters
CREATE INDEX idx_response_run_org_created ON app_core.response_run(org_uuid, created_at) WHERE org_uuid IS NOT NULL;
CREATE INDEX idx_response_run_user_created ON app_core.response_run(user_uuid, created_at) WHERE user_uuid IS NOT NULL;
CREATE INDEX idx_response_run_org_model_created ON app_core.response_run(org_uuid, model_name, created_at) WHERE org_uuid IS NOT NULL;

CREATE INDEX stream_event_run_idx ON app_core.stream_event(run_uuid, sequence_num);
CREATE INDEX audit_log_org_idx ON app_core.audit_log(org_uuid);
CREATE INDEX audit_log_user_idx ON app_core.audit_log(user_uuid);
CREATE INDEX audit_log_created_idx ON app_core.audit_log(created_at DESC);
CREATE INDEX user_session_user_idx ON app_core.user_session(user_uuid);
CREATE INDEX user_session_expires_idx ON app_core.user_session(expires_at);
CREATE INDEX idx_mcp_execution_org_created ON app_core.mcp_execution(org_uuid, created_at) WHERE org_uuid IS NOT NULL;
CREATE INDEX idx_mcp_execution_user_created ON app_core.mcp_execution(user_uuid, created_at) WHERE user_uuid IS NOT NULL;

-- Insert default model prices (example values, update with actual OpenAI pricing)
INSERT INTO app_core.model_price (model_name, input_price, output_price) VALUES
  ('gpt-4o', 2.50, 10.00),
  ('gpt-4o-mini', 0.15, 0.60),
  ('gpt-4-turbo', 10.00, 30.00),
  ('gpt-3.5-turbo', 0.50, 1.50)
ON CONFLICT (model_name) DO NOTHING;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION app_core.update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER org_unit_updated BEFORE UPDATE ON app_core.org_unit
  FOR EACH ROW EXECUTE FUNCTION app_core.update_timestamp();

CREATE TRIGGER user_account_updated BEFORE UPDATE ON app_core.user_account
  FOR EACH ROW EXECUTE FUNCTION app_core.update_timestamp();

CREATE TRIGGER org_member_updated BEFORE UPDATE ON app_core.org_member
  FOR EACH ROW EXECUTE FUNCTION app_core.update_timestamp();

CREATE TRIGGER mcp_server_updated BEFORE UPDATE ON app_core.mcp_server
  FOR EACH ROW EXECUTE FUNCTION app_core.update_timestamp();

CREATE TRIGGER mcp_tool_updated BEFORE UPDATE ON app_core.mcp_tool
  FOR EACH ROW EXECUTE FUNCTION app_core.update_timestamp();

-- Retention policy configuration (database-stored instead of environment variables)
CREATE TABLE app_core.retention_policy (
  policy_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_uuid UUID REFERENCES app_core.org_unit(org_uuid) ON DELETE CASCADE,
  -- NULL org_uuid = system default policy
  
  policy_name TEXT NOT NULL,
  target_table TEXT NOT NULL, -- 'audit_log', 'response_run', 'mcp_execution', etc.
  
  -- Multi-tier retention periods (days)
  full_retention_days INT NOT NULL DEFAULT 180,     -- Complete data retention (6 months)
  partial_anon_days INT NOT NULL DEFAULT 365,       -- Partial anonymization (1 year)
  full_anon_days INT NOT NULL DEFAULT 1095,         -- Full anonymization (3 years)
  deletion_days INT NOT NULL DEFAULT 1825,          -- Complete deletion (5 years)
  
  -- Metadata
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES app_core.user_account(user_uuid),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT retention_policy_order CHECK (
    full_retention_days <= partial_anon_days AND
    partial_anon_days <= full_anon_days AND
    full_anon_days <= deletion_days
  )
);

-- Only one active policy per org+table combination
CREATE UNIQUE INDEX retention_policy_org_table_active 
  ON app_core.retention_policy(org_uuid, target_table, is_active)
  WHERE is_active = true;

-- System default policies (org_uuid = NULL)
CREATE UNIQUE INDEX retention_policy_system_default
  ON app_core.retention_policy(target_table, is_active)
  WHERE org_uuid IS NULL AND is_active = true;

-- Retention policy change audit trail
CREATE TABLE app_core.retention_policy_history (
  history_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_uuid UUID NOT NULL REFERENCES app_core.retention_policy(policy_uuid),
  changed_by UUID NOT NULL REFERENCES app_core.user_account(user_uuid),
  old_values JSONB NOT NULL,
  new_values JSONB NOT NULL,
  change_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insert system default retention policy for audit_log (conservative values)
INSERT INTO app_core.retention_policy (
  org_uuid, 
  policy_name, 
  target_table,
  full_retention_days,
  partial_anon_days,
  full_anon_days,
  deletion_days,
  is_active
) VALUES (
  NULL,
  'System Default - Audit Log',
  'audit_log',
  180,   -- 6 months full retention
  365,   -- 1 year partial anonymization (PCI DSS)
  1095,  -- 3 years full anonymization (SOC 2)
  1825,  -- 5 years deletion (financial regulations)
  true
);

-- Indexes for retention policy
CREATE INDEX retention_policy_org_idx ON app_core.retention_policy(org_uuid);
CREATE INDEX retention_policy_target_idx ON app_core.retention_policy(target_table);
CREATE INDEX retention_policy_history_policy_idx ON app_core.retention_policy_history(policy_uuid);
CREATE INDEX retention_policy_history_created_idx ON app_core.retention_policy_history(created_at DESC);

-- Trigger for retention_policy updated_at
CREATE TRIGGER retention_policy_updated BEFORE UPDATE ON app_core.retention_policy
  FOR EACH ROW EXECUTE FUNCTION app_core.update_timestamp();

-- Comments for documentation
COMMENT ON SCHEMA app_core IS 'Main application schema - all objects use two-word snake_case naming';
COMMENT ON TABLE app_core.org_unit IS 'Organizations/tenants for multi-tenancy';
COMMENT ON TABLE app_core.user_account IS 'User accounts synchronized from Casdoor OIDC';
COMMENT ON TABLE app_core.org_member IS 'Organization membership with RBAC roles';
COMMENT ON TABLE app_core.mcp_server IS 'Registered MCP servers for tool execution';
COMMENT ON TABLE app_core.mcp_tool IS 'Cached MCP tool catalog from tools/list';
COMMENT ON TABLE app_core.mcp_execution IS 'MCP tool execution logs with performance metrics';
COMMENT ON TABLE app_core.response_run IS 'OpenAI Responses API execution runs';
COMMENT ON TABLE app_core.stream_event IS 'Streaming events for timeline visualization';
COMMENT ON TABLE app_core.audit_log IS 'Security audit log for all actions';
COMMENT ON TABLE app_core.model_price IS 'Model pricing for cost calculation';
COMMENT ON TABLE app_core.user_session IS 'OIDC session storage';
COMMENT ON TABLE app_core.retention_policy IS 'Database-stored retention policies for multi-tier data lifecycle management';
COMMENT ON TABLE app_core.retention_policy_history IS 'Audit trail for retention policy changes';
