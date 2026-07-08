# Symbolon: Agent Commitment Receipts — v0.1 (draft)

> *In ancient Greece, two parties to an agreement broke a token — a σύμβολον — and each kept half. Years later, a match of the two halves proved the bond. This protocol is that token, for the agent economy.*

Status: **Working draft** (2026-07-07)
License: CC0 1.0 — free to implement, no royalties, forever.
Artifact name: *commitment receipt*. Protocol name: **Symbolon**.

> **Boundary — the most important sentence in this spec:**
> Symbolon verifies **issuer-attested receipt history** — not payment finality, not customer or agent identity, not legal enforceability, not dispute outcomes.

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
- The first event MUST be `intent.quote_requested`, and it MUST appear exactly once.
- `commitment.charged` requires state `inquired`, and MUST appear exactly once.
- `commitment.reserved` requires state `charged` (initial or after a release).
- `commitment.redeemed` requires state `reserved`. Terminal.
- `commitment.released` is legal from `reserved` (quote declined/voided); the commitment returns to state `charged` and MAY be reserved again before expiry.
- Event timestamps (`at`) MUST be non-decreasing in `seq` order.
- **Expiry**: `commitment.reserved` and `commitment.redeemed` events whose `at` is after `commitment.expires_at` make the receipt invalid. `commitment.released` is legal at any time (a commitment must always be releasable). Additionally, expiry is dynamic: verifiers MUST report state `expired` when `expires_at <= now` unless the receipt is `redeemed`. No `expired` event exists.
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
    "terms_digest": "sha256:…",
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
      "kid": "2026-01",
      "hash": "sha256:…",
      "sig": "ed25519:…"
    }
  ]
}
```

Field notes:
- **`principal_ref`** — an opaque issuer-side reference. No PII in the receipt, not even hashes (hashed phone numbers are brute-forceable). The issuer holds the mapping privately.
- **`amount_decimal`** — decimal string, strictly positive, `^[0-9]+(\.[0-9]{1,4})?$`. One receipt = one commitment = one currency (ISO 4217); redeemed in full or released in full. No partial accounting in v0.1.
- **`terms_url` / `terms_digest`** — `terms_digest` (optional but RECOMMENDED) is `"sha256:" + hex(SHA-256(terms document bytes))` at issuance time, so the issuer cannot silently rewrite the terms page later.
- **`payment_reference`** — `{type, ref, uri?, digest?}`, an open pointer to the money rail (`manual_transfer`, `card`, `acp_mandate`, `ap2_mandate`, `x402`, `l402`, …). Symbolon never validates the rail — a receipt layer that validates payment rails gets captured by them.
- **`agent.id`** — a **self-asserted, descriptive** label (e.g. `urn:agent:claude`). It is NOT authenticated: anyone can write any value, and the issuer's signature does not vouch for it. Verifiers MUST treat `agent.id` as descriptive only and MUST NOT use it as authentication, for settlement, ranking, reputation, or profit-sharing. Verifying *which* agent acted is the job of a future, optional attestation extension (see §5).
- **`events[].actor`** — one of `agent`, `principal`, `issuer`.
- **`events[].seq`** — 1-based, strictly consecutive, matching array order.
- **`events[].kid`** — the issuer key id (from the well-known document) that signed this event; verifiers use it to select the key (no trial-and-error) and it survives key rotation.
- **Duplicate JSON member names** anywhere in a receipt make it invalid; implementations SHOULD reject them (I-JSON, RFC 7493).

## 4. Integrity & verification

- **Canonicalization**: JCS (RFC 8785). Because the schema forbids floats, implementations only need the sorted-keys + UTF-8 subset of RFC 8785.
- **Receipt context binding**: let `receipt_core` be the receipt object **without** the `events` member. Then
  `context = hex( SHA-256( UTF8( "symbolon:v0.1:receipt\n" + JCS(receipt_core) ) ) )`.
  Every event hash commits to `context`, so altering **any** header field — amount, currency, expiry, terms, issuer, agent — breaks every event hash.
- **Hash chain**: for each event, with `core` = the event without `hash` and `sig` (note `core` includes `prev_hash` and `kid`):
  `hash = "sha256:" + hex( SHA-256( UTF8( "symbolon:v0.1:event\n" + context + "\n" + JCS(core) ) ) )`,
  where `prev_hash` of event 1 is `null` and of event *n* is the `hash` of event *n−1*. Editing, deleting, or reordering any event breaks every subsequent hash. The `symbolon:v0.1:…` prefixes are domain separators: a Symbolon digest can never collide with another protocol's use of the same data.
- **Signature**: `sig = "ed25519:" + base64( Ed25519_sign( issuer_key[kid], UTF8( "symbolon:v0.1:sig\n" + hash ) ) )`. The signing key MUST be the well-known key whose id equals the event's `kid`.
- **Key discovery**: the issuer publishes public keys at the **fixed path** `https://<origin of issuer.id>/.well-known/symbolon.json`; `key_url` MUST equal exactly that URL. Verifiers MUST NOT follow cross-origin redirects when fetching it. A locally supplied copy of the well-known document MUST be labelled with the origin it was retrieved from:

```json
{ "spec_version": "0.1",
  "keys": [ { "kid": "2026-01", "alg": "ed25519", "pub": "<base64 raw 32-byte public key>" } ] }
```

- **Verifier procedure** (fail closed at every step):
  1. Validate the receipt against the JSON Schema (including `key_url` = fixed well-known path on `issuer.id`'s origin).
  2. Recompute `context` and the hash chain; reject on any mismatch.
  3. Obtain the issuer keys (fetch `key_url` without cross-origin redirects, or accept a locally supplied copy) and verify every `sig` with the key named by that event's `kid`.
  4. Replay the state machine (§2), including timestamp monotonicity and expiry rules; reject illegal transitions.
  5. Report the effective state, including dynamic expiry.

Trust anchor = the issuer's domain (DNS/TLS). Nothing else. Deliberately sufficient for v0.1.

## 5. Deferred by design (not in v0.1)

Disputes, `expired` events, discovery/endpoints, multi-currency, partial redemption, payment-rail validation, PII hashing schemes, revocation lists, agent identity attestation (a reserved, backward-compatible `agent_attestation` extension — most likely an agent **co-signature** where `agent.id` binds to the fingerprint of the agent's own key — to be added **only when** an ecosystem actually starts using `agent.id` for settlement, ranking, reputation, or profit-sharing; DID/VC envelopes remain a later option), key transparency. The spec stays robots.txt-sized or it dies.

## 5a. Relationship to neighbouring protocols

Symbolon is payment-rail agnostic and deliberately smaller than its neighbours: W3C Verifiable Credentials answer "who is this party?" (a future envelope, not a dependency); Google AP2 / OpenAI-Stripe ACP answer "may the agent pay?" (reference their mandates via `payment_reference.type`); x402 / L402 answer "how does the machine pay?" (likewise a `payment_reference.type`). Symbolon answers the question none of them do: **"what was committed before payment, and what happened to that commitment?"**

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

## Changelog

- **2026-07-07 (b)** — security review (2 independent AI reviewers) before any adopter existed; wire format amended: receipt-context binding (header fields are now covered by every event hash — previously only `events[]` was protected), domain-separated hash & signature payloads, `events[].kid` (key rotation), fixed well-known path + no cross-origin redirects, first-event and exactly-one-`charged` rules, timestamp monotonicity, expiry blocks reserve/redeem but never release, optional `terms_digest`, tightened signature encoding patterns.
- **2026-07-07 (a)** — initial public draft.
