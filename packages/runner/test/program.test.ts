import {
  scenario,
  type Scenario,
} from '@boardwright/testing';
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  EXIT,
  runProgram,
  USAGE,
  type ProgramEnvironment,
} from '../src/program.ts';

const CONFIG = `project:
  owner: acme
  number: 3
repositories:
  - acme/app
stages:
  - id: implement
`;

interface TestEnvironment extends ProgramEnvironment {
  readonly files: Map<string, string>;
  readonly out: string[];
  readonly err: string[];
  readonly tokens: string[];
}

function environment(
  world: Scenario = scenario(),
  variables: Record<string, string | undefined> = { GITHUB_TOKEN: 'secret' },
): TestEnvironment {
  const files = new Map([[
    'pipeline.config.yml',
    CONFIG,
  ]]);

  const out: string[] = [];
  const err: string[] = [];
  const tokens: string[] = [];

  return {
    files,
    out,
    err,
    tokens,
    variables,
    readFile: (path) => Promise.resolve(files.get(path)),
    createFile: (
      path,
      text,
    ) => {
      if (files.has(path)) {
        return Promise.resolve(false);
      }

      files.set(
        path,
        text,
      );

      return Promise.resolve(true);
    },
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    connect: (
      _config,
      token,
    ) => {
      tokens.push(token);

      return {
        board: world.board,
        repoHost: world.repoHost,
      };
    },
  };
}

describe('boardwright doctor', () => {
  it('prints every check and exits 0 when nothing fails', async () => {
    const env = environment();

    expect(await runProgram(
      ['doctor'],
      env,
    )).toBe(EXIT.ok);

    expect(env.out.join('\n')).toContain('ok    board acme#3: "Roadmap", Status: Todo, Ready, In Progress, In review, Done.');
    expect(env.out.join('\n')).toContain(' failures.');
    expect(env.tokens).toEqual(['secret']);
  });

  it('reads each repository\'s context base remotely', async () => {
    const world = scenario();

    world.repoHost.files.set(
      'acme/app:.context/agents/feature-developer.md',
      '---\nagentType: feature-developer\nphases: [E]\n---\n',
    );

    world.repoHost.files.set(
      'acme/app:.context/skills/commit-message/SKILL.md',
      '---\nskillSlug: commit-message\ndescription: Commits.\nphases: [E, C]\n---\n',
    );

    const env = environment(world);

    await runProgram(
      ['doctor'],
      env,
    );

    const output = env.out.join('\n');

    expect(output).toContain('ok    acme/app implement: dotcontext: playbook .context/agents/feature-developer.md, 1 skills for phase E.');
    expect(output).toContain('warn  acme/app implement: No playbook for "bug-fixer" in .context/agents.');
  });

  it('exits 1 when a check fails, and prints JSON on request', async () => {
    const world = scenario();

    world.board.statusOptions = ['Todo'];

    const env = environment(world);

    expect(await runProgram(
      [
        'doctor',
        '--json',
      ],
      env,
    )).toBe(EXIT.failed);

    expect(JSON.parse(env.out.join('\n'))).toMatchObject({ hasFailures: true });
  });

  it('exits 2 without a token, before reaching GitHub', async () => {
    const env = environment(
      scenario(),
      {},
    );

    expect(await runProgram(
      ['doctor'],
      env,
    )).toBe(EXIT.usage);

    expect(env.err).toEqual(['No GitHub token: set one of BOARDWRIGHT_GITHUB_TOKEN, GITHUB_TOKEN, GH_TOKEN.']);
    expect(env.tokens).toEqual([]);
  });

  it('prefers BOARDWRIGHT_GITHUB_TOKEN', async () => {
    const env = environment(
      scenario(),
      {
        GH_TOKEN: 'gh',
        BOARDWRIGHT_GITHUB_TOKEN: 'mine',
      },
    );

    await runProgram(
      ['doctor'],
      env,
    );

    expect(env.tokens).toEqual(['mine']);
  });

  it('exits 2 with every problem of an invalid config', async () => {
    const env = environment();

    env.files.set(
      'bad.yml',
      'project:\n  owner: acme\nrepositories: []\nstages: []\n',
    );

    expect(await runProgram(
      [
        'doctor',
        '--config',
        'bad.yml',
      ],
      env,
    )).toBe(EXIT.usage);

    expect(env.err[0]).toContain('bad.yml is not a valid pipeline config:');
    expect(env.err[0]).toContain('  - project.number');
  });

  it('exits 2 on a file that is not YAML, and on a missing file', async () => {
    const env = environment();

    env.files.set(
      'broken.yml',
      'project: [unclosed',
    );

    expect(await runProgram(
      [
        'doctor',
        '--config',
        'broken.yml',
      ],
      env,
    )).toBe(EXIT.usage);

    expect(env.err[0]).toContain('broken.yml is not valid YAML');

    expect(await runProgram(
      [
        'doctor',
        '--config',
        'missing.yml',
      ],
      env,
    )).toBe(EXIT.usage);

    expect(env.err[1]).toBe('missing.yml not found. Create one with boardwright init, or pass --config <path>.');
  });
});

