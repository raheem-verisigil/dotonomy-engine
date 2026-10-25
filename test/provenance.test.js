import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProvenance,
  validateProvenance
} from '../provenance.js';

const retrievedAt = '2026-10-24T10:00:00.000Z';
const payload = { id: 'crm:acc_88', stage: 'Negotiation' };

const make = overrides => createProvenance({
  sourceId: 'crm:acc_88',
  origin: 'crm',
  retrievedAt,
  payload,
  ...overrides
});

test('accepts valid positive and negative timezone offsets', () => {
  for (const value of [
    '2026-10-24T10:00:00+01:00',
    '2026-10-24T10:00:00-05:30',
    '2026-10-24T10:00:00Z'
  ]) {
    assert.doesNotThrow(() => make({ retrievedAt: value }));
  }
});

test('timezone offset parser accepts valid offsets and rejects malformed ones', () => {
  for (const value of [
    '2026-10-24T10:00:00+01:00',
    '2026-10-24T10:00:00-05:30',
    '2026-10-24T10:00:00Z'
  ]) {
    assert.doesNotThrow(() => make({ retrievedAt: value }));
  }

  for (const value of [
    '2026-10-24T10:00:00+24:00',
    '2026-10-24T10:00:00+01:60',
    '2026-10-24T10:00:00+0100'
  ]) {
    assert.throws(() => make({ retrievedAt: value }), /retrievedAt/);
  }
});

test('rejects invalid timezone offsets and impossible calendar dates', () => {
  for (const value of [
    '2026-10-24T10:00:00+24:00',
    '2026-10-24T10:00:00+01:60',
    '2026-10-24T10:00:00+0100',
    '2026-02-30T10:00:00+01:00'
  ]) {
    assert.throws(() => make({ retrievedAt: value }), /retrievedAt/);
  }
});

test('creates provenance bound to the canonical payload hash', () => {
  const record = make();
  assert.equal(record.schema, 'dotonomy.source-provenance');
  assert.equal(record.verification_status, 'unverified');
  assert.match(record.integrity_hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(validateProvenance(record, payload).valid, true);
});

test('detects payload changes', () => {
  const record = make();
  assert.deepEqual(
    validateProvenance(record, { ...payload, stage: 'Closed Won' }),
    { valid: false, reason: 'PAYLOAD_HASH_MISMATCH' }
  );
});

test('rejects incomplete or invalid retrieved timestamps', () => {
  for (const value of [
    'not-a-date',
    '2026-10-24',
    '2026-10-24T10:00:00',
    '2026-02-30T10:00:00Z',
    '2026-10-24T25:00:00Z',
    '2026-10-24T10:00:00+25:00'
  ]) {
    assert.throws(() => make({ retrievedAt: value }), /retrievedAt/);
  }
});

test('rejects invalid record timestamps', () => {
  assert.throws(
    () => make({ recordTime: '2026-02-30T10:00:00Z' }),
    /recordTime/
  );
});

test('rejects unregistered origins', () => {
  assert.throws(
    () => make({ origin: 'caller-claimed-source' }),
    /origin/
  );
});

test('verification status cannot be selected by the caller', () => {
  const record = make({ verificationStatus: 'verified' });
  assert.equal(record.verification_status, 'unverified');

  const forged = { ...record, verification_status: 'verified' };
  assert.deepEqual(
    validateProvenance(forged, payload),
    { valid: false, reason: 'INVALID_FIELDS' }
  );
});

test('fixture evidence remains unverified', () => {
  const record = createProvenance({
    sourceId: 'fixture:crm:acc_88',
    origin: 'fixture',
    retrievedAt,
    payload
  });

  assert.equal(record.verification_status, 'unverified');
  assert.equal(validateProvenance(record, payload).valid, true);
});

test('rejects missing payload', () => {
  assert.throws(
    () => createProvenance({
      sourceId: 'crm:acc_88',
      origin: 'crm',
      retrievedAt
    }),
    /payload/
  );
});

test('rejects malformed and incomplete provenance', () => {
  assert.deepEqual(
    validateProvenance(null, payload),
    { valid: false, reason: 'MALFORMED_RECORD' }
  );

  assert.deepEqual(
    validateProvenance({ schema: 'dotonomy.source-provenance' }, payload),
    { valid: false, reason: 'MISSING_FIELDS' }
  );
});

test('limitations and record are immutable', () => {
  const record = make({ limitations: ['source not authenticated'] });

  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.limitations), true);
  assert.throws(() => record.limitations.push('changed'), TypeError);
  assert.throws(() => { record.verification_status = 'rejected'; }, TypeError);
});

test('rejects invalid authorization references and integrity hashes', () => {
  assert.throws(
    () => make({ authorizationRef: '   ' }),
    /authorizationRef/
  );

  const record = make();
  assert.deepEqual(
    validateProvenance({ ...record, integrity_hash: 'sha256:invalid' }, payload),
    { valid: false, reason: 'INVALID_FIELDS' }
  );
});

test('a matching hash does not claim source authenticity', () => {
  const result = validateProvenance(make(), payload);
  assert.equal(result.valid, true);
  assert.match(result.reason, /authenticity is not established/);
});
