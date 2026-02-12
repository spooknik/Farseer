# Running Farseer on Proxmox with Alpine Linux

This guide covers deploying Farseer on a Proxmox host using Alpine Linux, both with Docker and natively.

## Table of Contents

- [Proxmox Setup](#proxmox-setup)
- [Option 1: Docker Deployment (Recommended)](#option-1-docker-deployment-recommended)
- [Option 2: Native Installation](#option-2-native-installation)
- [Networking & Access](#networking--access)
- [Backup Integration](#backup-integration)
- [Troubleshooting](#troubleshooting)

---

## Proxmox Setup

### Create Alpine Linux Container

Alpine Linux is perfect for Proxmox LXC containers - lightweight and efficient.

**Option A: LXC Container (Recommended)**

```bash
# In Proxmox shell, download Alpine template
pveam update
pveam available | grep alpine
pveam download local alpine-3.19-default_20240207_amd64.tar.xz

# Create container
pct create 100 local:vztmpl/alpine-3.19-default_20240207_amd64.tar.xz \
  --hostname farseer \
  --cores 2 \
  --memory 2048 \
  --swap 512 \
  --storage local-lvm \
  --rootfs local-lvm:8 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --unprivileged 1 \
  --features nesting=1

# Start the container
pct start 100

# Enter the container
pct enter 100
```

**Option B: VM (if you need nested virtualization)**

```bash
# Download Alpine ISO
cd /var/lib/vz/template/iso
wget https://dl-cdn.alpinelinux.org/alpine/v3.19/releases/x86_64/alpine-virt-3.19.1-x86_64.iso

# Create VM through Proxmox GUI or CLI
qm create 100 \
  --name farseer \
  --memory 2048 \
  --cores 2 \
  --net0 virtio,bridge=vmbr0 \
  --cdrom local:iso/alpine-virt-3.19.1-x86_64.iso \
  --scsi0 local-lvm:8

# Start and install Alpine (follow standard Alpine installation)
```

### Initial Alpine Configuration

Once inside your Alpine system:

```bash
# Set up apk repositories
setup-apkrepos -c -1  # Select fastest mirror

# Update system
apk update
apk upgrade

# Install basic tools
apk add nano curl wget git bash ca-certificates tzdata

# Set timezone (optional)
setup-timezone

# Enable community repository for Docker
sed -i 's/#.*community//' /etc/apk/repositories
apk update
```

---

## Option 1: Docker Deployment (Recommended)

### Install Docker on Alpine

```bash
# Install Docker and Docker Compose
apk add docker docker-compose docker-cli-compose

# Start Docker service
rc-update add docker boot
service docker start

# Verify installation
docker --version
docker-compose --version
```

### Deploy Farseer with Docker

```bash
# Clone the repository
cd /opt
git clone https://github.com/your-repo/farseer.git
cd farseer

# Build and start
docker-compose up -d --build

# Check status
docker-compose ps
docker-compose logs -f
```

**Access:** `http://<proxmox-container-ip>:8080`

### Docker Compose with Reverse Proxy (Recommended)

For HTTPS access, add Caddy to your setup:

```bash
# Create Caddyfile
cat > Caddyfile << 'EOF'
:443 {
    reverse_proxy farseer:8080
    tls internal
}
EOF

# Update docker-compose.yml
cat > docker-compose.yml << 'EOF'
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
EOF

# Restart services
docker-compose up -d --build
```

**Access:** `https://<proxmox-container-ip>` (self-signed cert)

---

## Option 2: Native Installation

Run Farseer natively without Docker (smaller footprint).

### Install Dependencies

```bash
# Install Go
apk add go

# Install Node.js and npm (for frontend build)
apk add nodejs npm

# Install git and build tools
apk add git gcc musl-dev
```

### Build and Run

```bash
# Clone repository
cd /opt
git clone https://github.com/your-repo/farseer.git
cd farseer

# Build frontend
cd frontend
npm install
npm run build
cd ..

# Build backend
cd backend
go mod download
go build -o farseer .

# Create data directory
mkdir -p /var/lib/farseer

# Run Farseer
./farseer
```

### Create OpenRC Service

Make Farseer start automatically:

```bash
# Create service file
cat > /etc/init.d/farseer << 'EOF'
#!/sbin/openrc-run

name="farseer"
description="Farseer SSH Web Client"
command="/opt/farseer/backend/farseer"
command_background="yes"
pidfile="/run/${RC_SVCNAME}.pid"
directory="/opt/farseer/backend"

start_pre() {
    export FARSEER_PORT=8080
    export FARSEER_CONFIG_DIR=/var/lib/farseer
    export FARSEER_DB_PATH=/var/lib/farseer/farseer.db
    export FARSEER_PRODUCTION=true
}

depend() {
    need net
}
EOF

# Make executable
chmod +x /etc/init.d/farseer

# Enable and start
rc-update add farseer default
rc-service farseer start

# Check status
rc-service farseer status
```

### Configure Reverse Proxy (Optional)

**Install Caddy:**

```bash
# Install Caddy
apk add caddy

# Create Caddyfile
cat > /etc/caddy/Caddyfile << 'EOF'
:443 {
    reverse_proxy localhost:8080
    tls internal
}
EOF

# Enable and start
rc-update add caddy default
rc-service caddy start
```

**Or use Nginx:**

```bash
# Install Nginx
apk add nginx

# Configure
cat > /etc/nginx/http.d/farseer.conf << 'EOF'
server {
    listen 80;
    server_name _;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name _;

    ssl_certificate /etc/ssl/certs/farseer.crt;
    ssl_certificate_key /etc/ssl/private/farseer.key;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
EOF

# Generate self-signed certificate
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/private/farseer.key \
  -out /etc/ssl/certs/farseer.crt \
  -subj "/CN=farseer"

# Enable and start
rc-update add nginx default
rc-service nginx start
```

---

## Networking & Access

### Static IP Configuration (LXC)

In Proxmox container:

```bash
# Edit network config
cat > /etc/network/interfaces << 'EOF'
auto lo
iface lo inet loopback

auto eth0
iface eth0 inet static
    address 192.168.1.100
    netmask 255.255.255.0
    gateway 192.168.1.1
EOF

# Apply changes
service networking restart
```

### Port Forwarding (if behind NAT)

In Proxmox host firewall:

```bash
# Forward external port 8443 to container port 443
iptables -t nat -A PREROUTING -p tcp --dport 8443 -j DNAT --to-destination 192.168.1.100:443
iptables -A FORWARD -p tcp -d 192.168.1.100 --dport 443 -j ACCEPT

# Save rules
iptables-save > /etc/iptables/rules.v4
```

### Firewall Configuration (Alpine)

```bash
# Install iptables
apk add iptables ip6tables

# Basic firewall rules
cat > /etc/iptables/rules << 'EOF'
*filter
:INPUT DROP [0:0]
:FORWARD DROP [0:0]
:OUTPUT ACCEPT [0:0]

# Allow loopback
-A INPUT -i lo -j ACCEPT

# Allow established connections
-A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

# Allow SSH (from Proxmox host)
-A INPUT -p tcp --dport 22 -j ACCEPT

# Allow HTTP/HTTPS
-A INPUT -p tcp --dport 80 -j ACCEPT
-A INPUT -p tcp --dport 443 -j ACCEPT

# Allow ping
-A INPUT -p icmp --icmp-type echo-request -j ACCEPT

COMMIT
EOF

# Apply rules
iptables-restore < /etc/iptables/rules

# Save on boot
cat > /etc/local.d/iptables.start << 'EOF'
#!/bin/sh
iptables-restore < /etc/iptables/rules
EOF

chmod +x /etc/local.d/iptables.start
rc-update add local default
```

---

## Backup Integration

### Proxmox Backup (LXC)

Proxmox can backup the entire container:

```bash
# From Proxmox host
vzdump 100 --mode snapshot --storage backup-storage

# Schedule automatic backups in Proxmox GUI:
# Datacenter > Backup > Add
```

### Application Data Backup

**Docker version:**

```bash
# Create backup script
cat > /opt/backup-farseer.sh << 'EOF'
#!/bin/sh
BACKUP_DIR=/opt/backups
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Backup Docker volume
docker run --rm \
  -v farseer-data:/data \
  -v $BACKUP_DIR:/backup \
  alpine tar czf /backup/farseer-data-$DATE.tar.gz -C /data .

# Keep only last 7 backups
cd $BACKUP_DIR
ls -t farseer-data-*.tar.gz | tail -n +8 | xargs -r rm

echo "Backup completed: farseer-data-$DATE.tar.gz"
EOF

chmod +x /opt/backup-farseer.sh

# Add to crontab (daily at 2 AM)
crontab -e
# Add: 0 2 * * * /opt/backup-farseer.sh
```

**Native version:**

```bash
# Backup script for native installation
cat > /opt/backup-farseer.sh << 'EOF'
#!/bin/sh
BACKUP_DIR=/opt/backups
DATE=$(date +%Y%m%d_%H%M%S)
DATA_DIR=/var/lib/farseer

mkdir -p $BACKUP_DIR

# Stop service
rc-service farseer stop

# Backup data
tar czf $BACKUP_DIR/farseer-data-$DATE.tar.gz -C $(dirname $DATA_DIR) $(basename $DATA_DIR)

# Restart service
rc-service farseer start

# Keep only last 7 backups
cd $BACKUP_DIR
ls -t farseer-data-*.tar.gz | tail -n +8 | xargs -r rm

echo "Backup completed: farseer-data-$DATE.tar.gz"
EOF

chmod +x /opt/backup-farseer.sh
```

---

## Troubleshooting

### Container/VM Issues

**Can't connect to container:**

```bash
# Check container status (from Proxmox host)
pct status 100

# Check networking
pct enter 100
ip addr
ping -c 4 8.8.8.8
```

**Out of disk space:**

```bash
# Check disk usage
df -h

# Resize container storage (from Proxmox host)
pct resize 100 rootfs +5G
```

### Docker Issues

**Docker won't start:**

```bash
# Check kernel features
cat /proc/sys/kernel/unprivileged_userns_clone
# Should be 1 for unprivileged containers

# Enable nesting if needed (from Proxmox host)
pct set 100 -features nesting=1
pct reboot 100
```

**Docker build fails (out of memory):**

```bash
# Increase container memory (from Proxmox host)
pct set 100 -memory 4096 -swap 1024
pct reboot 100
```

### Application Issues

**Can't access web interface:**

```bash
# Check if service is running
docker-compose ps  # Docker version
rc-service farseer status  # Native version

# Check ports
netstat -tlnp | grep 8080

# Check logs
docker-compose logs -f  # Docker version
tail -f /var/log/farseer.log  # Native version (if configured)
```

**SSH connections fail from Farseer:**

```bash
# Test outbound connectivity
nc -zv target-host 22

# Check DNS
nslookup target-host

# Verify firewall allows outbound
iptables -L OUTPUT -v -n
```

### Performance Tuning

**For better performance on Alpine:**

```bash
# Install and enable busybox-extras for better networking
apk add busybox-extras

# Increase file descriptors
echo "* soft nofile 65536" >> /etc/security/limits.conf
echo "* hard nofile 65536" >> /etc/security/limits.conf

# Tune sysctl (add to /etc/sysctl.conf)
cat >> /etc/sysctl.conf << 'EOF'
net.core.somaxconn = 1024
net.ipv4.tcp_max_syn_backlog = 2048
net.ipv4.ip_local_port_range = 1024 65535
EOF

sysctl -p
```

---

## Quick Start Summary

**Fastest path to running Farseer on Proxmox + Alpine:**

```bash
# 1. Create Alpine LXC container (from Proxmox)
pveam download local alpine-3.19-default_20240207_amd64.tar.xz
pct create 100 local:vztmpl/alpine-3.19-default_20240207_amd64.tar.xz \
  --hostname farseer --cores 2 --memory 2048 --features nesting=1
pct start 100
pct enter 100

# 2. Inside container - setup Alpine
setup-apkrepos -c -1
apk update && apk upgrade
apk add docker docker-compose git

# 3. Enable Docker
rc-update add docker boot
service docker start

# 4. Deploy Farseer
cd /opt
git clone https://github.com/your-repo/farseer.git
cd farseer
docker-compose up -d --build

# 5. Access
echo "Farseer running at http://$(hostname -i):8080"
```

Visit the IP address shown, complete the initial setup wizard, and start managing SSH connections!

---

## Additional Resources

- [Proxmox LXC Documentation](https://pve.proxmox.com/wiki/Linux_Container)
- [Alpine Linux Wiki](https://wiki.alpinelinux.org/)
- [Farseer Main Documentation](./CLAUDE.md)
- [Deployment Guide](./DEPLOYMENT.md)
