import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  DEFAULT_DENIED_PATHS,
  InvalidConfigError,
  parsePipelineConfig,
  stageLimits,
} from '../src/index.ts';
import {
  baseConfig,
  firstStage,
} from './fakes.ts';

describe('parsePipelineConfig', () => {
  it('fills every default the docs promise', () => {
    const config = baseConfig();

    expect(config.trigger).toEqual({
      label: 'agent',
      requireTriage: true,
    });

    expect(config.concurrency).toBe(1);
    expect(config.provider.name).toBe('claude');

    expect(config.guardRails).toEqual({
      deniedPaths: DEFAULT_DENIED_PATHS,
      maxTurns: 80,
      timeoutMinutes: 60,
      maxAttempts: 3,
    });

    expect(config.stages[0]).toEqual({
      id: 'implement',
      when: { status: 'Ready' },
      claim: { status: 'In Progress' },
      done: { status: 'In review' },
      blocked: { status: 'Todo' },
      context: {
        phase: 'E',
        agent: 'feature-developer',
        agentByLabel: { bug: 'bug-fixer' },
      },
    });
  });

  it('reports every problem with the path of the field', () => {
    const parse = (): unknown => parsePipelineConfig({
      project: { owner: 'acme' },
      repositories: ['not-a-repository'],
      stages: [],
      extra: true,
    });

    expect(parse).toThrow(InvalidConfigError);

    try {
      parse();
    } catch (error) {
      const problems = (error as InvalidConfigError).problems.join('\n');

      expect(problems).toContain('project.number');
      expect(problems).toContain('repositories.0: expected owner/name');
      expect(problems).toContain('stages');
      expect(problems).toContain('extra');
    }
  });

  it('rejects an unknown stage and a stage listed twice', () => {
    expect(() => baseConfig({ stages: [{ id: 'deploy' }] })).toThrow(InvalidConfigError);

    expect(() => baseConfig({
      stages: [
        { id: 'implement' },
        { id: 'implement' },
      ],
    })).toThrow(/each stage may appear once/u);
  });
});

describe('stageLimits', () => {
  it('uses the guard rails unless the stage overrides them, with a grace period before a run is stale', () => {
    const config = baseConfig({
      guardRails: { timeoutMinutes: 30 },
      stages: [
        {
          id: 'implement',
          maxAttempts: 5,
        },
      ],
    });

    expect(stageLimits(
      config,
      firstStage(config),
    )).toEqual({
      maxTurns: 80,
      timeoutMs: 30 * 60_000,
      maxAttempts: 5,
      staleAfterMs: 35 * 60_000,
    });
  });
});
