#!/bin/bash

# DigitalOcean Droplet Setup Script for Northhorr TVC Backend
# This script sets up a droplet with Docker, Docker Compose, and security configurations

set -e

echo "🚀 Starting Droplet Setup for Northhorr TVC Backend..."

# Update system
echo "📦 Updating system packages..."
apt-get update && apt-get upgrade -y

# Install required packages
echo "📦 Installing required packages..."
apt-get install -y curl git ufw fail2ban

# Install Docker
echo "🐳 Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    usermod -aG docker $USER
    rm get-docker.sh
else
    echo "Docker already installed"
fi

# Install Docker Compose
echo "🐳 Installing Docker Compose..."
if ! command -v docker-compose &> /dev/null; then
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
else
    echo "Docker Compose already installed"
fi

# Configure firewall
echo "🔒 Configuring firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 5000/tcp  # Backend API
ufw --force enable

# Configure fail2ban
echo "🔒 Configuring fail2ban..."
cat > /etc/fail2ban/jail.local <<EOF
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
EOF

systemctl enable fail2ban
systemctl start fail2ban

# Create application directory
echo "📁 Creating application directory..."
mkdir -p /opt/northhorr
cd /opt/northhorr

# Create .env file template
echo "📝 Creating .env file template..."
cat > .env <<EOF
# Database Configuration
DB_PASSWORD=CHANGE_THIS_STRONG_PASSWORD

# JWT Secret
JWT_SECRET=CHANGE_THIS_JWT_SECRET

# AWS Configuration
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=us-east-1
AWS_S3_BUCKET_NAME=northhorr

# Frontend URL
FRONTEND_URL=https://your-frontend-url.com
EOF

# Create backups directory
mkdir -p /opt/northhorr/backups

# Create database backup script
cat > /opt/northhorr/backup-db.sh <<'EOF'
#!/bin/bash
# Database backup script

BACKUP_DIR="/opt/northhorr/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/northhorr_backup_$TIMESTAMP.sql"

# Create backup
docker exec northhorr-postgres pg_dump -U northhorr_user northhorr > $BACKUP_FILE

# Compress backup
gzip $BACKUP_FILE

# Keep only last 7 days of backups
find $BACKUP_DIR -name "northhorr_backup_*.sql.gz" -mtime +7 -delete

echo "Backup completed: $BACKUP_FILE.gz"
EOF

chmod +x /opt/northhorr/backup-db.sh

# Add cron job for daily backups at 2 AM
(crontab -l 2>/dev/null; echo "0 2 * * * /opt/northhorr/backup-db.sh >> /var/log/northhorr-backup.log 2>&1") | crontab -

# Create log rotation config
cat > /etc/logrotate.d/northhorr <<EOF
/var/log/northhorr-backup.log {
    daily
    rotate 7
    compress
    missingok
    notifempty
    create 644 root root
}
EOF

# Set up swap space (optional, for memory optimization)
echo "💾 Setting up swap space..."
if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
else
    echo "Swap file already exists"
fi

# Optimize system settings for PostgreSQL
echo "⚙️ Optimizing system settings..."
cat >> /etc/sysctl.conf <<EOF
# PostgreSQL optimization
vm.swappiness=10
vm.dirty_ratio=15
vm.dirty_background_ratio=5
net.core.somaxconn=1024
net.ipv4.tcp_max_syn_backlog=1024
EOF

sysctl -p

echo "✅ Droplet setup completed!"
echo ""
echo "Next steps:"
echo "1. Update /opt/northhorr/.env with your actual values"
echo "2. Clone your repository or copy application files to /opt/northhorr"
echo "3. Run: docker-compose up -d"
echo "4. Run: docker-compose exec backend npx prisma db push"
echo "5. Run: docker-compose exec backend npm run db:seed"
echo ""
echo "Security reminders:"
echo "- Change the default passwords in .env"
echo "- Set up SSH key authentication"
echo "- Configure SSL/TLS certificate for HTTPS"
