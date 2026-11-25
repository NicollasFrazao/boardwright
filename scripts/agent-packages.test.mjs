import { describe, expect, it } from 'vitest';
import { AGENT_SDK, pinnedAgentPackages } from './agent-packages.mjs';

const entry = (name, extra = {}) => ({
  version: '1.2.3',
  resolved: `https://registry.npmjs.org/${name}/-/x-1.2.3.tgz`,
  integrity: `sha512-${name}`,
  ...extra,
});

describe('pinnedAgentPackages', () => {
  it('takes the SDK and its native binaries, with their platform fields, sorted by name', () => {
    const lock = {
      packages: {
        '': { name: 'root' },
        'node_modules/@anthropic-ai/claude-agent-sdk-linux-x64': entry('linux', { os: ['linux'], cpu: ['x64'], libc: ['glibc'] }),
        'node_modules/@anthropic-ai/claude-agent-sdk': entry('sdk'),
        'node_modules/zod': entry('zod'),
      },
    };

    expect(pinnedAgentPackages(lock)).toEqual([
      { name: AGENT_SDK, version: '1.2.3', url: lock.packages['node_modules/@anthropic-ai/claude-agent-sdk'].resolved, integrity: 'sha512-sdk' },
      {
        name: `${AGENT_SDK}-linux-x64`,
        version: '1.2.3',
        url: lock.packages['node_modules/@anthropic-ai/claude-agent-sdk-linux-x64'].resolved,
        integrity: 'sha512-linux',
        os: ['linux'],
        cpu: ['x64'],
        libc: ['glibc'],
      },
    ]);
  });

  it('ignores a copy nested under another package', () => {
    const lock = {
      packages: {
        'node_modules/@anthropic-ai/claude-agent-sdk': entry('sdk'),
        'node_modules/other/node_modules/@anthropic-ai/claude-agent-sdk': entry('nested'),
      },
    };

    expect(pinnedAgentPackages(lock).map((source) => source.integrity)).toEqual(['sha512-sdk']);
  });

  it('refuses a lockfile without the SDK, or an entry without its tarball', () => {
    expect(() => pinnedAgentPackages({ packages: {} })).toThrow('does not pin');

    expect(() => pinnedAgentPackages({
      packages: { 'node_modules/@anthropic-ai/claude-agent-sdk': { version: '1.2.3' } },
    })).toThrow('no tarball or integrity');
  });
});
