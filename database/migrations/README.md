# Database Migrations

This directory contains SQL migration scripts for schema changes.

## Migration Naming Convention

Migrations are numbered sequentially: `NNN_description.sql`
- `NNN`: Three-digit sequence number (001, 002, 003, ...)
- `description`: Brief description using snake_case

## Applying Migrations

Migrations should be applied in numerical order:

```bash
psql -U postgres -d openai_playground -f database/migrations/001_drop_redundant_status_idx.sql
```

## Migration List

- **001_drop_redundant_status_idx.sql**: Removes redundant single-column index on `mcp_execution.status_text` in favor of the composite index `idx_mcp_execution_status_created(status_text, created_at)`

## Best Practices

1. All migrations use `IF EXISTS` / `IF NOT EXISTS` to be idempotent
2. Include detailed comments explaining the reason for the change
3. Document query patterns and performance impact
4. Provide rollback instructions in comments
5. Test migrations on a copy of production data before deployment
