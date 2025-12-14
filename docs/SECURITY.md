# Security Documentation

## Overview

OpenAI Playground App implements defense-in-depth security following industry standards:
- **OWASP ASVS 5.0.0** (Application Security Verification Standard)
- **NIST SP 800-63B** (Digital Identity Guidelines, baseline AAL1 with guidance for AAL2)
- **OIDC Core 1.0** (OpenID Connect)

## Authentication Security

### OIDC Implementation
- **Protocol**: Authorization Code Flow with PKCE (Proof Key for Code Exchange)
- **Code Challenge Method**: S256 (SHA-256)
- **Token Verification**: JWKS (JSON Web Key Set) signature validation
- **Session Management**: Secure HTTP-only cookies with SameSite=Lax

### PKCE Flow
1. Generate random `code_verifier` (43-128 characters, base64url)
2. Compute `code_challenge` = BASE64URL(SHA256(code_verifier))
3. Send `code_challenge` in authorization request
4. Send `code_verifier` in token exchange
5. Authorization server verifies: SHA256(code_verifier) == code_challenge

### State and Nonce
- **State**: CSRF protection (32 bytes random, base64url)
- **Nonce**: Replay attack prevention (32 bytes random, base64url)
- Both stored in HTTP-only cookies with 10-minute expiration

### Token Security
- **ID Token**: Verified with JWKS (issuer, audience, expiration, signature)
- **Access Token**: Used for UserInfo endpoint calls
- **Refresh Token**: Optional, stored encrypted in database
- **Storage**: Tokens stored in `token_json` column (should be encrypted at rest)

### Session Security
- **Cookie Name**: `session_id`
- **Attributes**: `HttpOnly`, `Secure` (production), `SameSite=Lax`
- **TTL**: Configurable (default 24 hours via `SESSION_TTL_SECONDS`)
- **Inactivity Timeout**: Configurable (default 1 hour via `SESSION_INACTIVITY_SECONDS`)
- **Rotation**: Session key regenerated on privilege escalation
- **Cleanup**: Expired sessions deleted by background job (housekeeping only)
- **MFA Enforcement**: Configure mandatory MFA policies in Casdoor to achieve NIST AAL2

#### Real-Time Session Validation

**Critical Security Implementation**: Session expiry and inactivity timeouts are enforced at **every authenticated request**, not just during scheduled cleanup.

The `getSessionByKey()` function validates BOTH conditions in the SQL WHERE clause:
1. **Absolute TTL**: `expires_at > now()` - Session must not exceed configured lifetime
2. **Inactivity timeout**: `last_used >= (now - SESSION_INACTIVITY_SECONDS)` - Recent activity required

This ensures:
- ✅ Expired or inactive sessions are rejected immediately at request time
- ✅ No security gap between cleanup intervals
- ✅ Meets NIST AAL2 requirements for session timeout enforcement
- ✅ Cleanup scheduler (`deleteExpiredSessions()`) is only for database housekeeping

**Code Reference**: `backend/src/modules/auth/repository.ts` lines 141-155

**Configuration**:
```env
SESSION_TTL_SECONDS=86400        # 24 hours - absolute maximum lifetime
SESSION_INACTIVITY_SECONDS=3600  # 1 hour - required activity window
SESSION_CLEANUP_INTERVAL_SECONDS=3600  # 1 hour - DB cleanup frequency (not security-critical)
```

## Authorization (RBAC)

### Model
- **Organizations**: Multi-tenant isolation in `org_unit` table
- **Members**: Users belong to orgs via `org_member` with `role_list[]`
- **Roles**: Array of strings (e.g., `['admin', 'developer', 'viewer']`)

### Enforcement
- Middleware checks user membership and roles before allowing resource access
- Admin role has implicit access to all organization resources
- Resource-level checks: MCP servers, Responses runs, audit logs
- MCP tool execution requires explicit user approval token before proxy invocation

### Example
```typescript
// Require 'developer' role in organization
app.post('/api/mcp/servers', {
  preHandler: [authenticate, requireRole('developer')]
}, handler);
```

## Input Validation

### Strategy
1. **Schema Validation**: Zod schemas on all API endpoints
2. **Type Safety**: TypeScript strict mode
3. **Whitelist Approach**: Only accept known fields
4. **Size Limits**: Request body size limited by Fastify and MCP proxy caps (1 MB request / 5 MB response)
5. **Content-Type**: Enforce `application/json` for JSON endpoints

### SQL Injection Prevention
- **Parameterized Queries**: All queries use `$1`, `$2` placeholders
- **No Dynamic SQL**: Never concatenate user input into SQL strings
- **ORM Alternative**: Using raw queries with parameter binding (pg library)

