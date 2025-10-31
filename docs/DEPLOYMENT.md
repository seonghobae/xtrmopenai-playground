# Deployment Guide

## Prerequisites

- Node.js 20+ LTS
- PostgreSQL 14+
- Reverse proxy (nginx, Caddy, Traefik)
- SSL/TLS certificate
- Casdoor instance
- OpenAI API key

## Production Build

### Backend

```bash
cd backend
npm install
npm run build
npm prune --production
```

Build output: `backend/dist/`

### Frontend

```bash
cd frontend
npm install
npm run build
```

Build output: `frontend/dist/`

## Environment Configuration

### Backend Environment Variables

Copy `.env.example` to `.env` and configure:

```env
# Production settings
NODE_ENV=production
LOG_LEVEL=info

# Server
SERVER_HOST=0.0.0.0
SERVER_PORT=3000
CORS_ORIGIN=https://playground.yourdomain.com

# Database
DATABASE_HOST=db.yourdomain.com
DATABASE_PORT=5432
DATABASE_NAME=openai_playground
DATABASE_USER=app_user
DATABASE_PASSWORD=<strong-password>
DATABASE_MAX_CONNECTIONS=20
DATABASE_SSL_CA=/etc/ssl/certs/ca.pem
DATABASE_SSL_CERT=
DATABASE_SSL_KEY=

# Casdoor OIDC
OIDC_ISSUER=https://casdoor.yourdomain.com
OIDC_CLIENT_ID=<client-id>
OIDC_CLIENT_SECRET=<client-secret>
OIDC_REDIRECT_URI=https://api.playground.yourdomain.com/api/auth/callback
OIDC_SCOPE=openid profile email

# OpenAI
OPENAI_API_KEY=<your-api-key>
OPENAI_BASE_URL=https://api.openai.com/v1

# Security
SESSION_SECRET=<generate-64-char-random-string>
SESSION_TTL_SECONDS=86400
SESSION_INACTIVITY_TIMEOUT_SECONDS=3600
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000
```

### Generate Secure Secrets

```bash
# Session secret (64 characters)
openssl rand -base64 48

# Or using Node.js
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Database Setup

### Create Database

```bash
psql -U postgres << EOF
CREATE DATABASE openai_playground;
CREATE USER app_user WITH PASSWORD 'strong-password';
GRANT ALL PRIVILEGES ON DATABASE openai_playground TO app_user;
EOF
```

### Apply Schema

```bash
psql -U app_user -d openai_playground -f database/schema.sql
```

### Verify

```bash
psql -U app_user -d openai_playground -c "SELECT * FROM app_core.org_unit LIMIT 1;"
```

## Process Management

### Using systemd (Recommended)

Create `/etc/systemd/system/openai-playground.service`:

```ini
[Unit]
Description=OpenAI Playground Backend
After=network.target postgresql.service

[Service]
Type=simple
User=app
WorkingDirectory=/opt/openai-playground/backend
Environment=NODE_ENV=production
EnvironmentFile=/opt/openai-playground/backend/.env
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=openai-playground

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable openai-playground
sudo systemctl start openai-playground
sudo systemctl status openai-playground
```

View logs:

```bash
sudo journalctl -u openai-playground -f
```

### Using PM2

```bash
npm install -g pm2

# Start
pm2 start dist/server.js --name openai-playground

# Save process list
pm2 save

# Auto-restart on reboot
pm2 startup
```

## Reverse Proxy Configuration

### Nginx

```nginx
upstream backend {
    server 127.0.0.1:3000;
}

