import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

// Read-only; never print a matching value. Local secrets are compared in memory.
const git = (...args) => execFileSync('git', args, { maxBuffer: 32 * 1024 * 1024 });
const known = [];
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const match = line.match(/^(ZCODE_TOKEN|SMART_PUBLIC_ORIGIN)=(.*)$/);
    if (match) {
      const value = match[2].trim().replace(/^['"]|['"]$/g, '');
      if (value.length >= 12) known.push([match[1], value]);
      if (match[1] === 'SMART_PUBLIC_ORIGIN' && value) known.push(['DEPLOYMENT_HOST', new URL(value).hostname]);
    }
  }
}
if (existsSync('.state/vapid.json')) known.push(['VAPID_PRIVATE_KEY', JSON.parse(readFileSync('.state/vapid.json')).privateKey]);
if (existsSync('.state/subscriptions.json')) for (const s of JSON.parse(readFileSync('.state/subscriptions.json'))) known.push(['PUSH_ENDPOINT', s.endpoint], ['PUSH_AUTH', s.keys.auth]);
const patterns = [
  ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['github_token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
  ['personal_home_path', /\/home\/[a-zA-Z0-9_-]+\//],
  ['private_ipv4', /\b(?:192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)\b/],
];
const findings = []; let blobs = 0, commits = 0;
for (const line of git('rev-list', '--objects', '--all', '--reflog').toString().trim().split('\n')) {
  const [object, ...pathParts] = line.split(' '); const path = pathParts.join(' ');
  const type = git('cat-file', '-t', object).toString().trim();
  if (!['blob', 'commit'].includes(type)) continue;
  if (type === 'blob') blobs++; else commits++;
  const raw = git('cat-file', type, object).toString();
  const content = type === 'commit' ? raw.slice(raw.indexOf('\n\n') + 2) : raw;
  for (const [kind, value] of known) if (value && content.includes(value)) findings.push({ kind, path, object });
  for (const [kind, pattern] of patterns) if (pattern.test(content)) findings.push({ kind, path, object });
}
const identities = new Set(git('log', '--all', '--format=%an <%ae>%n%cn <%ce>').toString().trim().split('\n'));
console.log(JSON.stringify({ blobs, commits, findings, identityCount: identities.size, identityNote: 'Author/committer names and emails are present in Git metadata. Review them privately with git log --format=fuller.', limitations: 'Pattern and known-value scan of tracked blobs and commit messages, not proof that every possible secret is absent. Review new files, archives and images before publishing.' }, null, 2));
if (findings.length) process.exitCode = 1;
