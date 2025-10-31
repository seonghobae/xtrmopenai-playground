# Architecture Documentation

## Overview

OpenAI Playground App is a comprehensive testing platform for:
1. **MCP (Model Context Protocol)** test harness
2. **OpenAI Responses API** testing with Structured Outputs and Streaming
3. **Casdoor OIDC** authentication with RBAC and MFA
4. **Audit logging and cost monitoring**

## Technology Stack

### Backend
- **Runtime**: Node.js 20+ with TypeScript
- **Framework**: Fastify (high-performance HTTP server)
- **Database**: PostgreSQL 14+ with pgcrypto extension
- **HTTP Client**: undici (for OpenAI API and MCP servers)
- **Authentication**: Casdoor OIDC with JWKS validation
- **Logging**: Pino (structured logging with PII masking)
- **Validation**: Zod (schema validation)

### Frontend
- **Framework**: React 18+ with TypeScript
- **Build Tool**: Vite
- **State Management**: Zustand
- **Data Fetching**: TanStack Query (React Query)
- **Routing**: React Router

### Database Schema
All database objects follow **strict two-word snake_case naming convention**:
- Tables: `org_unit`, `user_account`, `mcp_server`, etc.
- Columns: `org_uuid`, `name_text`, `created_at`, etc.
- Primary keys: UUID with `gen_random_uuid()`
- Timestamps: `TIMESTAMPTZ` (timestamp with time zone)
- Semi-structured data: `jsonb`

## Security Architecture

### Authentication Flow (OIDC + PKCE)
```
1. User → /api/auth/login
2. Generate state, nonce, PKCE (code_verifier, code_challenge)
3. Redirect to Casdoor authorization endpoint
4. User authenticates with Casdoor (supports WebAuthn/TOTP MFA)
5. Casdoor → /api/auth/callback?code=...&state=...
6. Verify state, exchange code + code_verifier for tokens
7. Verify ID token signature with JWKS
8. Create/update user account
9. Create session with secure cookie
10. Redirect to dashboard
```

### Authorization (RBAC)
- Organizations (tenants) in `org_unit` table
- Users belong to organizations via `org_member` with `role_list`
- Middleware checks roles before allowing access to resources
- Audit log records all authorization decisions

### Security Controls
1. **Helmet**: Security headers (CSP, HSTS, etc.)
2. **Rate Limiting**: Global and per-route limits
3. **Input Validation**: Zod schemas on all endpoints
4. **Parameterized Queries**: All database queries use bound parameters
5. **Secure Sessions**: HTTP-only, secure, SameSite cookies
6. **PII Masking**: Structured logs redact sensitive fields
7. **TLS 1.3**: Recommended for production
8. **HTTP/2 or HTTP/3**: Multiplexing and low latency

## MCP Test Harness

### Architecture
```
Frontend → Backend API → MCP Bridge (server-side proxy) → External MCP Server
```

### Security
- **Server-side proxy**: Browser never calls MCP servers directly
- **Domain allowlist**: Only approved domains can be contacted
- **Timeouts**: Configurable per-server
- **Retries**: Exponential backoff on failures
- **Rate limiting**: Prevents abuse
- **Schema validation**: Validates tool definitions and responses

### Features
1. **Server Registration**: Store MCP server URLs with auth headers
2. **Tool Catalog Sync**: Fetch and cache `tools/list` response
3. **Tool Invocation**: Call tools with parameter validation
4. **Performance Metrics**: Success rate, p95 latency, timeouts
5. **Change Detection**: Schema hash to detect tool changes

## Responses API Testing

### Features
1. **Structured Outputs**: JSON Schema validation with strict mode
2. **Streaming Events**: SSE timeline visualization
   - `output_text.delta`: Text generation deltas
   - `tool_call.start`: Tool call initiated
   - `tool_call.complete`: Tool call finished
3. **Tool Integration**: Connect internal tools or MCP bridge
4. **Cost Calculation**: Token counting and cost attribution
5. **Request Export**: Save requests as code snippets

### Streaming Architecture
```
OpenAI API (SSE stream) → undici fetch → Async generator → Database events → SSE to frontend
```

## Audit and Compliance

### Audit Logging
All security-relevant actions logged to `audit_log` table:
- User authentication (login/logout)
- Configuration changes (MCP servers, settings)
- API executions (Responses, MCP tools)
- Authorization failures