### Example
```typescript
// ✅ SAFE - Parameterized
await query('SELECT * FROM users WHERE email = $1', [email]);

// ❌ UNSAFE - Never do this
await query(`SELECT * FROM users WHERE email = '${email}'`);
```

## Output Encoding

### API Responses
- Content-Type: `application/json; charset=utf-8`
- JSON serialization: Built-in JSON.stringify (no manual escaping needed)
- Error messages: Never expose stack traces or internal paths in production

### Logging
- **Structured Logging**: Pino JSON format
- **PII Masking**: Sensitive fields automatically redacted
- **Redacted Fields**: password, token, secret, api_key, authorization, cookie, etc.

## Cryptography

### Hashing
- **Passwords**: Not stored (delegated to Casdoor)
- **Session Keys**: Cryptographically random (32 bytes)
- **PKCE Code Verifier**: Cryptographically random (32 bytes)

### Random Number Generation
- **Source**: `crypto.randomBytes()` (Node.js crypto module)
- **Usage**: Session keys, PKCE verifiers, state, nonce
- **Never use**: `Math.random()` for security-sensitive operations

### TLS
- **Version**: TLS 1.3 recommended, TLS 1.2 minimum
- **Cipher Suites**: Modern AEAD ciphers (AES-GCM, ChaCha20-Poly1305)
- **Certificates**: Valid, trusted CA-signed certificates
- **HSTS**: Enabled with 1-year max-age, includeSubDomains, preload

## HTTP Security Headers

### Helmet Configuration
- **Content-Security-Policy**: Restrictive policy, self-only resources
- **X-Content-Type-Options**: nosniff
- **X-Frame-Options**: DENY
- **X-XSS-Protection**: 1; mode=block
- **Referrer-Policy**: no-referrer
- **Permissions-Policy**: Restrictive feature policy
- **HSTS**: max-age=31536000; includeSubDomains; preload

### CORS
- **Origins**: Explicitly allowed domains (no wildcards in production)
- **Credentials**: true (allows cookies)
- **Methods**: GET, POST, PUT, DELETE, OPTIONS
- **Headers**: Content-Type, Authorization

## Rate Limiting

