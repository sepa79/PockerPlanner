# PockerPlanner working rules

- Read the architecture and data contract before changing behavior.
- Prefer KISS: small, explicit modules and no silent fallbacks or compatibility layers.
- Keep one authoritative owner for persisted state, validation, and calculations.
- Give each implementation file one clear responsibility; keep authored seed data outside runtime code.
- Fail explicitly for invalid references and inputs.
- Update documentation and tests with behavioral changes; verify the user interface for visual changes.
- Do not commit, push, or write personal memory without an explicit request.

PocketHive and KEGLib share these principles. Their Java, messaging, graphics, deployment, and domain-specific rules do not apply here. There is no shared technology stack or standard profile prescribing one for this project.
