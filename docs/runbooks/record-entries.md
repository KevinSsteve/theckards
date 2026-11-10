# Runbook — confirmations, messages and notes (S5 part 1)

Signals: `theckards-prod-target-5xx`; user reports. Logs: `/theckards/prod/web` (no message bodies or names are logged).

1. **"Record unavailable" (503)**: Privacy v3 is not approved. Owner: Admin → Legal → approve PRIVACY v3, then accept on the dashboard.
2. **"Not your confirmation" (403)**: expected. Each party declares only its own side (seller/buyer, provider/client, creator/counterparty).
3. **Agreement not becoming COMPLETED**: check that every expected slot is declared by the responsible party (payment slots exist only when the amount is above zero). Outcomes are derived on read; nothing to repair in the database.
4. **Counterparty cannot see the agreement later**: they must link it to an account from the signing phone within 2 hours (`/claim`). After that window, the creator can share the sealed PDF; a new in-person session cannot re-link because the counterparty already signed. Linking requests are audited (`PARTY_ACCOUNT_LINKED`).
5. **"Already linked" (409)**: the party is linked to another account. Do not change `parties.user_id` manually; escalate through support with the audit log.
6. Entries are insert-only (trigger + REVOKE). Never delete or edit them, including on support requests.