### Logged Fields
- `user_uuid`, `org_uuid`: Who and where
- `action_name`: What action (e.g., `mcp.tool.call`)
- `target_type`, `target_id`: What resource
- `result_code`: Success/failure/denied
- `ip_addr`, `user_agent`: Where from
- `detail_json`: Additional context

### Compliance Standards
- **ASVS 5.0.0**: Application Security Verification Standard (compatible with 4.0.3 controls)
- **NIST SP 800-63B**: Digital Identity Guidelines (baseline AAL1; enforce Casdoor MFA + inactivity/reauthentication policies for AAL2)
- **OIDC Core 1.0**: OpenID Connect specification

## Cost Monitoring

### Model Pricing
- `model_price` table stores per-model costs (input/output per 1M tokens)
- Updated from OpenAI pricing page
- Supports historical pricing with `effective_at` date

### Usage Tracking
- Every Responses API call records tokens and cost
- Aggregations by organization, user, model, date
- Dashboard shows:
  - Total cost and tokens
  - Cost by model
  - Daily trend

## Performance Considerations

### Database
- Connection pooling (5-15 connections per instance)
- Prepared statements
- Indexes on foreign keys and common query patterns
- JSONB GIN indexes for semi-structured queries

### HTTP
- HTTP/2 or HTTP/3 for multiplexing
- Compression (gzip/brotli)
- Keep-alive connections
- Streaming responses (SSE) with backpressure

### Caching
- OIDC discovery document (1 hour TTL)
- JWKS (cached in jose library)
- MCP tool catalogs (invalidated on schema change)

## Deployment

### Prerequisites
- Node.js 20+
- PostgreSQL 14+
- Casdoor instance (self-hosted or cloud)
- OpenAI API key

### Environment Variables
See `backend/.env.example` for all required configuration.

### Database Setup
```bash
psql -U postgres -d openai_playground -f database/schema.sql
```

### Running Locally
```bash
# Backend
cd backend
npm install
cp .env.example .env
# Edit .env with your configuration
npm run dev

# Frontend
cd frontend
npm install
npm run dev
```

### Production
```bash
# Backend
cd backend
npm run build
npm start

# Frontend
cd frontend
npm run build
# Serve dist/ with nginx or similar
```

## API Reference

### Authentication
- `GET /api/auth/login` - Start OIDC flow
- `GET /api/auth/callback` - OIDC callback
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user

### MCP
- `POST /api/mcp/servers` - Register MCP server
- `GET /api/mcp/servers` - List MCP servers
- `PUT /api/mcp/servers/:id` - Update MCP server
- `DELETE /api/mcp/servers/:id` - Delete MCP server
- `POST /api/mcp/servers/:id/sync` - Sync tool catalog
- `POST /api/mcp/call` - Call MCP tool
- `GET /api/mcp/executions` - List executions
- `GET /api/mcp/tools/:id/stats` - Tool statistics

### Responses
- `POST /api/responses/run` - Execute Responses API call
- `GET /api/responses/runs` - List runs
- `GET /api/responses/runs/:id` - Get run details
- `GET /api/responses/runs/:id/events` - Get streaming events

### Usage
- `GET /api/usage/summary` - Usage summary
- `GET /api/usage/by-model` - Usage by model
- `GET /api/usage/trend` - Daily usage trend

### Audit
- `GET /api/audits` - List audit logs

## Testing

### Backend Tests
```bash
cd backend
npm test
```

### Security Testing
- ASVS checklist in `docs/ASVS-CHECKLIST.md`
- OWASP Top 10 mitigations
- Dependency scanning with npm audit

## Naming Convention Enforcement

All database objects **must** follow two-word snake_case:
- ✅ `org_unit`, `user_account`, `mcp_server`
- ❌ `organization`, `user`, `mcpserver`, `mcp_servers`

CI pipeline fails if schema violates this rule.

## References

- [OpenAI Responses API](https://platform.openai.com/docs/api-reference)
- [OpenAI Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)
- [MCP Specification](https://modelcontextprotocol.io/specification/2025-03-26)
- [Casdoor OIDC](https://casdoor.github.io/docs/how-to-connect/oidc-client/)
- [OWASP ASVS 5.0.0](https://owasp.org/www-project-application-security-verification-standard/)
- [NIST SP 800-63B](https://nvlpubs.nist.gov/nistpubs/specialpublications/nist.sp.800-63b.pdf)
