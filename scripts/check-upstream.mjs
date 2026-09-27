import { execFileSync } from 'node:child_process';

const [repository, upstream = 'upstream/main', tested = 'HEAD'] = process.argv.slice(2);
if (!repository) throw Error('Usage: node scripts/check-upstream.mjs /path/to/ZCode upstream-ref tested-ref');
const git = (...args) => {
  try {
    return execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    // Avoid echoing repository metadata and filesystem paths in errors.
    throw Error('Unable to read a Git object. Check the repository, refs and integration paths.');
  }
};
const upstreamCommit = git('rev-parse', '--verify', '--end-of-options', `${upstream}^{commit}`);
const testedCommit = git('rev-parse', '--verify', '--end-of-options', `${tested}^{commit}`);
const boundaries = [
  'packages/server/src/http.ts',
  'packages/rpc/src',
  'packages/services/src/zcode-agent',
  'packages/services/src/session/zcodeTaskService.ts',
  'packages/shared/src/zcode-protocol-v4',
  'packages/ui/src',
  'packages/web/src',
  'packages/zcode-server-cli',
  'apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4',
];
const comparisons = boundaries.map(path => {
  const upstreamObject = git('rev-parse', `${upstreamCommit}:${path}`);
  const testedObject = git('rev-parse', `${testedCommit}:${path}`);
  return { path, upstreamObject, identical: upstreamObject === testedObject };
});
console.log(JSON.stringify({
  upstreamCommit,
  comparisons,
  scope: 'Source comparison of nine integration paths against the recorded ZCode reference revision. Matching paths do not establish full application behavior or security equivalence.',
}, null, 2));
if (comparisons.some(item => !item.identical)) process.exitCode = 1;
