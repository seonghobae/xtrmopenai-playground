# OpenAI Playground App

**Comprehensive testing platform for OpenAI Responses API and Model Context Protocol (MCP)**

## Features

### 🔧 MCP Test Harness
- Register and manage remote MCP servers
- Automatic tool catalog synchronization via `tools/list`
- Interactive tool invocation with parameter forms
- Performance metrics: success rate, p95 latency, timeouts
- Server-side security proxy with domain allowlist, request/response size caps, and explicit user consent guard

### 🤖 Responses API Testing
- Full OpenAI Responses API support (Chat Completions)
- **Structured Outputs** with JSON Schema validation
- **Streaming events timeline** visualization (SSE)
- Tool calling with internal or MCP-bridged tools
- Request/response export as code snippets

### 🔐 Enterprise Authentication
- **Casdoor OIDC** integration with PKCE
- JWKS-based token verification
- Optional multi-factor authentication when enforced in Casdoor
- Role-based access control (RBAC)
- Organization/tenant isolation

### 📊 Monitoring & Governance
- Comprehensive audit logging (ASVS/NIST compliant)
- Token usage and cost tracking per model
- Usage dashboards by organization, user, model
- Automated price synchronization from OpenAI

### 🛡️ Security Hardening
- OWASP ASVS 5.0.0 alignment (backward-compatible with ASVS 4.0.3 controls)
- NIST SP 800-63B authentication guidelines (baseline AAL1; configure Casdoor MFA + session policies for AAL2)
- Helmet security headers (CSP, HSTS)
- Global and per-route rate limiting
- Input validation with Zod schemas
- Structured logging with PII masking

## Technology Stack

**Backend**: Node.js 20+, TypeScript, Fastify, PostgreSQL, undici
**Frontend**: React 18+, TypeScript, Vite, TanStack Query
**Database**: PostgreSQL 14+ with pgcrypto
**Auth**: Casdoor OIDC with JWKS
**Standards**: HTTP/2+, TLS 1.3, OIDC Core 1.0

## Quick Start

### Prerequisites

- Node.js 20 or higher
- PostgreSQL 14 or higher
- Casdoor instance (self-hosted or cloud)
- OpenAI API key

### Installation

1. **Clone repository**
```bash
git clone https://github.com/your-org/openai-playground.git
cd openai-playground
```

2. **Setup database**
```bash
createdb openai_playground
psql -U postgres -d openai_playground -f database/schema.sql
```

3. **Configure backend**
```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your configuration
```

4. **Configure frontend**
```bash
cd frontend
npm install
```

5. **Run development servers**
```bash
# Terminal 1 - Backend
cd backend
npm run dev

# Terminal 2 - Frontend
cd frontend
npm run dev
```

6. **Access application**
- Frontend: http://localhost:5173
- Backend API: http://localhost:3000
- Health check: http://localhost:3000/health

## Configuration

### Required Environment Variables

See `backend/.env.example` for all variables. Key configurations:

**Casdoor OIDC**
```env
OIDC_ISSUER=https://your-casdoor-instance.com
OIDC_CLIENT_ID=your_client_id
OIDC_CLIENT_SECRET=your_client_secret
OIDC_REDIRECT_URI=http://localhost:3000/api/auth/callback
```

**OpenAI API**
```env
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1
```

**Security**
```env
SESSION_SECRET=generate_secure_random_32_chars_minimum
SESSION_TTL_SECONDS=86400
SESSION_INACTIVITY_SECONDS=3600
ENCRYPTION_KEY=generate_secure_random_32_chars_minimum
AUDIT_IP_HASH_SALT=generate_stable_salt_for_ip_hashing_32_chars
```

## Database Schema

All database objects follow **strict two-word snake_case** naming:
- Tables: `org_unit`, `user_account`, `mcp_server`, `response_run`
- Columns: `org_uuid`, `name_text`, `created_at`, `token_input`
- UUID primary keys with `gen_random_uuid()`
- `TIMESTAMPTZ` for all temporal data
- `jsonb` for semi-structured data

See `database/schema.sql` for complete schema.

## API Documentation

### Authentication Endpoints
- `GET /api/auth/login` - Initiate OIDC login
- `GET /api/auth/callback` - OIDC callback handler
- `POST /api/auth/logout` - Logout user
- `GET /api/auth/me` - Get current user info

### MCP Endpoints
- `POST /api/mcp/servers` - Register MCP server
- `GET /api/mcp/servers` - List registered servers
- `POST /api/mcp/call` - Execute MCP tool
- `GET /api/mcp/executions` - List execution history

### Responses API Endpoints
- `POST /api/responses/run` - Execute Responses API call
- `GET /api/responses/runs` - List execution history
- `GET /api/responses/runs/:id/events` - Get streaming events

### Usage & Monitoring
- `GET /api/usage/summary` - Usage and cost summary
- `GET /api/audits` - Audit log access

See `docs/ARCHITECTURE.md` for detailed API reference.

## Security Features

### OIDC Authentication Flow
1. Authorization Code flow with PKCE (S256)
2. State and nonce for CSRF/replay protection
3. JWKS-based signature verification
4. Secure session cookies (httpOnly, secure, sameSite)

### Input Validation
- Zod schemas on all API endpoints
- Parameterized database queries (SQL injection prevention)
- Domain allowlist for MCP servers
- JSON Schema validation for Structured Outputs

### Audit Logging
All security-relevant actions logged:
- Authentication events (login/logout/failures)
- MCP tool executions
- Responses API calls
- Configuration changes
- Authorization failures

### Rate Limiting
- Global rate limit: 100 req/min (configurable)
- Per-route limits for expensive operations
- 429 responses with Retry-After header

## Architecture

See `docs/ARCHITECTURE.md` for comprehensive documentation including:
- System architecture diagrams
- Security architecture
- Database schema design
- Performance considerations
- Deployment guide

## Development

### Running Tests
```bash
cd backend
npm test
```

### Linting and Formatting
```bash
# Backend
cd backend
npm run lint
npm run format

# Frontend
cd frontend
npm run lint
npm run format
```

### Database Migrations
Schema changes are tracked in `database/migrations/`.

## Production Deployment

### Build
```bash
# Backend
cd backend
npm run build

# Frontend
cd frontend
npm run build
```

### Environment
- Set `NODE_ENV=production`
- Use strong `SESSION_SECRET` (minimum 32 characters)
- Enable TLS 1.3 on reverse proxy
- Configure HTTP/2 or HTTP/3
- Set appropriate CORS origins

### Monitoring
- Application logs via Pino (JSON structured)
- Database connection pool metrics
- Rate limit metrics
- OpenAI API usage tracking

## Compliance

### Standards
- **OWASP ASVS 4.0.3**: Application Security Verification Standard
- **NIST SP 800-63B**: Digital Identity Guidelines (AAL2+)
- **OIDC Core 1.0**: OpenID Connect specification
- **MCP Specification**: Model Context Protocol 2025-03-26

### Testing
Security checklist in `docs/SECURITY.md`

## License

MIT

## Contributing

1. Fork repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## Support

- Documentation: `docs/`
- Issues: [GitHub Issues](https://github.com/your-org/openai-playground/issues)
- Discussions: [GitHub Discussions](https://github.com/your-org/openai-playground/discussions)

## References

- [OpenAI Platform Documentation](https://platform.openai.com/docs)
- [MCP Specification](https://modelcontextprotocol.io/specification)
- [Casdoor Documentation](https://casdoor.org/docs/overview)
- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
- [NIST SP 800-63B](https://pages.nist.gov/800-63-3/sp800-63b.html)
