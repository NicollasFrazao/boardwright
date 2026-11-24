import type {
  ContextProvider,
  ContextSelector,
  StageContext,
} from '@boardwright/core';
import { DotcontextProvider } from './dotcontext-provider.ts';
import { exists } from './files.ts';
import { PlainContextProvider } from './plain-provider.ts';

export { DotcontextProvider } from './dotcontext-provider.ts';
export {
  INSTRUCTION_FILES,
  PlainContextProvider,
} from './plain-provider.ts';

/** Reads a repository's guidance with the dotcontext provider when it has a base, else the plain one. */
export class RepositoryContextProvider implements ContextProvider {
  constructor(
    private readonly dotcontext: ContextProvider = new DotcontextProvider(),
    private readonly plain: ContextProvider = new PlainContextProvider(),
  ) {}

  /** Delegates to the provider that fits the repository at `root`. */
  async load(
    root: string,
    selector: ContextSelector,
  ): Promise<StageContext> {
    const hasBase = await exists(
      root,
      '.context/agents',
    ) || await exists(
      root,
      '.context/skills',
    );

    return (hasBase ? this.dotcontext : this.plain).load(
      root,
      selector,
    );
  }
}
