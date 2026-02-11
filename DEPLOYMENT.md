# Farseer Deployment Guide

This guide covers deploying Farseer in production using Docker.

## Table of Contents

- [Quick Start](#quick-start)
- [Docker Deployment](#docker-deployment)
- [Reverse Proxy Setup](#reverse-proxy-setup)
- [Security Checklist](#security-checklist)
- [Configuration](#configuration)
- [Backup & Recovery](#backup--recovery)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/your-repo/farseer.git
cd farseer

# Start with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f
```

Access Farseer at `http://localhost:8080`. On first visit, you'll be prompted to create an admin account.

---

## Docker Deployment

### Option 1: Docker Compose (Recommended)

The included `docker-compose.yml` handles everything:

```yaml
version: '3.8'

services:
  farseer:
    build: .
    container_name: farseer
    ports:
      - "8080:8080"
    volumes:
      - farseer-data:/data
    environment:
      - FARSEER_PORT=8080
      - FARSEER_PRODUCTION=true
    restart: unless-stopped

volumes:
  farseer-data:
```

**Commands:**

```bash
# Build and start
docker-compose up -d --build

# Stop
docker-compose down

# View logs
docker-compose logs -f farseer

# Restart
docker-compose restart
```

### Option 2: Docker Run

Build and run manually:

```bash
# Build the image
docker build -t farseer .

# Run the container
docker run -d \
  --name farseer \
  -p 8080:8080 \
  -v farseer-data:/data \
  -e FARSEER_PRODUCTION=true \
  --restart unless-stopped \
  farseer
```

### Option 3: Pre-built Image

If publishing to a registry:

```bash
docker pull your-registry/farseer:latest

docker run -d \
  --name farseer \
  -p 8080:8080 \
  -v farseer-data:/data \
  -e FARSEER_PRODUCTION=true \
  --restart unless-stopped \
  your-registry/farseer:latest
```

---

## Reverse Proxy Setup

**HTTPS is required for production.** SSH credentials are transmitted over the network, so TLS encryption is essential.

### Caddy (Recommended - Auto HTTPS)

Caddy automatically obtains and renews SSL certificates.

**Caddyfile:**
```
farseer.yourdomain.com {
    reverse_proxy localhost:8080
}
```

**docker-compose.yml with Caddy:**
```yaml
version: '3.8'

services:
  farseer:
    build: .
    container_name: farseer
    expose:
      - "8080"
    volumes:
      - farseer-data:/data
    environment:
      - FARSEER_PRODUCTION=true
    restart: unless-stopped

  caddy:
    image: caddy:alpine
    container_name: caddy
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy-data:/data
      - caddy-config:/config
    restart: unless-stopped

volumes:
  farseer-data:
  caddy-data:
  caddy-config:
```

### Nginx

**nginx.conf:**
```nginx
server {
    listen 80;
    server_name farseer.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name farseer.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/farseer.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/farseer.yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support (required for SSH terminals)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
```

**Important:** The `proxy_read_timeout` and WebSocket headers are required for SSH terminal sessions.

### Traefik

**docker-compose.yml with Traefik labels:**
```yaml
services:
  farseer:
    build: .
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.farseer.rule=Host(`farseer.yourdomain.com`)"
      - "traefik.http.routers.farseer.entrypoints=websecure"
      - "traefik.http.routers.farseer.tls.certresolver=letsencrypt"
      - "traefik.http.services.farseer.loadbalancer.server.port=8080"
    # ... rest of config
```

---

## Security Checklist

### Required for Production

- [ ] **Enable HTTPS** - Use a reverse proxy with TLS (see above)
- [ ] **Set `FARSEER_PRODUCTION=true`** - Restricts CORS to same-origin
- [ ] **Use strong admin password** - Set during initial setup
- [ ] **Persist data volume** - Ensure `/data` is backed up

### Recommended

- [ ] **Restrict network access** - Firewall to trusted IPs if possible
- [ ] **Use a dedicated subdomain** - e.g., `ssh.yourdomain.com`
- [ ] **Enable firewall rules** - Only allow 80/443 from internet
- [ ] **Monitor logs** - Check for failed login attempts
- [ ] **Regular backups** - See [Backup & Recovery](#backup--recovery)

### Security Architecture

| Component | Implementation |
|-----------|----------------|
| Password Storage | bcrypt (cost 10) |
| Credential Encryption | AES-256-GCM |
| Key Derivation | PBKDF2 (100k iterations) |
| Auth Tokens | JWT with HS256, 24-hour expiry |
| Rate Limiting | 5 requests/minute on login |
| Host Key Verification | Trust On First Use (TOFU) |

### Known Considerations

1. **JWT in localStorage** - Standard practice but vulnerable to XSS. Ensure you trust any browser extensions.

2. **Encryption key in headers** - The key used to decrypt SSH credentials is transmitted via HTTPS. This is secure as long as TLS is properly configured.

3. **Self-signed certificates** - Avoid in production. Use Let's Encrypt (free) via Caddy or certbot.

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FARSEER_PORT` | `8080` | HTTP server port |
| `FARSEER_CONFIG_DIR` | `/data` (Docker) or `~/.farseer` | Config/secrets directory |
| `FARSEER_DB_PATH` | `<config_dir>/farseer.db` | SQLite database path |
| `FARSEER_PRODUCTION` | `false` | Enable production mode (strict CORS) |

### Config File

On first run, Farseer generates `config.json` in the config directory:

```json
{
  "server_port": 8080,
  "database_path": "/data/farseer.db",
  "server_secret": "<auto-generated-32-bytes>",
  "jwt_secret": "<auto-generated-32-bytes>"
}
```

**Important:** The `server_secret` is used to encrypt SSH credentials. If lost, stored credentials cannot be decrypted.

### Docker Volume Structure

```
/data/
├── config.json      # Server configuration and secrets
└── farseer.db       # SQLite database (users, machines, encrypted credentials)
```

---

## Backup & Recovery

### Backup

The `/data` volume contains everything needed to restore Farseer:

```bash
# Stop the container (recommended for consistency)
docker-compose stop

# Backup the volume
docker run --rm \
  -v farseer-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/farseer-backup-$(date +%Y%m%d).tar.gz -C /data .

# Restart
docker-compose start
```

**Or with docker-compose:**

```bash
# Find volume location
docker volume inspect farseer-data

# Copy directly (Linux)
sudo cp -r /var/lib/docker/volumes/farseer-data/_data ./backup/
```

### Restore

```bash
# Stop and remove existing container
docker-compose down

# Remove existing volume (CAUTION: destroys current data)
docker volume rm farseer-data

# Create new volume
docker volume create farseer-data

# Restore from backup
docker run --rm \
  -v farseer-data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/farseer-backup-20240115.tar.gz -C /data

# Start
docker-compose up -d
```

### What's Backed Up

- **config.json** - Server secrets (required to decrypt credentials)
- **farseer.db** - Users, machines, encrypted SSH credentials, host keys

---

## Troubleshooting

### Container won't start

```bash
# Check logs
docker-compose logs farseer

# Common issues:
# - Port 8080 in use: Change FARSEER_PORT
# - Permission denied on /data: Check volume permissions
```

### Can't connect to SSH machines

1. **Check network connectivity** - Container must reach target machines
2. **Docker network mode** - Default bridge should work; use `network_mode: host` if needed
3. **Firewall rules** - Ensure outbound SSH (port 22) is allowed

```bash
# Test from inside container
docker exec -it farseer sh
# Then try: nc -zv target-host 22
```

### WebSocket connection fails

- Ensure reverse proxy passes WebSocket headers (see nginx config above)
- Check `proxy_read_timeout` is set high enough for long sessions
- Verify HTTPS is working (mixed content blocks WebSocket)

### Lost admin password

```bash
# Access the database directly
docker exec -it farseer sh
# Delete the user (you'll need to run setup again)
sqlite3 /data/farseer.db "DELETE FROM users;"
# Restart and visit the web UI to create new admin
```

### Lost server secret (can't decrypt credentials)

If `config.json` is lost or corrupted, encrypted SSH credentials cannot be recovered. You'll need to:

1. Delete the database: `docker exec farseer rm /data/farseer.db`
2. Restart: `docker-compose restart`
3. Re-add all machines with their credentials

**Prevention:** Always backup the entire `/data` volume, not just the database.

---

## Updating

```bash
# Pull latest code
git pull

# Rebuild and restart
docker-compose up -d --build
```

Data in the `/data` volume persists across updates.
