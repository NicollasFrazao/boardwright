import {
  describe,
  expect,
  it,
} from 'vitest';
import { readFrontMatter } from '../src/front-matter.ts';

describe('readFrontMatter', () => {
  it('reads the mapping between the fences', () => {
    expect(readFrontMatter('---\nagentType: bug-fixer\nphases: [E, V]\n---\n\nBody')).toEqual({
      agentType: 'bug-fixer',
      phases: [
        'E',
        'V',
      ],
    });
  });

  it('returns undefined without front matter', () => {
    expect(readFrontMatter('# Title\n')).toBeUndefined();
  });

  it('rejects front matter that is not a mapping', () => {
    expect(() => readFrontMatter('---\n- a\n- b\n---\n')).toThrow('the front matter is not a mapping');
  });
});
