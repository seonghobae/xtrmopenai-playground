# Audit Module

This module provides audit logging functionality with multi-tier retention policies for PII compliance.

## Key Features

- **Comprehensive Audit Logging**: Records all security-relevant actions
- **Database-Stored Retention Policies**: Configure retention periods without code changes
- **Multi-Tier Anonymization**: Progressive data lifecycle management
- **Policy Audit Trail**: Track all retention policy changes

## Usage

### Creating Audit Logs

```typescript
import { createAuditLog, AuditAction, AuditResult } from './modules/audit/repository';

// Log a successful action
await createAuditLog({
  org_uuid: 'org-uuid-here',
  user_uuid: 'user-uuid-here',
  action_name: AuditAction.MCP_SERVER_CREATE,
  target_type: 'mcp_server',
  target_id: 'mcp-server-uuid',
  result_code: AuditResult.SUCCESS,
  detail_json: { name: 'My MCP Server' },
  ip_addr: req.ip,
  user_agent: req.headers['user-agent'],
});
```

### Applying Retention Policies

```typescript
import { applyAuditRetentionPolicy } from './modules/audit/repository';

// Apply to all organizations (use in scheduled job)
const stats = await applyAuditRetentionPolicy();
console.log(`Deleted: ${stats.deleted}, Full Anon: ${stats.fullAnonymized}, Partial Anon: ${stats.partialAnonymized}`);

// Apply to specific organization
const orgStats = await applyAuditRetentionPolicy('org-uuid-here');
```

### Managing Retention Policies

```typescript
import { upsertRetentionPolicy, getRetentionPolicy } from './modules/audit/repository';

// Get current policy
const policy = await getRetentionPolicy('audit_log', 'org-uuid-here');

// Update policy (creates audit trail)
await upsertRetentionPolicy({
  org_uuid: 'org-uuid-here',  // or null for system default
  policy_name: 'Custom Finance Policy',
  target_table: 'audit_log',
  full_retention_days: 365,    // 1 year full retention
  partial_anon_days: 730,      // 2 years partial anonymization
  full_anon_days: 2190,        // 6 years full anonymization
  deletion_days: 3650,         // 10 years deletion
  changed_by: 'admin-user-uuid',
  change_reason: 'Updated for financial compliance requirements',
});
```

### Querying Audit Logs

```typescript
import { getAuditLogs } from './modules/audit/repository';

// Get recent audit logs with filters
const result = await getAuditLogs({
  org_uuid: 'org-uuid-here',
  user_uuid: 'user-uuid-here',
  action_name: AuditAction.LOGIN_SUCCESS,
  start_date: new Date('2024-01-01'),
  end_date: new Date('2024-12-31'),
  limit: 100,
  offset: 0,
});

console.log(`Total: ${result.total}, Items: ${result.items.length}`);
```

## Retention Policy Lifecycle

The system implements a 4-stage progressive anonymization strategy:

### 1. Full Retention (Default: 180 days)
All data including PII is kept intact for security investigations.

### 2. Partial Anonymization (Default: 365 days)
- IP addresses are hashed (SHA-256) for pattern analysis
- User agents retained for security analysis
- `_partial_anonymized` timestamp added to `detail_json`

### 3. Full Anonymization (Default: 1095 days)
- All PII removed (IP, user agent set to NULL)
- Only non-PII audit metadata retained
- `_anonymized` timestamp added to `detail_json`

### 4. Deletion (Default: 1825 days)
Complete removal of audit log records.

## Scheduled Jobs

Set up a cron job to apply retention policies regularly:

```typescript
// Example: Daily at 2 AM
import cron from 'node-cron';
import { applyAuditRetentionPolicy } from './modules/audit/repository';
import { logger } from './utils/logger';

cron.schedule('0 2 * * *', async () => {
  try {
    const stats = await applyAuditRetentionPolicy();
    logger.info({ stats }, 'Retention policy applied successfully');
  } catch (err) {
    logger.error({ err }, 'Failed to apply retention policy');
  }
});
```

## Database Schema

### retention_policy Table

Stores retention configurations with multi-tier thresholds:

```sql
CREATE TABLE app_core.retention_policy (
  policy_uuid UUID PRIMARY KEY,
  org_uuid UUID,                    -- NULL = system default
  policy_name TEXT,
  target_table TEXT,                -- e.g., 'audit_log'
  full_retention_days INT,          -- Keep all data (default: 180)
  partial_anon_days INT,            -- Hash IPs (default: 365)
  full_anon_days INT,               -- Remove all PII (default: 1095)
  deletion_days INT,                -- Delete records (default: 1825)
  is_active BOOLEAN,
  created_by UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

### retention_policy_history Table

Audit trail for policy changes:

```sql
CREATE TABLE app_core.retention_policy_history (
  history_uuid UUID PRIMARY KEY,
  policy_uuid UUID,
  changed_by UUID,
  old_values JSONB,
  new_values JSONB,
  change_reason TEXT,
  created_at TIMESTAMPTZ
);
```

## Best Practices

1. **Conservative Defaults**: Start with 5-year deletion, reduce after risk assessment
2. **Document Changes**: Always provide `change_reason` when updating policies
3. **Regular Review**: Audit policy effectiveness quarterly
4. **Industry Alignment**: 
   - General SaaS: 180/365/1095/1825 days
   - Finance: 365/730/2190/3650 days (10 years)
   - Healthcare: Follow HIPAA guidelines
5. **Legal Consultation**: Involve legal counsel for compliance requirements

## Security Considerations

- Audit failures should not break application flow (logged but don't throw)
- PII in `detail_json` should be minimized where possible
- Access to full audit logs should be restricted to admins/auditors
- Policy changes are automatically audited in `retention_policy_history`
- Hash salt for IP anonymization should be configured securely

## References

- SECURITY.md: Comprehensive security documentation
- PCI DSS Requirement 10.7: Retain audit trail history for at least one year
- SOC 2: Audit evidence retention requirements
- GDPR Article 5(1)(e): Storage limitation principle
