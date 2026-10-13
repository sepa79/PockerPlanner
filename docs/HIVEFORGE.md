# HiveForge deployment

This repository uses HiveForge manifest version 0.5. Project: `pockerplanner`; component: `planner`; profile: `swarm`; actions: `deploy` and `update`. Project Ansible renders `/hf/stacks/compose.yml`; HiveForge owns Docker deployment execution. No Docker socket or direct host deployment is required by the project playbook.

Prepare through HiveForge MCP: inspect the repository/ref, register the approved project/ref, set environment policy, set runtime values, validate requirements, then execute the approved lifecycle action. This repository does not guess an environment or automatically deploy to one.

Required non-secret runtime values:

| Variable | Value |
| --- | --- |
| `POCKERPLANNER_IMAGE` | Full image reference, preferably a pinned digest |
| `POCKERPLANNER_PORT` | Published HTTP port, such as `8765` |
| `POCKERPLANNER_NODE` | Explicit Swarm node hostname owning the database mount |

Optional runtime value: `POCKETHIVE_AUTH_BASE_URL` selects the PocketHive public ingress plus `/auth-service`, without a trailing slash. When unset, HiveForge explicitly renders an empty auth value and the application runs view-only. PocketHive does not need to be deployed to install or view the planner. Editing requires a working PocketHive auth owner; no local authentication bypass is provided.

The profile requires a shared managed root and placement capability. HiveForge supplies `HIVEFORGE_BIND_SOURCE_DIR`. Durable data lives in `state/pockerplanner`, outside replace-managed artifacts, with UID/GID 10001. One replica and stop-first updates prevent competing SQLite writers. Updates do not replace plan data. Verify the recorded stack artifact and runtime through HiveForge MCP, then check `/health` and read-only/admin behavior through the published application address.

The current 0.5 project execution contract does not provide the Docker-single lifecycle required by this project, so no pretend Docker-single profile is declared. For a standalone Docker/Portainer host, use the root `compose.yaml`.