### Configuration
- **Global Limit**: 100 requests/minute per IP (configurable)
- **Window**: 60 seconds sliding window
- **Response**: 429 Too Many Requests
- **Headers**: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`

### Route-Specific Limits
```typescript
// More restrictive for expensive operations
app.post('/api/responses/run', {
  config: {
    rateLimit: {
      max: 10,
      timeWindow: '1 minute'
    }
  }
}, handler);
```

## MCP Security

### Server-Side Proxy
- **Browser Isolation**: Frontend never calls MCP servers directly
- **Credential Protection**: Auth headers stored on backend only
- **Request Validation**: All parameters validated before forwarding

### Domain Allowlist
- **Configuration**: `allow_domain` array per MCP server
- **Validation**: Exact match or subdomain match
- **Default**: Empty array = allow all (not recommended)

### Timeouts and Retries
- **Timeout**: Configurable per server (default 30 seconds)
- **Retries**: Configurable (default 3 attempts)
- **Backoff**: Exponential (1s, 2s, 4s, ...)
- **Circuit Breaker**: Prevents cascading failures

## Audit Logging

### Logged Events
- Authentication: login, logout, failures, token refresh
- Authorization: access denied, role checks
- Configuration: MCP server create/update/delete
- Execution: Responses runs, MCP tool calls
- Data: Exports, bulk operations

### Log Fields
- `user_uuid`: Who performed the action
- `org_uuid`: In which organization context
- `action_name`: Standardized action identifier
- `result_code`: success, failure, denied, error
- `ip_addr`: Source IP address (subject to retention policy)
- `user_agent`: Browser/client identifier (subject to retention policy)
- `detail_json`: Additional context (subject to retention policy)

### PII and Retention Policy

**Challenge**: Audit logs contain PII (IP addresses, user agents) needed for security investigations, but this conflicts with privacy requirements. Masking Korean language or other multilingual LLM responses at runtime is impractical.

**Solution**: Database-stored multi-tier retention policies with progressive anonymization.

#### Multi-Tier Retention Strategy

Audit logs follow a conservative 4-stage lifecycle stored in `app_core.retention_policy`:

1. **Full Retention** (Default: 180 days / 6 months)
   - All data including PII kept intact
   - Enables comprehensive security incident investigation
   - Meets most regulatory requirements for active investigation periods

2. **Partial Anonymization** (Default: 365 days / 1 year)
   - IP addresses hashed with HMAC-SHA256 (128-bit output) using dedicated stable salt
   - User agents retained for security analysis
   - Meets PCI DSS requirement 10.7 (minimum 1 year)
   - Marked with `_partial_anonymized` timestamp in `detail_json`

3. **Full Anonymization** (Default: 1095 days / 3 years)
   - All PII removed (IP address, user agent set to NULL)
   - Only non-PII audit metadata retained
   - Meets SOC 2 audit evidence requirements
   - Marked with `_anonymized` timestamp in `detail_json`

4. **Deletion** (Default: 1825 days / 5 years)
   - Complete removal of audit log records
   - Conservative default aligned with financial sector regulations
   - Can be adjusted per organization or industry requirements

#### Configuration

Retention policies are stored in the database (`app_core.retention_policy`), not environment variables, enabling:
- **Runtime reconfiguration** without code redeployment
- **Organization-specific policies** (e.g., finance: 10 years, general: 5 years)
- **Audit trail** of policy changes in `retention_policy_history`
- **Administrative UI** for policy management (future)

**System Default Policy:**
```sql
-- Conservative baseline (can be overridden per organization)
full_retention_days:  180   -- 6 months
partial_anon_days:    365   -- 1 year (PCI DSS)
full_anon_days:       1095  -- 3 years (SOC 2)
deletion_days:        1825  -- 5 years (financial regulations)
```

**Industry-Specific Recommendations:**
- **General SaaS**: Use system defaults (180/365/1095/1825 days)
- **Finance/Payment**: Extend to 365/730/2190/3650 days (10 years)
- **Healthcare**: Follow HIPAA guidelines (typically 6-7 years)
- **Public Sector**: Consult jurisdiction-specific regulations

#### Access Control

Audit log access is controlled via RBAC to prevent unauthorized PII exposure:

- **General users**: Should NOT have access to audit log endpoints
- **Auditors/Security roles**: Full access to all fields including PII (ip_addr, user_agent, detail_json)
- **Admin role**: Full access to audit logs within their organization scope
- **Organization isolation**: Users can only query logs from organizations they belong to

**Implementation Requirements**:
1. API endpoints must check user role before calling `getAuditLogs()`
2. Restrict audit log access to users with 'auditor', 'security', or 'admin' roles
3. Always filter by `org_uuid` based on user's organization memberships
4. Consider additional PII field filtering for non-admin roles if needed

**Code Example**:
```typescript
// In API endpoint handler
server.get('/api/audits', async (request, reply) => {
  await authenticate(request, reply);
  if (!request.user) return;
  
  // Check role
  const hasAuditAccess = request.user.organizations.some(org => 
    org.role_list.includes('admin') || 
    org.role_list.includes('auditor') ||
    org.role_list.includes('security')
  );
  
  if (!hasAuditAccess) {
    return reply.status(403).send({ 
      success: false, 
      error: { code: 'FORBIDDEN', message: 'Audit access requires admin/auditor role' } 
    });
  }
  
  // Fetch logs with organization scope
  const orgUuids = request.user.organizations.map(o => o.org_uuid);
  // ... query logic with org_uuid filter
});
```

#### Applying Retention Policies

```typescript
// Automated: Run as scheduled cron job (e.g., daily at 2 AM)
import { applyAuditRetentionPolicy } from './modules/audit/repository';

// Apply to all organizations
await applyAuditRetentionPolicy();

