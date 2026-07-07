# Symbolon: Agent Commitment Receipts — v0.1 (draft)

> *In ancient Greece, two parties to an agreement broke a token — a σύμβολον — and each kept half. Years later, a match of the two halves proved the bond. This protocol is that token, for the agent economy.*

Status: **Working draft** (2026-07-07)
License: CC0 1.0 — free to implement, no royalties, forever.
Artifact name: *commitment receipt*. Protocol name: **Symbolon**.

> **Boundary — the most important sentence in this spec:**
> Symbolon verifies **issuer-attested receipt history** — not payment finality, not customer identity, not legal enforceability, not dispute outcomes.

---

## 1. Why

When an AI agent inquires about a non-standardized, high-trust service (a custom tour, a wedding shoot, a renovation) on behalf of a human, the merchant cannot afford a serious quote for every drive-by inquiry — and the human cannot let the agent commit large sums blindly. The emerging practice is a small **redeemable planning fee**: paid to signal serious intent, credited against the final price if the deal closes.

A **commitment receipt** standardizes the record of that commitment: who committed what, on whose behalf, under which redemption terms, and what happened to it — as a portable, tamper-evident JSON document any third party can verify.

Money moves on whatever rails the parties already use (bank transfer, card, ACP/AP2 mandates). Symbolon never moves money; it records commitments about it.

Three questions a receipt answers:
1. Which agent, for which principal, committed what, with which merchant?
2. Under what terms is the commitment redeemed, released, or expired?
3. How can a third party verify the event history was not tampered with?

## 2. Lifecycle: five verbs, nothing else

```
intent.quote_requested → commitment.charged → commitment.reserved → commitment.redeemed
                                    │                   │
                                    └── commitment.released ◄┘
```

Rules:
- `commitment.charged` requires a prior `intent.quote_requested`.
- `commitment.reserved` requires state `charged` (initial or after a release).
- `commitment.redeemed` requires state `reserved`. Terminal.
- `commitment.released` is legal from `reserved` (quote declined/voided); the commitment returns to state `charged` and MAY be reserved again before expiry.
- **Expiry is dynamic**: verifiers MUST treat `commitment.expires_at < now` as expired unless the receipt is already `redeemed`. No `expired` event exists.
- No `disputed` state in v0.1.
- Any illegal transition ⇒ the entire receipt is invalid. Verifiers MUST fail closed.

## 3. Receipt document

A receipt is one JSON object. All numbers are integers; all monetary values are decimal strings; floats are prohibited (this keeps RFC 8785 canonicalization trivial).

```json
{
  "spec_version": "0.1",
  "receipt_id": "sym_9f8e7d6c5b4a",
  "issuer": {
    "name": "Formosa Charter Tours Co., Ltd.",
    "id": "https://tours.example.tw",
    "license": "TQAA Travel Agency No. 1234",
    "key_url": "https://tours.example.tw/.well-known/symbolon.json"
  },
  "principal_ref": "opaque-issuer-side-reference",
  "agent": { "id": "urn:agent:claude", "on_behalf_of": "principal" },
  "commitment": {
    "amount_decimal": "1000.00",
    "currency": "TWD",
    "terms_url": "https://tours.example.tw/planning-fee-terms",
    "expires_at": "2026-09-05T00:00:00Z",
    "payment_reference": { "type": "manual_transfer", "ref": "TXN-20260707-001" }
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

Field notes:
- **`principal_ref`** — an opaque issuer-side reference. No PII in the receipt, not even hashes (hashed phone numbers are brute-forceable). The issuer holds the mapping privately.
- **`amount_decimal`** — decimal string, non-negative, `^[0-9]+(\.[0-9]{1,4})?$`. One receipt = one commitment = one currency; redeemed in full or released in full. No partial accounting in v0.1.
- **`payment_reference`** — `{type, ref, uri?, digest?}`, an open pointer to the money rail (`manual_transfer`, `card`, `acp_mandate`, `ap2_mandate`, …). Symbolon never validates the rail — a receipt layer that validates payment rails gets captured by them.
- **`events[].actor`** — one of `agent`, `principal`, `issuer`.
- **`events[].seq`** — 1-based, strictly consecutive, matching array order.

## 4. Integrity & verification

- **Canonicalization**: JCS (RFC 8785). Because the schema forbids floats, implementations only need the sorted-keys + UTF-8 subset of RFC 8785.
- **Hash chain**: for each event, `hash = "sha256:" + hex( SHA-256( JCS(event minus hash,sig) || (prev_hash ?? "") ) )`, where `prev_hash` of event 1 is `null` and of event *n* is the `hash` of event *n−1*. Editing, deleting, or reordering any event breaks every subsequent hash.
- **Signature**: `sig = "ed25519:" + base64( Ed25519_sign( issuer_private_key, hash_string_utf8 ) )`. The issuer signs each event's `hash` string.
- **Key discovery**: the issuer publishes public keys at `https://<issuer domain>/.well-known/symbolon.json` — same origin as `issuer.id`:

```json
{ "spec_version": "0.1",
  "keys": [ { "kid": "2026-01", "alg": "ed25519", "pub": "<base64 raw 32-byte public key>" } ] }
```

- **Verifier procedure** (fail closed at every step):
  1. Validate the receipt against the JSON Schema.
  2. Recompute the hash chain; reject on any mismatch.
  3. Obtain the issuer key (fetch `key_url`, which MUST be same-origin with `issuer.id`; or accept a locally supplied copy of the well-known document) and verify every `sig`.
  4. Replay the state machine (§2); reject illegal transitions.
  5. Report the effective state, including dynamic expiry.

Trust anchor = the issuer's domain (DNS/TLS). Nothing else. Deliberately sufficient for v0.1.

## 5. Deferred by design (not in v0.1)

Disputes, `expired` events, discovery/endpoints, multi-currency, partial redemption, payment-rail validation, PII hashing schemes, revocation lists, agent identity attestation. The spec stays robots.txt-sized or it dies.

## 6. Conformance

- **Issuer**: produces schema-valid receipts, maintains the hash chain and signatures, publishes keys at the well-known URL, never mutates past events.
- **Verifier**: implements §4 fully; rejects on any failure.
- **Agent**: SHOULD present the receipt to its principal before and after `commitment.charged`; MUST NOT treat a receipt as proof of payment beyond what `payment_reference` states.

## 7. Repository layout

```
spec.md                  this document
schema.json              JSON Schema 2020-12: receipt + well-known document
verifier/index.html      static, zero-server, WebCrypto verifier (paste → verdict)
tools/generate-example.mjs   dev tool: keypair + signed example receipts
tools/verify.mjs         CLI verifier (same §4 procedure, for CI)
examples/                worked examples incl. a tampered receipt that must fail
```
