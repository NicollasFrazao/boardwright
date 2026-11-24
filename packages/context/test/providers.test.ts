import { fileURLToPath } from 'node:url';
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  DotcontextProvider,
  PlainContextProvider,
  RepositoryContextProvider,
} from '../src/index.ts';

function fixture(name: string): string {
  return fileURLToPath(new URL(
    `fixtures/${name}`,
    import.meta.url,
  ));
}

const dotcontext = new DotcontextProvider();

describe('DotcontextProvider on a copy of a real base (atena)', () => {
  it('returns the reviewer playbook, the review-phase skills and the context index', async () => {
    const context = await dotcontext.load(
      fixture('atena'),
      {
        phase: 'R',
        agent: 'code-reviewer',
      },
    );

    expect(context).toEqual({
      source: 'dotcontext',
      playbook: {
        agentType: 'code-reviewer',
        path: '.context/agents/code-reviewer.md',
      },
      skills: [
        expect.objectContaining({
          slug: 'api-design',
          path: '.context/skills/api-design/SKILL.md',
        }),
        expect.objectContaining({ slug: 'code-review' }),
        expect.objectContaining({ slug: 'pr-review' }),
        expect.objectContaining({ slug: 'security-audit' }),
      ],
      instructionFiles: ['.context/docs/README.md'],
      warnings: [],
    });
  });

  it('selects by the phase of the stage', async () => {
    const context = await dotcontext.load(
      fixture('atena'),
      {
        phase: 'E',
        agent: 'bug-fixer',
      },
    );

    expect(context.playbook?.agentType).toBe('bug-fixer');

    expect(context.skills.map((skill) => skill.slug)).toEqual([
      'bug-investigation',
      'commit-message',
      'refactoring',
      'test-generation',
    ]);
  });
});

describe('DotcontextProvider never adds what a repository does not have', () => {
  it('leaves out api-design in a repository that removed it', async () => {
    const context = await dotcontext.load(
      fixture('pruned'),
      {
        phase: 'R',
        agent: 'code-reviewer',
      },
    );

    expect(context.skills.map((skill) => skill.slug)).toEqual([
      'code-review',
      'pr-review',
    ]);

    expect(context.instructionFiles).toEqual([]);
  });

  it('warns when the playbook is missing, and returns none', async () => {
    const context = await dotcontext.load(
      fixture('pruned'),
      {
        phase: 'E',
        agent: 'feature-developer',
      },
    );

    expect(context.playbook).toBeUndefined();
    expect(context.warnings).toEqual(['No playbook for "feature-developer" in .context/agents.']);
  });

  it('warns when the playbook does not declare the phase, and still returns it', async () => {
    const context = await dotcontext.load(
      fixture('pruned'),
      {
        phase: 'E',
        agent: 'code-reviewer',
      },
    );

    expect(context.playbook?.agentType).toBe('code-reviewer');
    expect(context.warnings).toEqual(['The playbook "code-reviewer" does not declare phase E.']);
  });

  it('reports broken files instead of failing the run', async () => {
    const context = await dotcontext.load(
      fixture('broken'),
      {
        phase: 'R',
        agent: 'code-reviewer',
      },
    );

    expect(context.playbook).toBeUndefined();
    expect(context.skills).toEqual([]);

    expect(context.warnings).toEqual([
      expect.stringMatching(/^\.context\/agents\/code-reviewer\.md: /u),
      '.context/agents/no-type.md: the front matter has no agentType.',
      '.context/skills/no-front-matter/SKILL.md: no front matter.',
      'No playbook for "code-reviewer" in .context/agents.',
    ]);
  });
});

describe('PlainContextProvider', () => {
  it('lists the instruction files the repository has', async () => {
    const context = await new PlainContextProvider().load(fixture('plain'));

    expect(context).toEqual({
      source: 'plain',
      playbook: undefined,
      skills: [],
      instructionFiles: [
        'AGENTS.md',
        '.claude/CLAUDE.md',
      ],
      warnings: [],
    });
  });

  it('warns when there is nothing to read', async () => {
    const context = await new PlainContextProvider().load(fixture('empty'));

    expect(context.instructionFiles).toEqual([]);
    expect(context.warnings).toHaveLength(1);
  });
});

describe('RepositoryContextProvider', () => {
  const provider = new RepositoryContextProvider();

  const selector = {
    phase: 'R',
    agent: 'code-reviewer',
  } as const;

  it('uses the dotcontext base when the repository has one', async () => {
    expect((await provider.load(
      fixture('atena'),
      selector,
    )).source).toBe('dotcontext');
  });

  it('falls back to the plain files otherwise', async () => {
    expect((await provider.load(
      fixture('plain'),
      selector,
    )).source).toBe('plain');
  });
});