describe('boardwright once --dry-run', () => {
  it('prints the plan and writes nothing', async () => {
    const world = scenario();
    const env = environment(world);

    expect(await runProgram(
      [
        'once',
        '--dry-run',
      ],
      env,
    )).toBe(EXIT.ok);

    expect(env.out.join('\n')).toBe('implement  acme/app#7  run attempt 1\n\nDry run: nothing was written.');

    expect(world.repoHost.bodies({
      repository: 'acme/app',
      number: 7,
    })).toEqual([]);

    expect(world.board.moves).toEqual([]);
  });

  it('describes every kind of action', async () => {
    const world = scenario();

    world.repoHost.issues.set(
      'acme/app#7',
      {
        ...await world.repoHost.getIssue({
          repository: 'acme/app',
          number: 7,
        }),
        labels: [],
      },
    );

    const env = environment(world);

    await runProgram(
      [
        'once',
        '--dry-run',
      ],
      env,
    );

    expect(env.out.join('\n')).toContain('implement  acme/app#7  skip (not-triggered)');
  });

  it('says so when nothing is in a starting Status', async () => {
    const world = scenario();

    world.board.items.length = 0;

    const env = environment(world);

    await runProgram(
      [
        'once',
        '--dry-run',
        '--json',
      ],
      env,
    );

    expect(JSON.parse(env.out.join('\n'))).toEqual({ entries: [] });

    await runProgram(
      [
        'once',
        '--dry-run',
      ],
      env,
    );

    expect(env.out.at(-1)).toBe('Nothing to do: no item is in a Status a stage starts from.\n\nDry run: nothing was written.');
  });

  it('refuses to act without --dry-run until the agent adapters exist', async () => {
    const env = environment();

    expect(await runProgram(
      ['once'],
      env,
    )).toBe(EXIT.usage);

    expect(env.err[0]).toContain('use once --dry-run');
  });
});

describe('boardwright init', () => {
  const args = [
    'init',
    '--owner',
    'acme',
    '--project',
    '3',
    '--repository',
    'acme/app',
    '--repository',
    'acme/api',
    '--config',
    'new.yml',
  ];

  it('writes a valid, commented starter config', async () => {
    const env = environment();

    expect(await runProgram(
      args,
      env,
    )).toBe(EXIT.ok);

    expect(env.files.get('new.yml')).toContain('  - acme/api\nstages:');
    expect(env.out).toEqual(['Wrote new.yml. Run boardwright doctor to check it against the board.']);
  });

  it('never overwrites a config', async () => {
    const env = environment();

    env.files.set(
      'new.yml',
      'mine',
    );

    expect(await runProgram(
      args,
      env,
    )).toBe(EXIT.usage);

    expect(env.files.get('new.yml')).toBe('mine');
  });

  it.each([
    [
      'without a repository',
      [
        'init',
        '--owner',
        'acme',
        '--project',
        '3',
      ],
    ],
    [
      'with a project that is not a number',
      [
        'init',
        '--owner',
        'acme',
        '--project',
        'three',
        '--repository',
        'acme/app',
      ],
    ],
  ])('refuses to run %s', async (
    _case,
    argv,
  ) => {
    const env = environment();

    expect(await runProgram(
      argv,
      env,
    )).toBe(EXIT.usage);

    expect(env.err[0]).toContain('init needs --owner');
  });

  it('rejects a repository that is not owner/name, writing nothing', async () => {
    const env = environment();

    expect(await runProgram(
      [
        'init',
        '--owner',
        'acme',
        '--project',
        '3',
        '--repository',
        'app',
        '--config',
        'new.yml',
      ],
      env,
    )).toBe(EXIT.usage);

    expect(env.files.has('new.yml')).toBe(false);
  });
});

describe('boardwright help', () => {
  it.each([
    [[]],
    [['--help']],
    [['help']],
  ])('prints the usage for %j', async (argv) => {
    const env = environment();

    expect(await runProgram(
      argv,
      env,
    )).toBe(EXIT.ok);

    expect(env.out).toEqual([USAGE]);
  });

  it('exits 2 on an unknown command', async () => {
    const env = environment();

    expect(await runProgram(
      ['deploy'],
      env,
    )).toBe(EXIT.usage);

    expect(env.err[0]).toContain('Unknown command "deploy".');
  });

  it('lets unexpected errors through', async () => {
    const world = scenario();

    world.board.describe = () => Promise.reject(new TypeError('boom'));
    world.board.listItems = () => Promise.reject(new TypeError('boom'));

    await expect(runProgram(
      [
        'once',
        '--dry-run',
      ],
      environment(world),
    )).rejects.toThrow('boom');
  });
});