server {
    listen 443 ssl http2;
    server_name api.playground.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.3 TLSv1.2;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    location / {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
}

# Frontend
server {
    listen 443 ssl http2;
    server_name playground.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.3 TLSv1.2;

    root /opt/openai-playground/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

Test and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### Caddy

```caddyfile
api.playground.yourdomain.com {
    reverse_proxy localhost:3000
    encode gzip
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Frame-Options "DENY"
        X-Content-Type-Options "nosniff"
    }
}

playground.yourdomain.com {
    root * /opt/openai-playground/frontend/dist
    encode gzip
    file_server
    try_files {path} /index.html
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
    }
}
```

## Docker Deployment

### Dockerfile (Backend)

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --production

FROM node:20-alpine

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

EXPOSE 3000
CMD ["node", "dist/server.js"]
```

### docker-compose.yml

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:14-alpine
    environment:
      POSTGRES_DB: openai_playground
      POSTGRES_USER: app_user
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./database/schema.sql:/docker-entrypoint-initdb.d/schema.sql
    ports:
      - "5432:5432"

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    environment:
      NODE_ENV: production
      DATABASE_HOST: postgres
      DATABASE_PORT: 5432
      DATABASE_NAME: openai_playground
      DATABASE_USER: app_user
      DATABASE_PASSWORD: ${DB_PASSWORD}
      OIDC_ISSUER: ${OIDC_ISSUER}
      OIDC_CLIENT_ID: ${OIDC_CLIENT_ID}
      OIDC_CLIENT_SECRET: ${OIDC_CLIENT_SECRET}
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      SESSION_SECRET: ${SESSION_SECRET}
    ports:
      - "3000:3000"
    depends_on:
      - postgres

volumes:
  postgres_data:
```

## Monitoring

### Health Checks

```bash
# Backend health
curl https://api.playground.yourdomain.com/health

# Expected response
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2025-10-31T..."
  }
}
```

### Logs

Backend logs are JSON-formatted via Pino:

```bash
# View logs
sudo journalctl -u openai-playground -f

# Filter by level
sudo journalctl -u openai-playground | grep '"level":"error"'
```

### Metrics

Consider integrating:
- **Prometheus**: Metrics collection
- **Grafana**: Dashboards
- **Sentry**: Error tracking
- **DataDog**: APM

## Backup

### Database Backup

```bash
# Daily backup
pg_dump -U app_user -d openai_playground -F c -f backup-$(date +%Y%m%d).dump

# Automated with cron
0 2 * * * pg_dump -U app_user -d openai_playground -F c -f /backups/backup-$(date +\%Y\%m\%d).dump
```

### Restore

```bash
pg_restore -U app_user -d openai_playground backup-20251031.dump
```

## Security Checklist

- [ ] Strong SESSION_SECRET (64+ characters)
- [ ] Database password strength (20+ characters)
- [ ] TLS 1.3 enabled
- [ ] HSTS header configured
- [ ] CORS origins restricted
- [ ] Rate limiting enabled
- [ ] Log rotation configured
- [ ] Firewall rules (only 80/443 public)
- [ ] Database access restricted to backend only
- [ ] Regular security updates
- [ ] Audit logs monitored
- [ ] Backup tested

## Scaling

### Horizontal Scaling

Backend is stateless (sessions in database), can run multiple instances:

```nginx
upstream backend {
    least_conn;
    server backend1:3000;
    server backend2:3000;
    server backend3:3000;
}
```

### Database Scaling

- **Read Replicas**: For read-heavy workloads
- **Connection Pooling**: Use PgBouncer (session mode)
- **Partitioning**: Partition audit_log by date

### Caching

- **Redis**: Cache MCP tool catalogs, OIDC discovery
- **CDN**: Serve frontend static assets

## Troubleshooting

### Backend won't start

```bash
# Check logs
sudo journalctl -u openai-playground -n 50

# Check environment
cat /opt/openai-playground/backend/.env

# Test database connection
psql -U app_user -d openai_playground -c "SELECT 1;"
```

### OIDC login fails

- Verify OIDC_ISSUER is accessible
- Check OIDC_REDIRECT_URI matches Casdoor configuration
- Ensure cookies are working (secure flag on HTTPS)

### High latency

- Check database query performance (slow query log)
- Monitor OpenAI API response times
- Check MCP server response times
- Review rate limiting thresholds

## Updates

### Rolling Updates

```bash
# 1. Pull latest code
git pull origin main

# 2. Install dependencies
cd backend && npm install

# 3. Build
npm run build

# 4. Restart service
sudo systemctl restart openai-playground

# 5. Verify
curl https://api.playground.yourdomain.com/health
```

### Zero-Downtime Updates

Use multiple backend instances behind load balancer, update one at a time.

## Support

For deployment issues:
- Check logs first
- Review configuration
- Consult docs/ARCHITECTURE.md
- Open GitHub issue with logs (redact secrets!)
