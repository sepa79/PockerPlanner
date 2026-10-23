# HiveForge deployment

This repository uses HiveForge manifest version 0.5. Project: `pocketplanner`; component: `planner`; profile: `swarm`; actions: `deploy` and `update`. Project Ansible renders `/hf/stacks/compose.yml`; HiveForge owns Docker deployment execution. No Docker socket or direct host deployment is required by the project playbook.

Prepare through HiveForge MCP: inspect the repository/ref, register the approved project/ref, set environment policy, set runtime values, validate requirements, then execute the approved lifecycle action. This repository does not guess an environment or automatically deploy to one.

## Local Java/React build status

The root Dockerfile builds the React UI with the actual shared PH npm inputs,
verifies the Java 21 application, and runs its UI/API/SSE/MCP in one non-root JRE
container. There is no Python or Node runtime service. The local image build
passes 219 frontend and 621 Java tests, plus 14 deployment configuration checks.
Isolated Compose browser and volume-recreation persistence pass; real PH journal
handoff preserves the run and sends authorization without another credential
entry. Real local PH acceptance also verifies journal data HTTP 200, creation
with Plan/Stream/Activity, multiple Activity associations and Start/Stop from PP
against an owned WireMock-only QA swarm. Desktop forwarded-preview login/restart
remains unverified. No lab deployment was performed.

No Java/React image or Git ref has been published by this local work. Do not use
an older GHCR release and claim it contains the new stack. Local Compose may build
an isolated test image; an HF deployment needs an explicitly approved published
Java image/ref available to its nodes. This documentation update does not
authorize publication, remote lab actions, or operational data export/copy/import.

## Agent deployment playbook

Local release 0.2.3 was prepared on 2026-10-23 as
`pocketplanner-local:0.2.3`; exact image identity, source/build/browser checks
and residual security findings are recorded in `docs/RELEASE_VERIFICATION.md`
and `docs/SECURITY_REVIEW.md`. That linux/amd64 image exists only in the local
Docker engine. No source ref or registry image was published, and no
existing deployment was replaced. Do not start an HF action with this local tag
and assume the nodes can pull it. Publication/distribution, an approved immutable
source/image reference and operational switch-over still need explicit approval.

Use this checklist when the human authorizes deployment. Do not substitute direct Docker/SSH deployment for HiveForge, and do not update PocketHive or another project to make this one deploy.

1. Read `AGENTS.md` and `docs/ARCHITECTURE.md`. Obtain the approved target, immutable Git ref, published image digest, deployment name, port, and pinned node. If publication is not requested, do not commit/push or claim that a local change is available in GHCR.
2. Call `check_health`, `get_hiveforge_info`, `list_environments`, `list_environment_nodes`, `list_projects`, and `list_deployments`. Confirm the selected target rather than assuming the active MCP server is the intended lab. The environment must provide Docker Swarm, placement, and a shared managed root.
3. Call `inspect_repository` with the approved repository and ref, then `register_project` if that ref is not already approved. Use `registrationKind: official` for the public GitHub release; a development variant must be explicitly chosen for a separate development repository.
4. Call `set_environment_project_policy` only when the requested project/profile/action is not already permitted. Restrict it to `projectId: pocketplanner`, `profiles: [swarm]`, and the declared actions `deploy`/`update`; do not broaden other policies.
5. Set the required non-secret values below through `set_project_runtime_env`, scoped to `profile: swarm`. For remote MCP, also set its exact Host allowlist. Auth is optional; use `unset_project_runtime_env` to remove an obsolete auth value rather than guessing an endpoint. Never put a bearer token into runtime env, source, or rendered Compose.
6. Call `refresh_environment`, then `verify_managed_root_access` before the first deployment or after node/mount changes. Do not declare storage safe based only on the path name.
7. Call `inspect_project`, `explain_deploy_prerequisites` for the chosen action, and `validate_requirements`. Stop on missing runtime/capability/policy/configuration; do not invent a fallback profile.
8. Call `start_action` with the exact project/ref/component/profile/action/name. Poll the returned `operationId` through `get_operation`. Rendering/deployment submission succeeding is not proof that the application is ready.
9. On success, use `result.actionOperationId` from the completed operation when calling `get_deployment_compose`. Inspect the recorded artifact, not a newly rendered guess. Get the deployment ID from inventory and call `diagnose_deployment` and `check_deployment_runtime_status`; require one healthy replica, the intended image, pinned node, and unchanged durable mount.
10. Open the published website and `/health`; check `/api/session`, plus MCP discovery/read access at `/mcp`. Test authenticated writes and restart persistence only against an isolated test workspace with a working auth owner. Never import sample data into a user's live plan merely to test deployment.
11. Report the preview URL, actual ref/digest, action result, health, storage path, and checks not performed. Preserve existing plan data; no backup/copy/export or bulk replacement is part of deployment.

