# Docker Operational Guide

This document explains how to build, run, and maintain the application using Docker.

---

## Local Development

### Prerequisites

- Docker Desktop (macOS/Windows) or Docker Engine + Docker Compose plugin (Linux)
- A filled-in `.env` file (copy `.env.example` to `.env` and fill in values)

### Dev model: app on host, Postgres + Redis in Docker

Start the infrastructure containers:

```bash
docker compose up -d
```

Postgres is exposed on host port **5433**, Redis on **6380**. Configure `.env`:

```
DATABASE_HOST=localhost
DATABASE_PORT=5433
REDIS_HOST=localhost
REDIS_PORT=6380
```

Then run the app on the host:

```bash
go run cmd/web/main.go
# or
make run
```

### Stop everything

```bash
docker compose down
```

This stops containers but keeps the Postgres data volume. To also delete all data:

```bash
docker compose down -v
```

### Running tests

**Unit tests** have no external dependencies and can always be run directly:

```bash
go test ./test/unit/... -v
# or
make test-unit
```

**Integration tests** run on the host against dedicated test containers from `docker-compose.test.yml`.
They use Fiber's `app.Test()` helper in-memory — no HTTP server needed, just a real database and Redis.

```bash
# Start test containers (one-time per session)
docker compose -f docker-compose.test.yml up -d

# Run integration tests
go test ./test/integration/... -v
# or
make test-integration

# Stop and clean up test containers
docker compose -f docker-compose.test.yml down -v
```

**Port mapping for test containers:**

- postgres-test: host port **5434** → container 5432
- redis-test: host port **6381** → container 6379

`.env.test` should use these ports:

```
DATABASE_HOST=localhost
DATABASE_PORT=5434
DATABASE_NAME=reisify_test
REDIS_HOST=localhost
REDIS_PORT=6381
REDIS_DB=1
```

---

## Building the Production Image

Build and tag the image:

```bash
docker build -t reisify:latest .
```

Tag for a registry (e.g., GitHub Container Registry):

```bash
docker tag reisify:latest ghcr.io/youruser/reisify:latest
docker push ghcr.io/youruser/reisify:latest
```

---

## Production Deployment (Single VPS)

### First-time VPS setup

**1. Install Docker Engine:**
Follow the official guide: https://docs.docker.com/engine/install/ubuntu/

**2. Configure native Postgres to accept Docker connections:**

The app container connects to Postgres on the host machine. Postgres must be configured
to listen on the Docker bridge interface and accept connections from Docker's subnet.

Edit `postgresql.conf` (usually `/etc/postgresql/<version>/main/postgresql.conf`):

```
listen_addresses = '*'
```

Edit `pg_hba.conf` (usually `/etc/postgresql/<version>/main/pg_hba.conf`), add:

```
host  all  all  172.17.0.0/16  scram-sha-256
```

`172.17.0.0/16` is Docker's default bridge subnet on Linux.

Restart Postgres:

```bash
sudo systemctl restart postgresql
```

**3. Create a `.env` file on the VPS** (never commit this to git):

```bash
# /home/deploy/.env  (or wherever you run docker compose)
DATABASE_USERNAME=your_db_user
DATABASE_PASSWORD=your_db_password
DATABASE_PORT=5432
DATABASE_NAME=reisify
# use 'require' or 'verify-full' in production
DATABASE_SSLMODE=require
# Must be at least 32 characters: openssl rand -hex 32
JWT_SECRET=your_jwt_secret_min_32_chars
REDIS_DB=0
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password
# Comma-separated allowed frontend origins
ALLOWED_ORIGINS=https://app.example.com
# Set to true when serving over HTTPS
COOKIE_SECURE=true
APP_IMAGE=ghcr.io/youruser/reisify:latest
```

### Deploy

```bash
# Pull the latest image
docker compose -f docker-compose.prod.yml pull

# Start (or restart) containers
docker compose -f docker-compose.prod.yml up -d
```

### View production logs

```bash
docker compose -f docker-compose.prod.yml logs -f app
```

### Stop production containers

```bash
docker compose -f docker-compose.prod.yml down
```

---

## Troubleshooting

### Migrations fail with "dirty database version"

This means a previous migration failed partway through. Fix:

1. Check which version is dirty: `docker compose logs app | grep "dirty"`
2. SSH into the VPS and run the migrate CLI manually:
   ```bash
   migrate -database "postgres://user:pass@host:5432/dbname?sslmode=disable" \
           -path /path/to/db/migrations \
           force <last-good-version-number>
   ```
3. Fix the migration SQL if needed, then redeploy.

### App cannot connect to Postgres in production

Checklist:

- Is Postgres running? `sudo systemctl status postgresql`
- Does `pg_hba.conf` allow `172.17.0.0/16`? Check with `sudo cat /etc/postgresql/*/main/pg_hba.conf`
- Is `listen_addresses = '*'` set in `postgresql.conf`?
- Did you restart Postgres after the config change? `sudo systemctl restart postgresql`
- Test from inside the container: `docker compose -f docker-compose.prod.yml exec app pg_isready -h host.docker.internal -U $DATABASE_USERNAME`

### Port 3000 is already in use

Another process is using port 3000. Find it:

```bash
sudo lsof -i :3000
```

Kill it or change the port mapping in the compose file (`"3001:3000"` to expose on a different host port).

### Container health check is failing

```bash
docker inspect $(docker compose ps -q app) | grep -A 10 '"Health"'
```

This shows the last health check result and exit code.
