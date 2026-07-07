#!/usr/bin/env node
// Symbolon v0.1 — example generator (zero deps, Node 20+)
// Generates an Ed25519 keypair, a well-known document, and signed example receipts.
import { generateKeyPairSync, sign as edSign, createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'examples');
mkdirSync(out, { recursive: true });

// --- JCS (RFC 8785) subset: no floats exist in the schema ---
export function jcs(v) {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new Error('floats are prohibited');
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return '[' + v.map(jcs).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + jcs(v[k])).join(',') + '}';
}

const sha256hex = (buf) => createHash('sha256').update(buf).digest('hex');

// --- keypair ---
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const spki = publicKey.export({ type: 'spki', format: 'der' });
const rawPub = spki.subarray(spki.length - 32); // raw 32-byte key
const wellKnown = {
  spec_version: '0.1',
  keys: [{ kid: '2026-01', alg: 'ed25519', pub: rawPub.toString('base64') }],
};

// --- receipt builder (spec §4: context binding + domain separation + kid) ---
const KID = '2026-01';
function buildReceipt({ receipt_id, expires_at, eventSpecs }) {
  const receipt = {
    spec_version: '0.1',
    receipt_id,
    issuer: {
      name: 'Formosa Charter Tours Co., Ltd.',
      id: 'https://tours.example.tw',
      license: 'TQAA Travel Agency No. 1234',
      key_url: 'https://tours.example.tw/.well-known/symbolon.json',
    },
    principal_ref: 'cust-ref-7f3a',
    agent: { id: 'urn:agent:claude', on_behalf_of: 'principal' },
    commitment: {
      amount_decimal: '1000.00',
      currency: 'TWD',
      terms_url: 'https://tours.example.tw/planning-fee-terms',
      terms_digest: 'sha256:' + sha256hex(Buffer.from('Planning fee terms v1: non-refundable; redeemable against any formal quote for the same inquiry within validity.', 'utf8')),
      expires_at,
      payment_reference: { type: 'manual_transfer', ref: 'TXN-20260707-001' },
    },
    events: [],
  };
  const { events: _omit, ...receiptCore } = receipt;
  const context = sha256hex(Buffer.from('symbolon:v0.1:receipt\n' + jcs(receiptCore), 'utf8'));
  let prev = null;
  eventSpecs.forEach((e, i) => {
    const core = { seq: i + 1, type: e.type, at: e.at, actor: e.actor, prev_hash: prev, kid: KID };
    if (e.detail) core.detail = e.detail;
    const hash = 'sha256:' + sha256hex(Buffer.from('symbolon:v0.1:event\n' + context + '\n' + jcs(core), 'utf8'));
    const sig = 'ed25519:' + edSign(null, Buffer.from('symbolon:v0.1:sig\n' + hash, 'utf8'), privateKey).toString('base64');
    receipt.events.push({ ...core, hash, sig });
    prev = hash;
  });
  return receipt;
}

const happy = buildReceipt({
  receipt_id: 'sym_happy001',
  expires_at: '2026-09-05T00:00:00Z',
  eventSpecs: [
    { type: 'intent.quote_requested', at: '2026-07-07T03:00:00Z', actor: 'agent', detail: { inquiry_ref: 'inq_123' } },
    { type: 'commitment.charged', at: '2026-07-08T05:30:00Z', actor: 'issuer', detail: { note: 'planning fee received' } },
    { type: 'commitment.reserved', at: '2026-07-15T09:00:00Z', actor: 'issuer', detail: { quote_ref: 'Q-20260715-1001' } },
    { type: 'commitment.redeemed', at: '2026-07-20T02:00:00Z', actor: 'issuer', detail: { order_ref: 'Q-20260715-1001' } },
  ],
});

const released = buildReceipt({
  receipt_id: 'sym_released01',
  expires_at: '2026-06-01T00:00:00Z', // in the past → dynamically expired
  eventSpecs: [
    { type: 'intent.quote_requested', at: '2026-03-01T03:00:00Z', actor: 'agent', detail: { inquiry_ref: 'inq_045' } },
    { type: 'commitment.charged', at: '2026-03-02T05:00:00Z', actor: 'issuer' },
    { type: 'commitment.reserved', at: '2026-03-10T09:00:00Z', actor: 'issuer', detail: { quote_ref: 'Q-20260310-1002' } },
    { type: 'commitment.released', at: '2026-03-12T01:00:00Z', actor: 'issuer', detail: { reason: 'quote declined' } },
  ],
});

// tampered: the header attack the 2026-07-07 security review caught —
// alter commitment.amount_decimal but keep all original hashes/sigs.
// Under the pre-review scheme this VERIFIED (events[] didn't cover the header);
// with receipt-context binding it MUST fail at the hash-chain step.
const tampered = JSON.parse(JSON.stringify(happy));
tampered.commitment.amount_decimal = '9000.00';

writeFileSync(join(out, 'well-known.json'), JSON.stringify(wellKnown, null, 2) + '\n');
writeFileSync(join(out, 'happy-path.json'), JSON.stringify(happy, null, 2) + '\n');
writeFileSync(join(out, 'released-then-expired.json'), JSON.stringify(released, null, 2) + '\n');
writeFileSync(join(out, 'tampered.json'), JSON.stringify(tampered, null, 2) + '\n');
console.log('wrote examples/: well-known.json, happy-path.json, released-then-expired.json, tampered.json');
