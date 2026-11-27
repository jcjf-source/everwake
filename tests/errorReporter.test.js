import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatError } from '../src/core/errorReporter.js';

test('formats Error instances with name, message and stack', () => {
  const err = new TypeError('bad thing');
  const out = formatError(err, 'Startup failed');
  assert.equal(out.message, 'Startup failed: TypeError: bad thing');
  assert.equal(out.detail, err.stack);
});

test('formats strings, null, undefined and objects', () => {
  assert.equal(formatError('oops').message, 'Error: oops');
  assert.equal(formatError(null).message, 'Error: null was thrown');
  assert.equal(formatError(undefined).message, 'Error: undefined was thrown');
  assert.equal(formatError({ code: 7 }).message, 'Error: {"code":7}');
  assert.equal(formatError(42).message, 'Error: 42');
});

test('handles values JSON cannot serialise', () => {
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(formatError(cyclic).message, 'Error: [object Object]');
  assert.equal(formatError(10n).message, 'Error: 10');
  assert.equal(formatError(Symbol('s')).message, 'Error: Symbol(s)');
});
