import { canon, sha } from './canonical.js';

const STATUSES = new Set(['unverified', 'rejected']);

// Bind each original provenance record to the exact payload captured with it.
// WeakMap entries are private and are not serialized into receipts.
const capturedPayloads = new WeakMap();

const ORIGINS = new Set([
  'fixture',
  'calendar-ics',
  'crm',
  'mail',
  'docs',
  'unknown'
]);

// Require a complete timestamp with seconds and an explicit timezone.
// Validate calendar and clock components separately; Date.parse alone is permissive.
function parseTimestamp(value) {
  if (typeof value !== 'string') return null;

  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
  );

  if (!match) return null;

  const [, y, mo, d, h, mi, s, , zone] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);

  const calendar = new Date(Date.UTC(year, month - 1, day));

  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }

  if (zone !== 'Z') {
    const offsetMatch = /^([+-])(\d{2}):(\d{2})$/.exec(zone);
    if (!offsetMatch) return null;

    const [, sign, hoursText, minutesText] = offsetMatch;
    const offsetHours = Number(hoursText);
    const offsetMinutes = Number(minutesText);

    if (offsetHours > 23 || offsetMinutes > 59) return null;
    if (sign !== '+' && sign !== '-') return null;
  }

  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;

  return new Date(milliseconds).toISOString();
}

function validAuthorizationRef(value) {
  return value === null ||
    (typeof value === 'string' && value.trim().length > 0);
}

/**
 * Create an unverified provenance record.
 *
 * This function deliberately does not accept a caller-selected verification
 * status. A payload hash establishes integrity consistency only; it does not
 * authenticate the source, prove freshness, or establish authorization.
 */
export function createProvenance({
  sourceId,
  origin,
  retrievedAt,
  recordTime = null,
  authorizationRef = null,
  payload,
  limitations = []
}) {
  if (typeof sourceId !== 'string' || !sourceId.trim()) {
    throw new TypeError('sourceId must be a non-empty string');
  }

  if (!ORIGINS.has(origin)) {
    throw new TypeError('origin is not registered');
  }

  const normalizedRetrievedAt = parseTimestamp(retrievedAt);
  if (!normalizedRetrievedAt) {
    throw new TypeError(
      'retrievedAt must be a strict ISO 8601 timestamp with timezone'
    );
  }

  const normalizedRecordTime =
    recordTime === null ? null : parseTimestamp(recordTime);

  if (recordTime !== null && !normalizedRecordTime) {
    throw new TypeError(
      'recordTime must be a strict ISO 8601 timestamp with timezone or null'
    );
  }

  if (!validAuthorizationRef(authorizationRef)) {
    throw new TypeError(
      'authorizationRef must be a non-empty string or null'
    );
  }

  if (!Array.isArray(limitations) ||
      limitations.some(item => typeof item !== 'string')) {
    throw new TypeError('limitations must be an array of strings');
  }

  if (payload === undefined) {
    throw new TypeError('payload is required');
  }

  const frozenLimitations = Object.freeze([...limitations]);

  const record = Object.freeze({
    schema: 'dotonomy.source-provenance',
    version: '1.0.0',
    source_id: sourceId,
    origin,
    retrieved_at: normalizedRetrievedAt,
    record_time: normalizedRecordTime,
    authorization_ref: authorizationRef,
    integrity_hash: sha(canon(payload)),
    verification_status: 'unverified',
    limitations: frozenLimitations
  });

  capturedPayloads.set(record, payload);
  return record;
}

/**
 * Validate a record against the exact payload captured when that record
 * was created in this process. Copied or fabricated records fail closed.
 *
 * This proves neither source authenticity nor source authorization/freshness.
 */
export function validateCapturedProvenance(record) {
  if (!record || typeof record !== 'object' ||
      !capturedPayloads.has(record)) {
    return { valid: false, reason: 'CAPTURED_PAYLOAD_UNAVAILABLE' };
  }

  return validateProvenance(record, capturedPayloads.get(record));
}

/**
 * Validate structure, field types, timestamps and payload hash consistency.
 * A valid result does not establish source authenticity.
 */
export function validateProvenance(record, payload) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { valid: false, reason: 'MALFORMED_RECORD' };
  }

  const required = [
    'schema',
    'version',
    'source_id',
    'origin',
    'retrieved_at',
    'record_time',
    'authorization_ref',
    'integrity_hash',
    'verification_status',
    'limitations'
  ];

  if (required.some(key => !Object.hasOwn(record, key))) {
    return { valid: false, reason: 'MISSING_FIELDS' };
  }

  if (
    record.schema !== 'dotonomy.source-provenance' ||
    record.version !== '1.0.0'
  ) {
    return { valid: false, reason: 'UNSUPPORTED_SCHEMA' };
  }

  if (
    typeof record.source_id !== 'string' ||
    !record.source_id.trim() ||
    !ORIGINS.has(record.origin) ||
    !STATUSES.has(record.verification_status) ||
    !parseTimestamp(record.retrieved_at) ||
    (record.record_time !== null && !parseTimestamp(record.record_time)) ||
    !validAuthorizationRef(record.authorization_ref) ||
    typeof record.integrity_hash !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/.test(record.integrity_hash) ||
    !Array.isArray(record.limitations) ||
    record.limitations.some(item => typeof item !== 'string')
  ) {
    return { valid: false, reason: 'INVALID_FIELDS' };
  }

  if (payload === undefined) {
    return { valid: false, reason: 'PAYLOAD_REQUIRED' };
  }

  if (record.integrity_hash !== sha(canon(payload))) {
    return { valid: false, reason: 'PAYLOAD_HASH_MISMATCH' };
  }

  return {
    valid: true,
    reason: 'Structure and payload hash match; source authenticity is not established'
  };
}
