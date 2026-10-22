#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

die() { echo "Deployment error: $*" >&2; exit 1; }
[[ $# == 4 ]] || die "Usage: sudo bash deploy.sh COMMIT_SHA HTTPS_ORIGIN DOCKERHUB_USER APP_DIR"
[[ $EUID == 0 ]] || die "Run this script with sudo."
sha=$1
origin=$2
registry_user=$3
app_dir=$4
[[ $sha =~ ^[a-f0-9]{40}$ ]] || die "Use a full lowercase commit SHA."
[[ $origin =~ ^https://[a-zA-Z0-9.-]+$ ]] || die "Use an HTTPS hostname without a path or port."
[[ $registry_user =~ ^[a-z0-9][a-z0-9_-]*$ ]] || die "Invalid Docker Hub namespace."
[[ $app_dir == /* && -d $app_dir ]] || die "APP_DIR must be an existing absolute directory."
app_dir=$(realpath "$app_dir")
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
for tool in docker curl flock; do command -v "$tool" >/dev/null || die "$tool is required."; done
[[ $(docker info --format '{{.Architecture}}') =~ ^(x86_64|amd64)$ ]] || die "The images require an amd64 Docker host."
for file in backend.env voice-agent.env evaluation-worker.env; do
  [[ -f $app_dir/$file ]] || die "Create $app_dir/$file first."
  chmod 600 "$app_dir/$file"
done
exec 9>"$app_dir/.deploy.lock"
flock -n 9 || die "Another deployment is already running."

runtime_dir=$(mktemp -d "$app_dir/.runtime.XXXXXXXX")
attempt="$(date +%s)-$$"
declare -A previous=()
created=()
mutating=false
success=false
config_existed=false
network=ai-interview
apps=(backend web voice-agent evaluation-worker)
declare -A image=()
log_options=(--log-driver local --log-opt max-size=10m --log-opt max-file=2)

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ $success != true && $mutating == true ]]; then
    echo "Deployment failed; restoring the previous containers." >&2
    for name in "${created[@]}"; do docker rm -f "$name" >/dev/null 2>&1 || true; done
    if [[ $config_existed == true ]]; then
      cp "$runtime_dir/Caddyfile.previous" "$app_dir/caddy/Caddyfile"
    else
      rm -f "$app_dir/caddy/Caddyfile"
    fi
    for name in backend web voice-agent evaluation-worker caddy; do
      if [[ -n ${previous[$name]:-} ]]; then
        docker rename "${previous[$name]}" "$name" || true
        docker start "$name" >/dev/null || true
      fi
    done
    echo "Inspect container status; restoring containers cannot undo a database migration." >&2
  fi
  if [[ $runtime_dir == "$app_dir"/.runtime.* ]]; then rm -rf -- "$runtime_dir"; fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "Pulling all images before changing running containers."
for name in "${apps[@]}"; do
  ref="${registry_user}/ai-interview-${name}:sha-${sha}"
  docker pull "$ref"
  image[$name]=$(docker image inspect "$ref" --format '{{.Id}}')
done
docker pull caddy:2.11.7
caddy_image=$(docker image inspect caddy:2.11.7 --format '{{.Id}}')

docker run --rm --network none --user 0:0 --entrypoint bun \
  -e "PUBLIC_ORIGIN=$origin" \
  -v "$script_dir/prepare-env.mjs:/app/scripts/deploy/prepare-env.mjs:ro" \
  -v "$app_dir/backend.env:/run/backend.input:ro" \
  -v "$app_dir/voice-agent.env:/run/voice.input:ro" \
  -v "$app_dir/evaluation-worker.env:/run/worker.input:ro" \
  -v "$runtime_dir:/run/output" \
  "${image[backend]}" /app/scripts/deploy/prepare-env.mjs

echo "Checking backend configuration and database tables without modifying data."
docker run --rm --env-file "$runtime_dir/backend.env" --entrypoint bun \
  "${image[backend]}" -e '
    import { loadConfig } from "./src/config.ts";
    import { PrismaClient } from "/app/packages/db/generated/client/index.js";
    let db;
    try {
      loadConfig();
      db = new PrismaClient({ log: [] });
      await Promise.all([
        db.user.count(), db.session.count(), db.account.count(),
        db.rateLimitBucket.count(), db.interviewJob.count(),
      ]);
      console.log("Backend configuration and database preflight passed.");
    } catch (error) {
      console.error("Backend/database preflight failed:", error.code || error.errorCode || error.name);
      process.exitCode = 1;
    } finally { await db?.$disconnect(); }
  '
docker run --rm --network none --env-file "$runtime_dir/voice-agent.env" --entrypoint bun \
  "${image[voice-agent]}" -e 'import { loadConfig } from "@repo/providers"; loadConfig(); console.log("Voice configuration passed.");'
docker run --rm --network none --env-file "$runtime_dir/evaluation-worker.env" --entrypoint bun \
  "${image[evaluation-worker]}" -e 'import { loadWorkerConfig } from "@repo/backend/evaluation"; loadWorkerConfig(); console.log("Evaluation worker configuration passed.");'

[[ $(df -Pk "$app_dir" | awk 'NR==2 {print $4}') -gt 262144 ]] || die "Less than 256 MiB remains after pulling images; free space before deploying."
docker network inspect "$network" >/dev/null 2>&1 || docker network create "$network" >/dev/null
mkdir -p "$app_dir/caddy"
if [[ -f $app_dir/caddy/Caddyfile ]]; then
  config_existed=true
  cp "$app_dir/caddy/Caddyfile" "$runtime_dir/Caddyfile.previous"
fi
cat > "$runtime_dir/Caddyfile" <<EOF
${origin#https://} {
    handle /api/* {
        reverse_proxy backend:8080 {
            header_up X-RepoRound-Client-IP {remote_host}
            header_up X-RepoRound-Proxy-Token {\$TRUSTED_PROXY_TOKEN}
        }
    }
    handle /health {
        reverse_proxy backend:8080
    }
    handle {
        reverse_proxy web:3000
    }
}
EOF
docker run --rm --network none --env-file "$runtime_dir/proxy.env" -v "$runtime_dir/Caddyfile:/etc/caddy/Caddyfile:ro" \
  "$caddy_image" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

retire() {
  local name=$1
  if docker container inspect "$name" >/dev/null 2>&1; then
    previous[$name]="$name"
    echo "Stopping $name."
    if [[ $name == voice-agent ]]; then
      docker stop --time 3900 "$name" >/dev/null
    elif [[ $name == evaluation-worker ]]; then
      # Let an in-flight evaluation finish before the container is replaced.
      docker stop --time 300 "$name" >/dev/null
    else
      docker stop --time 30 "$name" >/dev/null
    fi
    # Keep the original name recorded if the rename itself fails.
    docker rename "$name" "$name-previous-$attempt"
    previous[$name]="$name-previous-$attempt"
  fi
}
wait_healthy() {
  local name=$1 timeout=$2 deadline=$((SECONDS + $2)) state health
  while (( SECONDS < deadline )); do
    state=$(docker inspect "$name" --format '{{.State.Status}}')
    health=$(docker inspect "$name" --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}')
    [[ $state == running && $health == healthy ]] && return 0
    [[ $state != exited && $state != dead && $state != restarting && $health != unhealthy ]] || die "$name failed its startup/health check."
    sleep 3
  done
  die "$name did not become healthy within $timeout seconds."
}

mutating=true
# Drain while the original backend is still available to active interviews.
retire voice-agent
retire evaluation-worker
retire backend
retire web
retire caddy
cp "$runtime_dir/Caddyfile" "$app_dir/caddy/Caddyfile"
chmod 644 "$app_dir/caddy/Caddyfile"

created+=(backend)
docker run -d --name backend --network "$network" --network-alias backend \
  --restart unless-stopped "${log_options[@]}" \
  --env-file "$runtime_dir/backend.env" "${image[backend]}" >/dev/null
wait_healthy backend 120
created+=(evaluation-worker)
docker run -d --name evaluation-worker --network "$network" \
  --restart unless-stopped --stop-timeout 300 "${log_options[@]}" \
  --env-file "$runtime_dir/evaluation-worker.env" \
  "${image[evaluation-worker]}" >/dev/null
wait_healthy evaluation-worker 60
created+=(web)
docker run -d --name web --network "$network" --network-alias web \
  --restart unless-stopped "${log_options[@]}" "${image[web]}" >/dev/null
wait_healthy web 120
created+=(voice-agent)
docker run -d --name voice-agent --network "$network" \
  --restart unless-stopped --stop-timeout 3900 "${log_options[@]}" \
  --env-file "$runtime_dir/voice-agent.env" \
  -v voice-outbox:/app/data/voice-outbox "${image[voice-agent]}" >/dev/null
wait_healthy voice-agent 180
created+=(caddy)
docker run -d --name caddy --network "$network" --restart unless-stopped \
  --env-file "$runtime_dir/proxy.env" \
  "${log_options[@]}" -p 80:80 -p 443:443 \
  -v "$app_dir/caddy:/etc/caddy:ro" -v caddy-data:/data -v caddy-config:/config \
  "$caddy_image" >/dev/null

echo "Waiting for public HTTPS and API access."
curl --fail --silent --show-error --connect-timeout 5 --max-time 10 \
  --retry 30 --retry-delay 2 --retry-all-errors --retry-max-time 300 "$origin/health"
curl --fail --silent --show-error --connect-timeout 5 --max-time 15 "$origin/" -o /dev/null
# Exercise Better Auth through Caddy without creating an account or session.
auth_code=$(curl --silent --show-error --connect-timeout 5 --max-time 20 \
  "$origin/api/auth/get-session" -o /dev/null -w '%{http_code}')
[[ $auth_code == 200 ]] || die "Auth smoke check returned HTTP $auth_code."

printf '%s\n' "$sha" > "$app_dir/deployed-sha"
success=true
for name in "${!previous[@]}"; do
  docker rm "${previous[$name]}" >/dev/null || echo "Could not remove stopped backup container ${previous[$name]}." >&2
done
echo "Deployment succeeded: $origin (commit $sha)."
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
df -h "$app_dir"
