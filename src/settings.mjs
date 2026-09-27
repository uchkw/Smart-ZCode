import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { savePrivate } from './push.mjs';

export async function createSettings(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, 'settings.json');
  let value = { escStopEnabled: true, revision: 0 };
  try {
    const saved = JSON.parse(await readFile(file, 'utf8'));
    if (typeof saved.escStopEnabled !== 'boolean' || !Number.isSafeInteger(saved.revision) || saved.revision < 0) throw Error('Invalid saved settings');
    value = { escStopEnabled: saved.escStopEnabled, revision: saved.revision };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let writes = Promise.resolve();
  return {
    get: () => ({ ...value }),
    update(patch) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).length !== 1 || typeof patch.escStopEnabled !== 'boolean') return Promise.reject(Error('Expected escStopEnabled boolean'));
      const enabled = patch.escStopEnabled;
      const operation = writes.catch(() => {}).then(async () => {
        const next = { escStopEnabled: enabled, revision: value.revision + 1 };
        await savePrivate(file, next);
        value = next;
        return { ...value };
      });
      writes = operation;
      return operation;
    },
  };
}
