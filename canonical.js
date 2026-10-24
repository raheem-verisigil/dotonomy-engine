import crypto from 'node:crypto';

const sort = value =>
  Array.isArray(value)
    ? value.map(sort)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value).sort().map(key => [key, sort(value[key])])
        )
      : value;

export const canon = value => JSON.stringify(sort(value));

export const sha = value =>
  'sha256:' + crypto.createHash('sha256').update(value).digest('hex');