Explicit lifecycle input example, after substituting approved values:

```json
{
  "projectId": "pocketplanner",
  "gitRef": "<approved commit SHA or release tag>",
  "component": "planner",
  "profile": "swarm",
  "action": "deploy",
  "deploymentName": "pocketplanner"
}
```

For an existing deployment, inspect its inventory first and use `action: update` with the same deployment name. Set the new image digest and ref before validation. Do not remove/purge the deployment, switch its node, or replace its storage to perform an update.

## Configuration and persistence

Required non-secret runtime values:

| Variable | Value |
| --- | --- |
| `POCKETPLANNER_IMAGE` | Explicit verified Java/React image reference, preferably a pinned digest; no implicit published-release fallback |
| `POCKETPLANNER_PORT` | Published HTTP port, such as `8765` |
| `POCKETPLANNER_NODE` | Explicit Swarm node hostname owning the database mount |

Optional runtime value: `POCKETHIVE_AUTH_BASE_URL` selects the PocketHive public ingress plus `/auth-service`, without a trailing slash. When unset, HiveForge explicitly renders an empty auth value and the application runs view-only. PocketHive does not need to be deployed to install or view the planner. Editing requires a working PocketHive auth owner; no local authentication bypass is provided.

`POCKETHIVE_ALLOW_REMOTE_HTTP` is `false` by default: public verification and
logout addresses returned by PH must use HTTPS or loopback HTTP. Set it to
`true` only for an explicitly approved remote HTTP issuer. PP passes that
permission to the shared client; it never infers permission from a URL.
The server-side auth base may remain an internal HTTP ingress independently.


Browser editing requires compatible PH Auth with the registered
`pocketplanner-device` client. The shared browser client opens PH's confirmation
tab and completes sign-in in the original Planner window by polling through its
backend. PP has no `/auth/callback`, PKCE return route or port-specific callback
configuration. Moving/restarting a PP preview does not require registering its
new browser port. PH's advertised confirmation URL must nevertheless be reachable
from the browser, and its backend URL must be reachable from the app container.
Deploying PP does not implicitly register clients or upgrade PH. Verify the
actual PH version and browser/ingress path; see `POCKETHIVE_INTEGRATION.md`.

Use the canonical auth address directly. The adapter rejects all redirects with 503 rather than forwarding credentials elsewhere; a redirecting HTTP address is not a substitute for the intended HTTPS ingress.

Optional MCP runtime values are passed into the same application container:

| Variable | Value |
| --- | --- |
| `POCKETPLANNER_MCP_ALLOWED_HOSTS` | Comma-separated exact Host values, e.g. `planner.example.com,planner.example.com:8765`; localhost remains allowed |
| `POCKETPLANNER_MCP_ALLOWED_ORIGINS` | Explicit trusted browser origins, e.g. `https://planner.example.com`; unnecessary for native clients that omit Origin |

Do not use an unrestricted `*` allowlist. These values are not CORS permission or authentication. MCP updates still require a PocketHive local-admin bearer token on every call. The endpoint is `http(s)://<planner-ingress>/mcp`; there is no second published port.

The profile requires a shared managed root and placement capability. HiveForge supplies `HIVEFORGE_BIND_SOURCE_DIR`. Durable data lives in `state/pocketplanner`, outside replace-managed artifacts, with UID/GID 10001. One replica and stop-first updates prevent competing SQLite writers. Updates do not replace plan data. Verify the recorded stack artifact and runtime through HiveForge MCP, then check `/health` and read-only/admin behavior through the published application address.

The JRE image explicitly uses `TESTPLANNER_DB=/data/planner.sqlite3`,
`BIND_ADDRESS=0.0.0.0` and container port 8765. The health check uses curl against
`http://127.0.0.1:8765/health`; no Python executable is required. Keep the durable
mount writable by UID/GID 10001 and provide writable `/tmp` when using a read-only
root filesystem. Ingress must pass `/api/events` as unbuffered long-lived SSE;
no WebSocket upgrade is required. Volume changes, data movement and switching a
working installation remain separate operator-approved actions.

The current 0.5 project execution contract does not provide the Docker-single lifecycle required by this project, so no pretend Docker-single profile is declared. For a standalone Docker/Portainer host, use the root `compose.yaml`.
