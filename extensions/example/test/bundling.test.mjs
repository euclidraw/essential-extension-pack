import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import config, { sharedImports } from '../vite.config.js';

async function bundle(source) {
  const directory = await mkdtemp(join(tmpdir(), 'alid-template-bundle-'));
  try {
    const entry = join(directory, 'entry.js');await writeFile(entry, source);
    const result = await build({
      ...config, configFile: false, logLevel: 'silent',
      build: { ...config.build, write: false, lib: { ...config.build.lib, entry } },
    });
    return (Array.isArray(result) ? result[0] : result).output;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('SDK and React imports stay external and resolve through the host shared module map', async () => {
  const imports = sharedImports.map((id, index) => `import * as shared${index} from '${id}';`).join('\n');
  const output = await bundle(`${imports}\nexport default [${sharedImports.map((_, index) => `shared${index}`).join(',')}];`);
  assert.equal(output.length, 1);
  assert.deepEqual([...output[0].imports].sort(), [...sharedImports].sort());
  assert.ok(output[0].code.length < 4000);
});

test('unapproved bare imports fail instead of escaping into the runtime Blob module', async () => {
  await assert.rejects(() => bundle("import unknown from '@alid/not-a-shared-module'; export default unknown;"));
});
