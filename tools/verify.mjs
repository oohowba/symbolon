#!/usr/bin/env node
// Symbolon v0.1 — CLI verifier (zero deps, Node 20+). Fail-closed.
// Usage: node tools/verify.mjs <receipt.json> <well-known.json>
import { verify as edVerify, createPublicKey, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [receiptPath, wkPath] = process.argv.slice(2);
if (!receiptPath || !wkPath) {
  console.error('usage: node tools/verify.mjs <receipt.json> <well-known.json>');
  process.exit(2);
}

function jcs(v) {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new Error('floats are prohibited');
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return '[' + v.map(jcs).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + jcs(v[k])).join(',') + '}';
}
const sha256hex = (buf) => createHash('sha256').update(buf).digest('hex');

const EVENT_TYPES = ['intent.quote_requested', 'commitment.charged', 'commitment.reserved', 'commitment.redeemed', 'commitment.released'];
const steps = [];
let failed = false;
function step(name, fn) {
  if (failed) { steps.push([name, 'SKIP', 'previous step failed']); return; }
  try {
    const note = fn();
    steps.push([name, 'PASS', note ?? '']);
  } catch (e) {
    failed = true;
    steps.push([name, 'FAIL', e.message]);
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
const wellKnown = JSON.parse(readFileSync(wkPath, 'utf8'));
let effectiveState = null;

// 1. schema-lite validation (structure, patterns, enums)
step('1 schema', () => {
  assert(receipt.spec_version === '0.1', 'spec_version must be "0.1"');
  assert(/^sym_[a-z0-9]{6,64}$/.test(receipt.receipt_id ?? ''), 'bad receipt_id');
  const iss = receipt.issuer ?? {};
  assert(typeof iss.name === 'string' && iss.name.length >= 1, 'issuer.name required');
  assert(/^https:\/\//.test(iss.id ?? ''), 'issuer.id must be https URL');
  assert(/^https:\/\//.test(iss.key_url ?? ''), 'issuer.key_url must be https URL');
  assert(iss.key_url === new URL(iss.id).origin + '/.well-known/symbolon.json', 'key_url must be the fixed well-known path on issuer.id origin');
  assert(typeof receipt.principal_ref === 'string' && receipt.principal_ref.length >= 1, 'principal_ref required');
  assert(receipt.agent?.on_behalf_of === 'principal', 'agent.on_behalf_of must be "principal"');
  const c = receipt.commitment ?? {};
  assert(/^[0-9]+(\.[0-9]{1,4})?$/.test(c.amount_decimal ?? '') && parseFloat(c.amount_decimal) > 0, 'bad amount_decimal (must be positive decimal string)');
  if (c.terms_digest !== undefined) assert(/^sha256:[0-9a-f]{64}$/.test(c.terms_digest), 'bad terms_digest');
  assert(/^[A-Z]{3}$/.test(c.currency ?? ''), 'bad currency');
  assert(!Number.isNaN(Date.parse(c.expires_at ?? '')), 'bad expires_at');
  assert(typeof c.payment_reference?.type === 'string' && typeof c.payment_reference?.ref === 'string', 'payment_reference {type, ref} required');
  assert(Array.isArray(receipt.events) && receipt.events.length >= 1 && receipt.events.length <= 64, 'events must be 1..64');
  receipt.events.forEach((ev, i) => {
    assert(ev.seq === i + 1, `event ${i + 1}: seq must be consecutive`);
    assert(EVENT_TYPES.includes(ev.type), `event ${i + 1}: unknown type ${ev.type}`);
    assert(['agent', 'principal', 'issuer'].includes(ev.actor), `event ${i + 1}: bad actor`);
    assert(!Number.isNaN(Date.parse(ev.at ?? '')), `event ${i + 1}: bad at`);
    assert(i === 0 ? ev.prev_hash === null : /^sha256:[0-9a-f]{64}$/.test(ev.prev_hash ?? ''), `event ${i + 1}: bad prev_hash`);
    assert(typeof ev.kid === 'string' && ev.kid.length >= 1 && ev.kid.length <= 64, `event ${i + 1}: bad kid`);
    assert(/^sha256:[0-9a-f]{64}$/.test(ev.hash ?? ''), `event ${i + 1}: bad hash`);
    assert(/^ed25519:[A-Za-z0-9+/]{86}==$/.test(ev.sig ?? ''), `event ${i + 1}: bad sig`);
    if (i > 0) assert(Date.parse(ev.at) >= Date.parse(receipt.events[i - 1].at), `event ${i + 1}: timestamp must be non-decreasing`);
  });
  return `${receipt.events.length} events`;
});

// 2. context + hash chain (spec §4: header fields are covered via receipt-context binding)
step('2 hash chain', () => {
  const { events: _omit, ...receiptCore } = receipt;
  const context = sha256hex(Buffer.from('symbolon:v0.1:receipt\n' + jcs(receiptCore), 'utf8'));
  let prev = null;
  for (const [i, ev] of receipt.events.entries()) {
    assert(ev.prev_hash === prev, `event ${i + 1}: prev_hash mismatch`);
    const { hash, sig, ...core } = ev;
    const expected = 'sha256:' + sha256hex(Buffer.from('symbolon:v0.1:event\n' + context + '\n' + jcs(core), 'utf8'));
    assert(ev.hash === expected, `event ${i + 1}: hash mismatch (tampered header or event?)`);
    prev = ev.hash;
  }
  return 'header + events bound';
});

// 3. signatures against issuer keys (selected by kid — no trial-and-error)
step('3 signatures', () => {
  assert(wellKnown.spec_version === '0.1' && Array.isArray(wellKnown.keys) && wellKnown.keys.length >= 1, 'bad well-known document');
  const keysByKid = new Map();
  for (const k of wellKnown.keys.filter(k => k.alg === 'ed25519')) {
    const raw = Buffer.from(k.pub, 'base64');
    if (raw.length !== 32) throw new Error(`key ${k.kid}: pub must be raw 32 bytes`);
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]);
    keysByKid.set(k.kid, createPublicKey({ key: spki, format: 'der', type: 'spki' }));
  }
  for (const [i, ev] of receipt.events.entries()) {
    const key = keysByKid.get(ev.kid);
    assert(key, `event ${i + 1}: kid "${ev.kid}" not found in well-known keys`);
    const sig = Buffer.from(ev.sig.slice('ed25519:'.length), 'base64');
    const ok = edVerify(null, Buffer.from('symbolon:v0.1:sig\n' + ev.hash, 'utf8'), key, sig);
    assert(ok, `event ${i + 1}: signature does not verify against key "${ev.kid}"`);
  }
  return `${wellKnown.keys.length} issuer key(s)`;
});

// 4. state machine replay (incl. expiry rules: reserve/redeem blocked after expiry, release never)
step('4 state machine', () => {
  let state = null; // null → inquired → charged → reserved → redeemed
  const expiresAt = Date.parse(receipt.commitment.expires_at);
  for (const [i, ev] of receipt.events.entries()) {
    const bad = (msg) => { throw new Error(`event ${i + 1}: ${msg ?? `illegal transition ${state} → ${ev.type}`}`); };
    switch (ev.type) {
      case 'intent.quote_requested': if (state !== null) bad(); state = 'inquired'; break;
      case 'commitment.charged': if (state !== 'inquired') bad(); state = 'charged'; break;
      case 'commitment.reserved':
        if (state !== 'charged') bad();
        if (Date.parse(ev.at) > expiresAt) bad('reserved after expiry');
        state = 'reserved'; break;
      case 'commitment.redeemed':
        if (state !== 'reserved') bad();
        if (Date.parse(ev.at) > expiresAt) bad('redeemed after expiry');
        state = 'redeemed'; break;
      case 'commitment.released': if (state !== 'reserved') bad(); state = 'charged'; break;
      default: bad();
    }
  }
  effectiveState = state;
  return `final state: ${state}`;
});

// 5. effective state incl. dynamic expiry
step('5 effective state', () => {
  if (effectiveState !== 'redeemed' && Date.parse(receipt.commitment.expires_at) < Date.now()) {
    effectiveState = `${effectiveState} (EXPIRED)`;
  }
  return effectiveState;
});

for (const [name, verdict, note] of steps) {
  console.log(`${verdict.padEnd(4)} ${name}${note ? ' — ' + note : ''}`);
}
console.log(failed ? '\nRESULT: INVALID (fail-closed)' : `\nRESULT: VALID — effective state: ${effectiveState}`);
process.exit(failed ? 1 : 0);
