# HiveForge deployment

This repository uses HiveForge manifest version 0.5. Project: `pocketplanner`; component: `planner`; profile: `swarm`; actions: `deploy` and `update`. Project Ansible renders `/hf/stacks/compose.yml`; HiveForge owns Docker deployment execution. No Docker socket or direct host deployment is required by the project playbook.

Prepare through HiveForge MCP: inspect the repository/ref, register the approved project/ref, set environment policy, set runtime values, validate requirements, then execute the approved lifecycle action. This repository does not guess an environment or automatically deploy to one.

## Agent deployment playbook

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
| `POCKETPLANNER_IMAGE` | Full image reference, preferably a pinned digest |
| `POCKETPLANNER_PORT` | Published HTTP port, such as `8765` |
| `POCKETPLANNER_NODE` | Explicit Swarm node hostname owning the database mount |

Optional runtime value: `POCKETHIVE_AUTH_BASE_URL` selects the PocketHive public ingress plus `/auth-service`, without a trailing slash. When unset, HiveForge explicitly renders an empty auth value and the application runs view-only. PocketHive does not need to be deployed to install or view the planner. Editing requires a working PocketHive auth owner; no local authentication bypass is provided.

Use the canonical auth address directly. The adapter rejects all redirects with 503 rather than forwarding credentials elsewhere; a redirecting HTTP address is not a substitute for the intended HTTPS ingress.

Optional MCP runtime values are passed into the same application container:

| Variable | Value |
| --- | --- |
| `POCKETPLANNER_MCP_ALLOWED_HOSTS` | Comma-separated exact Host values, e.g. `planner.example.com,planner.example.com:8765`; localhost remains allowed |
| `POCKETPLANNER_MCP_ALLOWED_ORIGINS` | Explicit trusted browser origins, e.g. `https://planner.example.com`; unnecessary for native clients that omit Origin |

Do not use an unrestricted `*` allowlist. These values are not CORS permission or authentication. MCP updates still require a PocketHive local-admin bearer token on every call. The endpoint is `http(s)://<planner-ingress>/mcp`; there is no second published port.

The profile requires a shared managed root and placement capability. HiveForge supplies `HIVEFORGE_BIND_SOURCE_DIR`. Durable data lives in `state/pocketplanner`, outside replace-managed artifacts, with UID/GID 10001. One replica and stop-first updates prevent competing SQLite writers. Updates do not replace plan data. Verify the recorded stack artifact and runtime through HiveForge MCP, then check `/health` and read-only/admin behavior through the published application address.

The current 0.5 project execution contract does not provide the Docker-single lifecycle required by this project, so no pretend Docker-single profile is declared. For a standalone Docker/Portainer host, use the root `compose.yaml`.

## Naming and existing deployments

New registrations use `projectId: pocketplanner`, the PocketPlanner repository, `ghcr.io/sepa79/pocketplanner`, `POCKETPLANNER_*` variables, and `state/pocketplanner`. The old variable names are not aliases. This patch release does not rename or redeploy the existing lab installation, change its mount, or copy its database. Do not apply the new project identity to an old deployment as a normal in-place update: its identity/storage migration needs separate human approval and must preserve the original durable mount. For standalone/Portainer updates, keep the existing stack/project name and volume and stop the old service before starting the corrected service.

## Verified lab baseline

The following historical baseline used the original misspelled identifiers. It is not evidence of deployment under the corrected project name.

On 13 October 2026, HiveForge 0.5.9 on `192.168.88.50` deployed and updated the published application through its Portainer-stack executor. A single healthy replica ran on `docker-swarm-mgr-1`; the durable mount stayed at `/mnt/shared_nfs/hiveforge/data/deployed/pockerplanner/state/pockerplanner`. Website navigation, health and view-only access were verified without importing operational data. Authenticated writes and persistence of a nonempty plan were not verified in that lab.

The HiveForge instance on `192.168.88.54` provides Docker-single, not the required Swarm/placement capabilities. It was inspected but this profile was not deployed there. The lab baseline predates the built-in MCP change; do not present it as MCP deployment evidence.
