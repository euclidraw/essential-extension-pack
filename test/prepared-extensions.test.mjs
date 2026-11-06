import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

test('pack lists all essential members in dependency order', async () => {
  const pack = JSON.parse(await readFile(new URL('../alid.extension.json', import.meta.url), 'utf8'));
  assert.deepEqual(pack.extensions.map(entry => entry.path), ['extensions/group', 'extensions/frame', 'extensions/connector', 'extensions/vector', 'extensions/image']);
});

for (const [directory, id, aspects] of [
  ['connector', 'connector.smart-wire', ['connector.ports', 'connector.wire']],
  ['vector', 'vector.pen-suite', ['vector.path']],
  ['image', 'media.image-suite', ['media.image']],
]) {
  test(`${directory} bundle matches its install manifest`, async () => {
    const root = new URL(`../extensions/${directory}/`, import.meta.url);
    const manifest = JSON.parse(await readFile(new URL('alid.extension.json', root), 'utf8'));
    const bundle = await readFile(new URL(manifest.entry, root));
    assert.equal(manifest.id, id);
    assert.deepEqual(manifest.aspectIds, aspects);
    assert.deepEqual(manifest.provides.aspects, aspects);
    assert.equal(createHash('sha256').update(bundle).digest('hex'), manifest.sha256);
  });
}
