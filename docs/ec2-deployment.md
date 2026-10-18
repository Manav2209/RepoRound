# Deploy to EC2 over SSH

This automates the Docker installation, env-file parsing, image pulls, container replacement, Caddy HTTPS configuration, and smoke checks used in the practice deployment. It does not create EC2 instances, change security groups, resize disks, or run database migrations.

## One-time server setup

Use an Ubuntu amd64 instance. Permit public TCP 80 and 443. Supply the app's real credentials in `/home/ubuntu/ai-interview/backend.env`, `voice-agent.env`, and `evaluation-worker.env`, owned by the server user with mode `600`. Keep the directory private:

```bash
install -d -m 700 ~/ai-interview
chmod 600 ~/ai-interview/backend.env ~/ai-interview/voice-agent.env ~/ai-interview/evaluation-worker.env
```

These files can use ordinary dotenv quotes and comments, including Windows line endings. The deployment helper parses them with the same `dotenv` dependency as the backend and creates temporary Docker-compatible copies. It never prints their values. It overrides the public CORS origin, internal backend address, backend port, and voice-outbox location. LiveKit credentials and `INTERNAL_API_TOKEN` must match. If Langfuse is configured, supply its URL and both keys together; otherwise omit all three. A blank optional Langfuse configuration is omitted from the generated files.

The evaluation worker shares `DATABASE_URL`, the model-router settings, and `BULLMQ_REDIS_URL` with the backend, so those values must match across `backend.env` and `evaluation-worker.env`; the helper rejects mismatches before touching containers. Set `BULLMQ_REDIS_URL` in `backend.env` (the relay publishes evaluation intents there) and, for System Design mode, point `FALKORDB_HOST`/`FALKORDB_PORT`/`FALKORDB_GRAPH` at a reachable FalkorDB. Redis and FalkorDB remain external services; they are not started by these scripts.

Use your managed PostgreSQL URL, including provider-required TLS settings. Apply migrations manually before deploying a version that requires them. Do not remove quotes by copying a database password into a terminal command. The preflight opens the database and reads table counts without changing data.

## Configure GitHub

In repository Settings → Environments → `production`, add the environment secret below. Add the variables in Settings → Secrets and variables → Actions:

- Environment secret `EC2_SSH_PRIVATE_KEY`: the full SSH private key for this instance. Paste it directly into GitHub Secrets; do not commit it. It is scoped to the workflow's `production` environment.
- Variable `EC2_HOST`: `23.20.55.167` for the current practice instance.
- Variable `EC2_USER`: `ubuntu`.
- Variable `EC2_APP_DIR`: `/home/ubuntu/ai-interview`.
- Variable `NEXT_PUBLIC_BACKEND_URL`: `https://23.20.55.167.sslip.io`. CI uses it to build the web image, and deployment uses it as the public origin.
- Variable `EC2_KNOWN_HOSTS`: the verified host-key lines for this server from your local `known_hosts`. The workflow requires strict host verification.

On Windows, retrieve the public host keys you already accepted when connecting:

```powershell
ssh-keygen -F 23.20.55.167 -f "$env:USERPROFILE\.ssh\known_hosts"
```

Copy the lines containing the IP and host key, without the `# Host ...` comments. Verify the fingerprint using the EC2 console if you have not already verified it. If you replace the instance or its address, update both the host and known-host entries.

The server must allow SSH from the deployment runner. Your current “My IP” rule only allows your laptop, not GitHub-hosted runners. For restricted SSH access, use a runner with a fixed outbound address and allow that address on TCP 22; set `DEPLOY_RUNNER` to its unique runner label. GitHub-hosted runners have changing outbound addresses. For a short practice session you can temporarily widen SSH access, then restore the rule or terminate the instance. The workflow does not modify firewall rules. The Ubuntu user also needs noninteractive sudo, which the standard EC2 Ubuntu image normally provides.

`DOCKERHUB_TOKEN` stays in CI. The server pulls public Docker Hub repositories anonymously. For private repositories, configure the server's Docker credentials separately; do not send registry credentials in command arguments.

## Deploy a successful version

Commit and push these files first. In Actions → **Deploy EC2** → Run workflow, choose `main` and enter the full 40-character commit SHA from a successful **main-push** CI run. Manual CI runs only build and cannot supply published images.

The workflow checks the latest main-push CI result for that SHA, sends only deployment scripts over SSH, and executes them with sudo. It does not send application credentials through GitHub. To run the same scripts directly on the server after copying `scripts/deploy` there:

```bash
sudo bash scripts/deploy/bootstrap.sh
sudo bash scripts/deploy/deploy.sh \
  8292d536569e37983b4d6efebb5dd0dbf27a45f3 \
  https://23.20.55.167.sslip.io manav2854 /home/ubuntu/ai-interview
```

Deployment pulls all images and pins the local image IDs before changing containers. It parses credentials, validates configuration, checks database access and the auth/job tables, checks the web bundle's public URL, and validates Caddy configuration. A preflight failure leaves existing containers running. Insufficient disk space fails the deployment; images and volumes are never automatically pruned.

The script drains the voice worker while its backend is still available. Active interviews may take up to 65 minutes to finish; avoid beginning new sessions while deploying. It then replaces the backend, evaluation worker, web, voice worker, and proxy. The evaluation worker is stopped with a 300-second grace period so an in-flight evaluation can finish; the backend is started and healthy before the worker is replaced. Any intent published while the worker was down stays durable in PostgreSQL and is re-queued by the relay. There is brief downtime because this is a single-server deployment. The `voice-outbox`, `caddy-data`, and `caddy-config` volumes persist, and container logs are bounded.

After startup, it checks Docker health, public HTTPS, the frontend, and `POST /api/v1/auth/session`. That last smoke check creates one anonymous browser-access session and discards its token without logging it. Microphone access and a complete voice interview still require a manual check.

If replacement fails, the script attempts to restore the previous containers and proxy configuration. This is recovery of the previous configuration, not a guarantee that a previously broken deployment becomes healthy. It cannot undo database changes. Images are retained for manual rollback; choose an older compatible successful SHA in the same workflow. Do not roll back to an image that requires tables removed by a migration.

Once a manual deployment works, set `ENABLE_AUTO_DEPLOY=true` to deploy automatically after successful main-push CI runs. Leave it absent or `false` to keep the deployment button. The `production` GitHub environment can add reviewers or branch restrictions if desired. Deployment runs serialize rather than cancelling an in-progress voice drain.

After practice, terminate EC2 and remove any leftover billable disks or Elastic IPs. Stopping app containers does not stop AWS billing.

References: [GitHub workflow triggers](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow), [Docker Ubuntu installation](https://docs.docker.com/engine/install/ubuntu/), [Caddy Docker image](https://hub.docker.com/_/caddy).
