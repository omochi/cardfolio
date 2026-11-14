# Cardfolio

A personal ledger of which cards are registered with which services, and the progress of confirming changes when a card is renewed. It does not update external services. Do not enter card numbers, security codes, PINs, passwords or other credentials, including in notes. Input filtering is only a safeguard and cannot reliably detect all secrets. The service names and notes are private too.

Each person deploys an independent **private** ChatGPT Site and D1 database. This repository contains no account, Site ID, or real data. Cards and services have many-to-many links; progress is per link and expiry generation. A new expiry creates a new generation without overwriting previous progress. Edit card and service details from the side panel. Archive individual cards, services, or links instead of deleting them; their history is retained and they can be reactivated. Archived items cannot receive progress or new links. Completed statuses require explicit confirmation, but Cardfolio cannot verify an external service itself. Saving the ledger and changing an external service are independent; if saving fails, report the external result separately and retry recording after checking the current ledger.

## Development

Node 24+ and npm are required for development and tests. `npm ci`, `npm run db:generate` after schema changes, and `npm run build`. To preview, use `npm run dev` and the Sites starter's local sign-in route. Local D1 needs the generated migration applied with the current Sites skill's local D1 instructions. Local and hosted databases are separate. `npm test` runs the focused ledger tests.

## Deploy a new private Site with an AI assistant

1. Give the assistant this repository and request a **new private Site**. Have it read the latest Sites skill, especially storage, identity, Site MCP and publishing. Never copy another user's project ID or database.
2. Install dependencies with the current Sites installer. Register a new Site with the Sites tools and record its returned project ID in the local `.openai/hosting.json` using the Sites helper. This ID is environment-specific: do not commit or publish that change to this reusable repository. D1 binding `DB` and `mcp` capability are declared. Retain them.
3. Check the schema and committed Drizzle migrations; do not regenerate an existing migration. Build using the Sites build helper. Follow the Sites source packaging workflow, then deploy **private**. Hosted migrations are applied by Sites during deployment; verify status, including failures. Do not switch audience to public.
4. Sign in as the owner, verify the empty ledger, add fictional test records, and verify writes and reloads. Confirm unauthenticated access is rejected and the site is private. Back up and remove test records by restoring an empty backup if appropriate. Connect the private app created for the Site via the current Sites MCP instructions; test `read_ledger` and a fictional write as the owner. Check another unauthorized identity cannot access it. The MCP endpoint also requires a Sites authenticated user ID; service bypass without identity is deliberately rejected.
5. Only after those checks, use real service names. Never place real data or backup exports in Git, logs, or test fixtures. If identity or MCP access cannot be verified, stop and report the limitation.

## Backups, restore, updates

Use **バックアップ** to download JSON. It contains private registration data; store it securely outside the repository. **復元** replaces the entire ledger, after confirmation and validation; take a current backup first. Restore is revision-checked, atomic and fails on concurrent changes. Test restore with fictional data in a separate private Site before relying on it. Operation IDs are not exported. No automatic backup is implied.

For upgrades, back up first, read release changes, apply source changes and append migrations without rewriting prior migration history. Follow current Sites packaging/deployment instructions, confirm deployment and migration status, then check access and records. A failed deployment can have applied migrations: inspect state before retrying. To recover data, restore a verified compatible backup via the UI. Preserve access restrictions and never share the deployment as a multi-user service.

## Limitations

No sync with payment providers, automatic discovery, or automatic proof of external updates. Names and notes cannot be reliably screened for all sensitive information. Deployment, actual D1 provisioning, owner-only access and MCP connectivity must be verified in each environment. Free-form notes may contain private information. Backups are plaintext.
