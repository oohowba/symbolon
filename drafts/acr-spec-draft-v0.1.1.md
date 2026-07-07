# Agent Commitment Receipts — Specification Draft v0.1.1

Status: **Working draft** (2026-07-07, post codex-review round 1)
License: CC0 1.0 — free to implement, no royalties, forever.
Short name: *commitment receipt* (spelled out; no acronym branding — "ACR" collides with Azure Container Registry).

> **Boundary (the most important sentence in this spec):**
> This specification verifies **issuer-attested receipt history** — not payment finality, not customer identity, not legal enforceability, not dispute outcomes.

---

## 1. What this is

A **commitment receipt** is a portable, tamper-evident JSON document recording a pre-payment commitment in agentic commerce: an AI agent (or human) asked a merchant for a serious quote on a non-standardized service, paid a small redeemable **planning fee** to signal intent, and that commitment was later credited against the closed deal — or returned.

Money moves on whatever rails the parties already use (bank transfer, card, ACP/AP2 mandates). The receipt only records **what was committed, by whom, on whose behalf, under which redemption terms, and what happened to it** — verifiable by any third party without trusting the issuer's database or any platform.

Three questions a receipt answers:
1. Which agent, for which principal, committed what, with which merchant?
2. Under what terms is the commitment redeemed, released, or expired?
3. How does a third party verify the event history was not tampered with?

## 2. Lifecycle: five verbs, nothing else

```
intent.quote_requested → commitment.charged → commitment.reserved → commitment.redeemed
                                    │                   │
                                    └── commitment.released ◄┘
```

- `charged` requires prior `quote_requested`; `reserved` requires `charged`.
- `redeemed` requires `reserved`. Terminal.
- `released` is legal from `charged` or `reserved`; a later `reserved` MAY re-use the commitment before expiry.
- **Expiry is dynamic**: verifiers MUST treat `expires_at < now` as expired. No `expired` event exists.
- **No `disputed` state** in v0.1 (no resolution mechanism = half a state machine). Deferred.
- Any illegal transition ⇒ verifiers MUST reject the whole receipt (fail-closed).

## 3. Receipt document

```json
{
  "spec_version": "0.1",
  "receipt_id": "cr_9f8e7d6c5b4a",
  "issuer": {
    "name": "Formosa Charter Tours Co., Ltd.",
    "id": "https://tours.example.tw",
    "license": "TQAA Travel Agency No. 1234",
    "key_url": "https://tours.example.tw/.well-known/commitment-receipt.json"
  },
  "principal_ref": "opaque-issuer-side-reference",
  "agent": { "id": "urn:agent:claude", "on_behalf_of": "principal" },
  "commitment": {
    "amount_decimal": "1000.00",
    "currency": "TWD",
    "terms_url": "https://tours.example.tw/planning-fee-terms",
    "expires_at": "2026-09-05T00:00:00Z",
    "payment_reference": { "type": "manual_transfer", "ref": "…" }
  },
  "events": [ { "seq": 1, "type": "intent.quote_requested", "at": "…",
                "actor": "agent", "detail": { "inquiry_ref": "inq_123" },
                "prev_hash": null, "hash": "sha256:…", "sig": "ed25519:…" } ]
}
```

Changes from v0.1 (codex review):
- **`principal_ref` is an opaque issuer-side reference** — no PII, not even hashes, in the receipt (hashed phone numbers are brute-forceable).
- **`amount_decimal` is a decimal string**; floats prohibited; one receipt = one commitment = one currency; redeemed in full or released in full (no partial accounting in v0.1).
- **`payment_reference`** (renamed from payment_proof — the receipt does not *prove* payment): an open pointer `{type, ref, uri?, digest?}` to the money rail. `type` examples: `manual_transfer`, `card`, `acp_mandate`, `ap2_mandate`. The receipt layer never validates the rail — that would let a payment rail capture the neutral layer.

## 4. Integrity & verification

- Canonicalization: **JCS (RFC 8785)** — no homegrown sorted-keys rule.
- `hash = SHA-256( JCS(event minus hash,sig) ‖ prev_hash )` — append-only hash chain; any edit breaks all subsequent hashes.
- `sig`: issuer signs `hash` with Ed25519. Public keys at `https://<issuer>/.well-known/commitment-receipt.json`, same origin as `issuer.id`:
  `{ "spec_version": "0.1", "keys": [ { "kid": "2026-01", "alg": "ed25519", "pub": "base64…" } ] }`
- Verifier procedure (fail-closed at every step): schema-validate → recompute chain → fetch key (same-origin) & verify sigs → replay state machine → report effective state incl. dynamic expiry.
- Trust anchor = the issuer's domain (DNS/TLS), nothing else. Deliberately sufficient for v0.1.

## 5. Cut from v0.1 (deferred, by design)

Discovery/endpoints block, `disputed`, `expired` event, multi-currency, partial redemption, AP2/ACP validation, PII hashes. The spec stays robots.txt-sized or it dies.

## 6. Deliverables

1. `spec.md` (this, tightened & final-named)
2. `schema.json` — JSON Schema 2020-12 for receipt + well-known file
3. `verifier/index.html` — single static page, WebCrypto, zero server: paste receipt → full §4 verification
4. Two worked examples (happy path; released-then-expired)

## 7. Naming decision needed (Cilin)

Full name **Agent Commitment Receipt** stays. Short-name options for repo/domain:
- `commitment-receipt` (spelled out, boring-good, codex 推薦方向)
- `acrt` / other acronym (need collision check)
Repo will be public (CC0 spec must be); publishing waits for Cilin's go.
