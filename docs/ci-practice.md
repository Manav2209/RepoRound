# Practice GitHub Actions CI

Run the commands below from `my-turborepo`, the Git repository inside `ai-interview`.

The workflow is `.github/workflows/ci.yml`. It runs on pull requests, pushes to `main`, and manual dispatch. It uses Node.js 24 and Bun 1.4.2, matching the Dockerfiles.

## 1. Understand the workflow

`Code checks` installs the exact dependencies in `bun.lock`, generates the Prisma client, runs lint and TypeScript checks, runs backend unit tests, and builds the workspace.

After those checks pass, three `Docker` jobs build the backend, web, and voice-agent images in parallel. Each uses the repository root as its build context. Their caches have separate scopes. A failure in one image does not cancel the other image builds.

Pull requests and manual runs only build images. A push to `main` also logs in to Docker Hub and publishes each successful image under `manav2854`. Tags use `sha-<full commit SHA>`, so the three images from a run share a version. No `latest` tag is updated. Each publishing job records the image reference and registry digest in its run summary.

`CI passed` succeeds only when the checks and all three Docker jobs succeed, including uploads on `main`. It also fails if an upstream job was skipped or cancelled, so it can serve as the required check before merging. If one image fails, another image may already have been published; wait for the entire run to pass before deploying that commit's image set.

CI uses a placeholder `DATABASE_URL` for client generation. This command does not connect to a database. No database or provider credentials are needed. Images are built for `linux/amd64`. Production migrations remain manual. The separate [Deploy EC2 workflow](ec2-deployment.md) automates deployment of successful published versions after its SSH setup is complete.

Newer runs cancel older pull-request and manual runs for the same ref. Main pushes finish their uploads without that cancellation; always use a specific commit tag to choose the version you deploy.

## 2. Run the code checks locally

Use Node.js 24 and Bun 1.4.2. In PowerShell, set a placeholder URL for this terminal session so client generation does not depend on your local database configuration:

```powershell
node --version
bun --version
$env:DATABASE_URL = 'postgresql://ci:ci@127.0.0.1:5432/ai_interviewer_ci?schema=public'
$env:NEXT_TELEMETRY_DISABLED = '1'
bun install --frozen-lockfile --network-concurrency=8
bun run db:generate
bun run lint
bun run check-types
bun run --cwd apps/backend test
bun run build
```

Run commands one at a time and fix a failure before continuing. This terminal's database URL is deliberately unusable: do not run migration commands here. Close the terminal when finished to discard these environment overrides.

To reproduce the Docker jobs, start Docker Desktop in Linux container mode and run:

```powershell
docker build -f apps/backend/Dockerfile -t ai-interview-backend:ci .
docker build -f apps/web/Dockerfile -t ai-interview-web:ci .
docker build -f apps/voice-agent/Dockerfile -t ai-interview-voice-agent:ci .
```

## 3. Commit and push a practice branch

```powershell
git switch -c practice/ci
git status --short
git diff
```

There are existing database-package and Docker changes in this working tree. The workflow depends on those changes, including `packages/db`, its backend imports, `bun.lock`, `turbo.json`, `.dockerignore`, all three Dockerfiles, and the web standalone configuration. Include them in your branch if they are not already committed. Committing only the workflow would leave GitHub building the older repository state.

Review and stage the intended changes using explicit paths. For the CI files themselves:

```powershell
git add .github/workflows/ci.yml docs/ci-practice.md
git add -p package.json README.md
```

Stage the prerequisite changes after reviewing them. Inspect the full staged patch and file list before committing:

```powershell
git diff --cached
git diff --cached --name-only
git commit -m "Add GitHub Actions CI and practice guide"
git push -u origin practice/ci
```

Keep actual `.env` files, credentials, generated Prisma files, and local build outputs out of the commit. `.env.example` files contain configuration examples and can be committed.

## 4. Configure Docker Hub and open a pull request

