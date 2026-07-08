# Symbolon — Agent Commitment Receipts

> In ancient Greece, two parties to an agreement broke a token — a **σύμβολον** — and each kept half.
> Years later, a match of the two halves proved the bond.
> This protocol is that token, for the agent economy.

**Symbolon is a portable, tamper-evident receipt for pre-payment commitments in agentic commerce.**

When an AI agent inquires about a high-trust, non-standardized service (a custom tour, a wedding shoot, a renovation) on behalf of a human, merchants drown in drive-by inquiries and humans can't let agents commit large sums blindly. The emerging fix is a small **redeemable planning fee** — paid to signal serious intent, credited against the final price if the deal closes.

Symbolon standardizes **the receipt of that commitment**: who committed what, on whose behalf, under which redemption terms, and what happened to it — as a JSON document **any third party can verify without trusting the issuer, any platform, or the authors of this spec**.

## Try it in 10 seconds

**Live verifier: <https://symbolon-verifier.pages.dev>** — click *Demo: valid receipt* (five green checks), then *Demo: tampered receipt* (the hash chain catches the forgery instantly). Everything runs in your browser; nothing is uploaded.

## The boundary (most important sentence)

> Symbolon verifies **issuer-attested receipt history** — not payment finality, not customer or agent identity, not legal enforceability, not dispute outcomes.

Money moves on whatever rails the parties already use (bank transfer, card, ACP / AP2 mandates). Symbolon never moves money; it records commitments about it. A receipt layer that validates payment rails gets captured by them — so it doesn't.

## Lifecycle: five verbs, nothing else

```
intent.quote_requested → commitment.charged → commitment.reserved → commitment.redeemed
                                    │                   │
                                    └── commitment.released ◄┘
```

Each event is hash-chained to the previous one (edit anything, every later hash breaks) and Ed25519-signed by the issuer, whose public keys live at `https://<issuer>/.well-known/symbolon.json` — the trust anchor is the issuer's own domain, nothing else.

## Repository

| Path | What |
|---|---|
| [`spec.md`](spec.md) | The specification (v0.1 draft) — deliberately robots.txt-sized |
| [`schema.json`](schema.json) | JSON Schema 2020-12 for receipts + the well-known key document |
| [`verifier/index.html`](verifier/index.html) | Static, zero-server WebCrypto verifier |
| [`tools/verify.mjs`](tools/verify.mjs) | CLI verifier (Node 20+, zero dependencies) |
| [`tools/generate-example.mjs`](tools/generate-example.mjs) | Dev tool: keypair + signed example receipts |
| [`examples/`](examples/) | Worked examples, including a tampered receipt that must fail |

```bash
node tools/generate-example.mjs
node tools/verify.mjs examples/happy-path.json examples/well-known.json   # VALID
node tools/verify.mjs examples/tampered.json  examples/well-known.json   # INVALID (fail-closed)
```

## Status

**v0.1 working draft.** The first production issuer (a licensed travel-agency platform in Taiwan issuing planning-fee receipts for custom charter tours) is being wired up now. Deliberately deferred: disputes, multi-currency, partial redemption, discovery, agent identity attestation — the spec stays small or it dies.

Feedback and implementations welcome — open an issue.

## License

[CC0 1.0](LICENSE) — public domain. Free to implement, no royalties, forever. Protocols only work when nobody owns them.
