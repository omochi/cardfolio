# Cardfolio development

Cardfolio is a private single-owner ledger. Never add real card numbers, CVV, PIN, credentials, personal service records, Site IDs or production data to the repository or tests. Use synthetic data only. Changes to access control, restore, concurrency, idempotency or external-update claims require focused tests. Consult the current Sites skill for provisioning, migrations and MCP; do not imply deployment or plugin verification occurred when it did not. Preserve existing migration history. Never make the deployment public to enable agent access.