// Apply to specific organization
await applyAuditRetentionPolicy(orgUuid);
```

**Returns:**
```typescript
{
  deleted: number,           // Records completely removed
  fullAnonymized: number,    // Records with all PII removed
  partialAnonymized: number  // Records with hashed IPs
}
```

#### Policy Management

```typescript
// Update retention policy (creates audit trail)
await upsertRetentionPolicy({
  org_uuid: 'optional-org-uuid',  // null = system default
  policy_name: 'Custom Policy',
  target_table: 'audit_log',
  full_retention_days: 180,
  partial_anon_days: 365,
  full_anon_days: 1095,
  deletion_days: 1825,
  changed_by: 'admin-user-uuid',
  change_reason: 'Compliance requirement update'
});
```

**Audit Trail**: All policy changes recorded in `retention_policy_history` with old/new values.

#### Best Practices

1. **Start Conservative**: Use system defaults (5 years deletion), reduce after risk assessment
2. **Document Rationale**: Record `change_reason` when modifying policies
3. **Regular Review**: Audit policy effectiveness quarterly
4. **Balance Trade-offs**: Security investigation needs vs. privacy requirements vs. storage costs
5. **Legal Counsel**: Consult legal team for industry-specific retention requirements
6. **Stable Salt**: Use `AUDIT_IP_HASH_SALT` (separate from `ENCRYPTION_KEY`) to ensure IP hash consistency even if encryption keys are rotated
7. **Performance**: Run `applyAuditRetentionPolicy()` during off-peak hours for large datasets

## Secrets Management

### Environment Variables
- **Storage**: `.env` file (never commit to git)
- **Access**: Only backend process reads .env
- **Validation**: Zod schema validates all required vars at startup

### Recommended: External Secrets Management
- **AWS Secrets Manager**
- **HashiCorp Vault**
- **Azure Key Vault**
- **GCP Secret Manager**

### Rotation
- Session secrets: Rotate every 90 days
- API keys: Rotate per vendor recommendation
- Database passwords: Rotate every 180 days
- Audit IP hash salt: **Generally do not rotate** (breaks IP correlation analysis)
  - If rotation is necessary (e.g., salt compromise):
    1. Create new salt in environment
    2. Add `detail_json` field marking which salt version was used
    3. Update hashing logic to check salt version
    4. Re-hash affected logs during off-peak hours
    5. Document migration in retention policy change log

## Database Security

### Connection
- **TLS**: Enabled for remote databases
- **Least Privilege**: App user has only necessary permissions
- **Connection Pooling**: Limited connections (5-15)

### Schema
- **Two-Word Snake Case**: Enforced naming convention
- **UUID Primary Keys**: Non-sequential, non-guessable
- **Foreign Key Constraints**: Enforce referential integrity
- **Check Constraints**: Validate enum values

### Backup
- **Frequency**: Daily automated backups
- **Encryption**: At-rest encryption enabled
- **Retention**: 30 days minimum
- **Testing**: Restore tested quarterly

## Dependency Management

### Scanning
- **npm audit**: Run before every deployment
- **Snyk**: Continuous vulnerability monitoring
- **OSV**: Open Source Vulnerability database check
- **Dependabot**: Automated PR for updates

### Update Policy
- **Critical**: Patch within 24 hours
- **High**: Patch within 7 days
- **Medium**: Patch within 30 days
- **Low**: Patch in next release cycle

### Lock Files
- **package-lock.json**: Committed to repository
- **Reproducible Builds**: Same lock file = same dependencies

## Security Testing

### ASVS Checklist
Location: `docs/ASVS-CHECKLIST.md`

Categories:
- V1: Architecture, Design and Threat Modeling
- V2: Authentication
- V3: Session Management
- V4: Access Control
- V5: Validation, Sanitization and Encoding
- V7: Error Handling and Logging
- V8: Data Protection
- V9: Communication
- V10: Malicious Code
- V12: Files and Resources
- V13: API and Web Service
- V14: Configuration

### Penetration Testing
Recommended schedule:
- **Internal**: Quarterly automated scans
- **External**: Annual professional penetration test
- **Code Review**: Security-focused review before major releases

## Incident Response

### Detection
- **Monitoring**: Audit logs for anomalies
- **Alerting**: Rate limit violations, authentication failures
- **Logging**: All security events captured

### Response Plan
1. **Identify**: Determine scope and impact
2. **Contain**: Isolate affected systems
3. **Eradicate**: Remove threat
4. **Recover**: Restore normal operations
5. **Lessons Learned**: Post-incident review

### Contacts
- Security team: security@your-org.com
- On-call: Pagerduty/Opsgenie

## Secure Development Lifecycle

### Code Review
- **Requirement**: All code changes reviewed by peer
- **Security Focus**: Check for OWASP Top 10 issues
- **Automated**: GitHub/GitLab security scanning

### Testing
- **Unit Tests**: Cover security-critical functions
- **Integration Tests**: Test authentication/authorization flows
- **Security Tests**: Automated ASVS checklist

### Deployment
- **CI/CD**: Automated pipeline with security gates
- **Staging**: Test in production-like environment
- **Rollback**: Automated rollback on failures

## Compliance Resources

- [OWASP ASVS 5.0.0](https://owasp.org/www-project-application-security-verification-standard/)
- [NIST SP 800-63B](https://nvlpubs.nist.gov/nistpubs/specialpublications/nist.sp.800-63b.pdf)
- [OIDC Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)

## Reporting Security Issues

**DO NOT** open public GitHub issues for security vulnerabilities.

Contact: security@your-org.com

Provide:
- Description of vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We aim to respond within 48 hours.
