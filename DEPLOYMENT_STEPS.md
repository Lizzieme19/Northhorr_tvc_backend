# Step-by-Step Deployment Guide

Follow these steps exactly to deploy your backend with self-hosted PostgreSQL.

## Step 1: Create DigitalOcean Droplet

1. Go to DigitalOcean → Droplets → Create Droplet
2. Choose:
   - **Image**: Ubuntu 22.04 LTS
   - **Size**: Basic - $6/month (2GB RAM, 1 CPU)
   - **Region**: Nairobi (or closest to you)
   - **Authentication**: SSH Key (recommended) or Password
   - **Hostname**: northhorr-backend
3. Click "Create Droplet"
4. Wait 1-2 minutes for droplet to be ready
5. Copy the droplet IP address

## Step 2: SSH into Droplet

```bash
ssh root@your-droplet-ip
```

If using password, enter the password sent to your email.

## Step 3: Run Setup Script

```bash
# Create directory
mkdir -p /opt/northhorr/scripts

# Copy setup script from your local machine (run this on your LOCAL machine)
scp scripts/setup-droplet.sh root@your-droplet-ip:/opt/northhorr/scripts/

# Back on the droplet
chmod +x /opt/northhorr/scripts/setup-droplet.sh
/opt/northhorr/scripts/setup-droplet.sh
```

This will install Docker, Docker Compose, configure firewall, and set up backups.

## Step 4: Copy Application Files to Droplet

### Option A: Clone Repository (if public)

```bash
cd /opt/northhorr
git clone https://github.com/Lizzieme19/Northhorr_tvc_backend.git .
```

### Option B: Copy via SCP (from your local machine)

```bash
# Run this on your LOCAL machine
scp -r . root@your-droplet-ip:/opt/northhorr/
```

## Step 5: Configure Environment Variables

```bash
cd /opt/northhorr
nano .env
```

Paste this and fill in your actual values (use quotes for values with special characters):

```env
# Database Password
DB_PASSWORD="your_strong_password_here"

# JWT Secret (generate with: openssl rand -base64 32)
JWT_SECRET="your_jwt_secret_here"
JWT_REFRESH_SECRET="your_jwt_refresh_secret_here"
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# AWS S3 Configuration
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
AWS_REGION=ap-south-1
AWS_S3_BUCKET_NAME=northhorr

# Backblaze B2 (S3-compatible)
B2_ENDPOINT=https://s3.us-east-005.backblazeb2.com
B2_REGION=us-east-005
B2_KEY_ID=your_b2_key_id
B2_APP_KEY=your_b2_app_key
B2_BUCKET_NAME=northhorr
B2_BUCKET_ID=your_b2_bucket_id

# Email Configuration
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD="your-app-password"
EMAIL_FROM=northhorrtvc@gmail.com

# Frontend URL (CHANGE THIS to your Vercel URL)
FRONTEND_URL=https://your-vercel-app.vercel.app
```

Save and exit (Ctrl+X, Y, Enter).

## Step 6: Start Services

```bash
cd /opt/northhorr
docker-compose up -d
```

This will:
- Start PostgreSQL database
- Build and start backend application
- Create network and volumes

## Step 7: Run Database Migrations

```bash
docker-compose exec backend npx prisma db push
```

This creates all database tables.

## Step 8: Seed Database with Initial Data

```bash
docker-compose exec backend npm run db:seed
```

This will:
- Create admin user: `admin@ntvc.ac.ke` / `Admin@NTVC2026`
- Create finance user: `finance@ntvc.ac.ke` / `Finance@NTVC2026`
- Seed 9 departments with courses

## Step 9: Verify Deployment

```bash
# Check container status
docker-compose ps

# Check logs
docker-compose logs backend

# Test health endpoint
curl http://localhost:5000/health
```

Expected response:
```json
{
  "status": "ok",
  "service": "NTVC Backend",
  "timestamp": "2024-07-14T..."
}
```

## Step 10: Configure GitHub Secrets (for CI/CD)

Add these to your GitHub repository (Settings → Secrets and variables → Actions):

| Secret Name | Value |
|-------------|-------|
| `DROPLET_IP` | Your droplet IP address |
| `DROPLET_SSH_KEY` | Your SSH private key (from `~/.ssh/id_rsa`) |

To get your SSH key:
```bash
# On your local machine
cat ~/.ssh/id_rsa
```

Copy the entire content (including `-----BEGIN...` and `-----END...`).

## Step 11: Test CI/CD

Push to `main` branch:
```bash
git add .
git commit -m "Deploy to production"
git push origin main
```

The GitHub Actions workflow will:
1. SSH into droplet
2. Pull latest code
3. Build Docker image
4. Restart services
5. Run migrations

## Troubleshooting

### Container won't start
```bash
docker-compose logs backend
docker-compose logs postgres
```

### Database connection issues
```bash
# Check if PostgreSQL is running
docker-compose exec postgres pg_isready -U northhorr_user

# Test connection
docker exec -it northhorr-postgres psql -U northhorr_user -d northhorr
```

### Seed fails
```bash
# Run seed manually
docker-compose exec backend npm run db:seed
```

### Out of memory
```bash
# Check memory
free -h
docker stats

# Restart services
docker-compose restart
```

## Security Checklist

- [ ] Change default admin password after first login
- [ ] Set up SSH key authentication (disable password login)
- [ ] Configure SSL/TLS certificate (run `scripts/setup-ssl.sh`)
- [ ] Set up firewall rules (already done by setup script)
- [ ] Enable automatic security updates
- [ ] Regularly update system packages

## Summary

After completing these steps, you will have:
- ✅ Running PostgreSQL database
- ✅ Running backend API
- ✅ Seeded database with departments and courses
- ✅ Admin and finance users created
- ✅ Automated backups configured
- ✅ CI/CD pipeline active

Total cost: ~$6/month

Stop containers - docker-compose down (keeps PostgreSQL data intact)
Rebuild and start - docker-compose up -d --build rebuilds the backend image with
✅ Admin user: admin@ntvc.ac.ke / Admin@NTVC2026
✅ Finance user: finance@ntvc.ac.ke / Finance@NTVC2026
✅ HR user: hr@ntvc.ac.ke / HR@NTVC2026
✅ Procurement user: procurement@ntvc.ac.ke / Procurement@NTVC2026
✅ Staff user: staff@ntvc.ac.ke / Staff@NTVC2026