Create a [Docker Hub personal access token](https://docs.docker.com/security/access-tokens/personal-access-tokens/) for your `manav2854` account with read and write access. In the GitHub repository, open **Settings → Secrets and variables → Actions → Secrets → New repository secret**. Name it `DOCKERHUB_TOKEN` and paste the token as its value. Store it directly in GitHub's secret form.

Your Docker Desktop login was enough for the manual uploads. GitHub's runners need their own credential; your local Docker login is not transferred to Actions.

Under the **Variables** tab, you can optionally set:

- `DOCKERHUB_USERNAME`: defaults to `manav2854`. Change it only when using a token and image repositories for another Docker Hub account.
- `PUBLIC_ORIGIN`: the public HTTPS origin used by the deploy workflow. The web image contains no backend URL because production serves `/api/*` through Caddy on the same origin.

The three Docker Hub repositories already exist from the manual upload: `manav2854/ai-interview-backend`, `manav2854/ai-interview-web`, and `manav2854/ai-interview-voice-agent`.

On GitHub, open a pull request from `practice/ci` into `main`. Open its Checks tab, or the repository's Actions tab and select `CI`.

Expand `Code checks` and inspect each step's command, output, and duration. After it succeeds, inspect the three Docker jobs. A skipped Docker job usually means `Code checks` failed; inspect that failure first. Check that `CI passed` is green.

The first build may be slower because Docker caches are empty. Future runs can reuse layers. A cache speeds up builds; it does not replace any checks.

The pull-request run does not log in to Docker Hub or publish images. When you merge, the resulting push to `main` starts a new run that publishes images after code checks pass. Without `DOCKERHUB_TOKEN`, the main run fails at `Check Docker Hub token` with a setup message.

## 5. Deliberately fail CI and fix it

On your practice branch, temporarily append this assertion to `apps/backend/src/github/context.test.ts`:

```typescript
test("CI practice: intentional failure", () => {
  expect(1 + 1).toBe(3);
});
```

That file already imports `test` and `expect`. Commit and push the deliberate failure:

```powershell
git add apps/backend/src/github/context.test.ts
git commit -m "Practice diagnosing a failing CI test"
git push
```

In Actions, find the failed `Test backend` step. Read the assertion output. Notice that Docker builds are skipped and `CI passed` fails.

Remove the temporary test, run the backend tests locally, then commit and push the fix:

```powershell
bun run --cwd apps/backend test
git add apps/backend/src/github/context.test.ts
git commit -m "Fix the intentional CI practice failure"
git push
```

The new commit triggers a new run. Re-running jobs on the old commit would still run the broken test. Use **Re-run failed jobs** for a transient failure, such as a network timeout; use a new commit for a code fix. Finish with a green run before merging.

## 6. Practice merge protection and manual runs

After the first run, create a rule for `main` in the repository's branch protection or ruleset settings. Require a pull request and the `CI passed` status check before merging, if these controls are available for your repository and GitHub plan.

Once the workflow is merged into `main`, open **Actions → CI → Run workflow**, choose a branch, and start a manual run. Manual dispatch becomes available after the workflow exists on the default branch.

Manual runs do not publish images, even when you select `main`. To practice publishing, merge another small, working change into `main`, then open that push's Actions run. Wait for `CI passed` to succeed and copy the image references from the Docker job summaries. Pull them locally using the full commit SHA from that run:

```powershell
$ciCommit = '<full commit SHA from the successful main run>'
docker pull "manav2854/ai-interview-backend:sha-$ciCommit"
docker pull "manav2854/ai-interview-web:sha-$ciCommit"
docker pull "manav2854/ai-interview-voice-agent:sha-$ciCommit"
```

If Docker Hub login or upload fails, check token permissions, expiration, and whether it belongs to the configured account. If an upload fails temporarily, re-run the failed jobs on the same commit; the image tags stay the same. Read the code-check or Docker build logs first for installation and compilation failures.

## What comes after CI

A green run proves the included checks and image builds passed. It does not verify live microphone behavior, provider credentials, database migrations, or a complete interview with external services.

After CI publishes a complete image set, practice pulling a specific image version, supplying runtime secrets, applying managed-database migrations manually, starting the services, checking a real interview, and rolling back an application image when the database schema permits it.

The workflow publishes application images on `main` pushes. It does not connect to your managed database or start your deployed services. [GitHub's publishing guide](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images) explains the registry login and upload actions used here.
