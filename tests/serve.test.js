import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, sep } from 'node:path';
import { resolveRequestPath } from '../tools/serve.mjs';

const root = resolve('/srv/everwake');

const inside = (p) => p === root || p.startsWith(root + sep);

test('maps URL paths inside the project root', () => {
  assert.equal(resolveRequestPath(root, '/'), root);
  assert.equal(resolveRequestPath(root, '/src/main.js?v=1'), resolve(root, 'src/main.js'));
  assert.equal(resolveRequestPath(root, '/css/main.css#x'), resolve(root, 'css/main.css'));
});

test('traversal attempts never resolve outside the root', () => {
  for (const url of ['/../secret.txt', '/%2e%2e/secret.txt', '/src/../../x', '/..%2f..%2fx', '/a/../b']) {
    const out = resolveRequestPath(root, url);
    assert.ok(out === null || inside(out), `${url} -> ${out}`);
  }
});
