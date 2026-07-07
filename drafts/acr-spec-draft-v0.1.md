# Agent Commitment Receipt (ACR) — Specification Draft v0.1

Status: **Working draft** (2026-07-07, pre-review)
License: CC0 1.0 (public domain) — this specification is free to implement with no royalties, forever.

---

## 1. What this is (and is not)

**ACR is a portable, verifiable receipt for pre-payment commitments in agentic commerce.**

When an AI agent inquires about a non-standardized, high-trust service (a custom tour, a wedding shoot, a renovation) on behalf of a human, the merchant cannot afford to produce a serious quote for every drive-by inquiry — and the human cannot afford to let the agent commit large sums blindly. The emerging practice is a small, **refundable-or-redeemable planning fee**: the customer pays it to signal serious intent; if the deal closes, it is credited against the final price.

ACR standardizes **the receipt of that commitment** — who committed what, on whose behalf, under which redemption terms, and what happened to the commitment over time — as a tamper-evident, independently verifiable JSON document.

**ACR is NOT:**
- a payment protocol — money moves on whatever rails the parties already use (bank transfer, card, ACP/AP2 mandates). ACR only records proof that it moved.
- a marketplace, a directory, or a ranking system.
- owned by any platform. Any merchant, agent, or platform may issue and verify ACRs.

**Three questions an ACR answers** (the whole spec exists to answer these):
1. Which agent, acting for which principal, committed to what, with which merchant?
2. Under what terms can the commitment be redeemed (credited), released (returned), or expire?
3. How can a third party verify the receipt's event history has not been tampered with, without trusting the issuer?

## 2. Lifecycle: five verbs

An ACR is an append-only chain of events. Exactly one event type per state transition:

```
intent.quote_requested      an agent/customer asked for a serious quote
        │
commitment.charged          the planning fee was paid; commitment exists
        │
commitment.reserved         commitment attached to a specific formal quote/order
        │
   ┌────┴────┐
commitment.redeemed     commitment.released
(credited against       (returned to available,
 the closed deal)        e.g. quote declined/voided)
```

Terminal/exception events:
- `commitment.expired` — validity window passed without redemption (MAY be recorded lazily; verifiers MUST treat `expires_at < now` as expired regardless).
- `commitment.disputed` — either party contests; freezes state machine until resolved by an out-of-band process.

State machine rules:
- `charged` requires a prior `quote_requested` in the same receipt.
- `reserved` requires `charged`; `redeemed`/`released` require `reserved` (release from `charged` is also legal — quote never materialized).
- After `redeemed`: no further transitions. After `released`: a new `reserved` MAY follow (re-use before expiry).
- Any illegal transition invalidates the receipt (verifiers MUST reject).

## 3. Receipt document

A receipt is a single JSON object:

```json
{
  "acr_version": "0.1",
  "receipt_id": "acr_9f8e7d6c5b4a",
  "issuer": {
    "name": "Formosa Charter Tours Co., Ltd.",
    "id": "https://tours.example.tw",
    "license": "TQAA Travel Agency No. 1234",
    "key_url": "https://tours.example.tw/.well-known/acr.json"
  },
  "principal": { "name_hash": "sha256:…", "contact_hash": "sha256:…" },
  "agent": { "id": "urn:acr:agent:claude", "on_behalf_of": "principal" },
  "commitment": {
    "amount": 1000,
    "currency": "TWD",
    "terms_url": "https://tours.example.tw/planning-fee-terms",
    "redeemable_against": "any formal quote issued for the same inquiry",
    "expires_at": "2026-09-05T00:00:00Z",
    "payment_proof": { "type": "manual_transfer", "ref": "…" }
  },
  "events": [
    {
      "seq": 1,
      "type": "intent.quote_requested",
      "at": "2026-07-07T03:00:00Z",
      "actor": "agent",
      "detail": { "inquiry_ref": "inq_123" },
      "prev_hash": null,
      "hash": "sha256:…",
      "sig": "ed25519:…"
    }
  ]
}
```

Notes:
- **Privacy**: the principal (human customer) appears only as salted hashes. The merchant holds the mapping privately; the receipt itself carries no PII.
- **Amounts** are integers in minor-or-major units per currency convention declared in `terms_url`; no floats.
- **payment_proof.type** is an open enum: `manual_transfer`, `card`, `acp_mandate`, `ap2_mandate`, … ACR does not interpret it; it is a pointer to the money rail.

## 4. Integrity & verification (tamper-evidence)

- Each event carries `hash = SHA-256(canonical_json(event_without_hash_sig) + prev_hash)`. Events form a hash chain; reordering, deleting, or editing any event breaks every subsequent hash.
- Each event carries `sig`: the issuer signs `hash` with an Ed25519 key.
- The issuer publishes its public key(s) at `https://<issuer>/.well-known/acr.json`:

```json
{ "acr_version": "0.1", "keys": [ { "kid": "2026-01", "alg": "ed25519", "pub": "base64…" } ] }
```

- **Verification procedure** (what the reference verifier does):
  1. Schema-validate the receipt.
  2. Recompute the hash chain; reject on any mismatch.
  3. Fetch the issuer key from `key_url` (same origin as `issuer.id`); verify every `sig`.
  4. Replay the state machine; reject illegal transitions.
  5. Report effective state (including dynamic expiry).

This gives *tamper-evidence anchored to the issuer's domain* — a third party needs to trust DNS/TLS for the issuer's domain, but not the issuer's database or any platform in between.

## 5. Discovery (optional)

A merchant MAY declare ACR support at `/.well-known/acr.json` (same file as keys) with an `endpoints` block: where an agent can POST an inquiry, how the planning-fee terms are fetched. This is deliberately minimal in v0.1; discovery is not the point — the receipt is.

## 6. Conformance

- **Issuer**: produces schema-valid receipts, maintains hash chain + signatures, publishes keys, never mutates past events.
- **Verifier**: implements §4 fully; MUST reject on any integrity failure (fail-closed).
- **Agent**: SHOULD present the receipt to its principal before and after `commitment.charged`; MUST NOT treat a receipt as proof of payment beyond what `payment_proof` states.

## 7. Deliverables of v0.1

1. `acr-spec.md` — this document, tightened.
2. `acr.schema.json` — JSON Schema (draft 2020-12) for receipt + well-known file.
3. `verifier/` — a single static HTML page: paste a receipt → full §4 verification in-browser (WebCrypto), zero server.
4. Two worked examples: a happy-path charter-tour receipt; a released-then-expired receipt.

## Open questions for review
- Naming: "ACR" collides with Azure Container Registry in developer mindshare. Alternatives? (e.g., "commitment receipt" spelled out; different acronym)
- Canonical JSON: JCS (RFC 8785) vs. simpler sorted-keys rule?
- Should `commitment.disputed` be in v0.1 at all, or deferred?
- Multi-currency / partial redemption: defer to v0.2?
- Is domain-anchored Ed25519 enough, or should v0.1 already define how an AP2 cryptographic mandate slots into `payment_proof`?
