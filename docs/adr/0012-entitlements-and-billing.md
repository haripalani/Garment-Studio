# ADR-0012: Entitlements engine from day 1; billing provider behind an adapter (D3)

- **Status:** Accepted · 2026-10-30

## Decision
- Every gated action calls `entitlements.check(userId, action, qty)` (server) and `useEntitlement(action)` (client, advisory only). Actions: `project.create`, `asset.upload`, `export.create`, `render.cloud`, `render.local`, `render.size`, `render.quality`, `garment.use`, `storage.bytes`.
- Plans and limits are **data** (`Plan` table, seeded), not code constants. Usage is computed from an append-only `UsageEvent` ledger per billing period; credit packs are `CreditGrant` rows with expiry.
- `BillingProvider` interface (`createCheckout`, `portalUrl`, `verifyWebhook`, `mapEvent`). Paddle and Stripe adapters will be implemented when pricing is decided; until then a `ManualProvider` (admin-assigned plans) lets us test entitlements end to end.
- Plan numbers are a business decision, not copied from the reference. The seed contains a single "Dev" plan with no limits plus a "Free" plan for testing limits.
- Offline: the client caches the last entitlement snapshot (signed, 24 h TTL) so local features keep working; cloud features are re-checked server-side.

## Consequences
Turning on paid plans later is configuration plus one adapter, not a refactor.
