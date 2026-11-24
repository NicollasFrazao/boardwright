import type {
  ContextProvider,
  StageContext,
} from '@boardwright/core';
import { exists } from './files.ts';

/** The files coding agents conventionally read, in the order they are listed to the agent. */
export const INSTRUCTION_FILES: readonly string[] = [
  'AGENTS.md',
  'CLAUDE.md',
  '.claude/CLAUDE.md',
];

/** Reads a repository without a dotcontext base: whichever of `AGENTS.md` and `CLAUDE.md` it has. */
export class PlainContextProvider implements ContextProvider {
  /** The instruction files present at `root`; a warning when there are none. */
  async load(root: string): Promise<StageContext> {
    const present: string[] = [];

    for (const path of INSTRUCTION_FILES) {
      if (await exists(
        root,
        path,
      )) {
        present.push(path);
      }
    }

    return {
      source: 'plain',
      playbook: undefined,
      skills: [],
      instructionFiles: present,
      warnings: present.length > 0 ? [] : ['No agent instructions in the repository: no .context, AGENTS.md or CLAUDE.md.'],
    };
  }
}
