import type {
  ContextProvider,
  ContextSelector,
  StageContext,
} from '@boardwright/core';
import { DotcontextProvider } from './dotcontext-provider.ts';
import {
  localFiles,
  type FileSource,
} from './files.ts';
import { PlainContextProvider } from './plain-provider.ts';

export { DotcontextProvider } from './dotcontext-provider.ts';
export {
  localFiles,
  type FileSource,
} from './files.ts';
export {
  INSTRUCTION_FILES,
  PlainContextProvider,
} from './plain-provider.ts';

/** Reads a repository's guidance with the dotcontext provider when it has a base, else the plain one. */
export class RepositoryContextProvider implements ContextProvider {
  private readonly dotcontext: ContextProvider;

  private readonly plain: ContextProvider;

  private readonly files: FileSource;

  constructor(files: FileSource = localFiles) {
    this.files = files;
    this.dotcontext = new DotcontextProvider(files);
    this.plain = new PlainContextProvider(files);
  }

  /** Delegates to the provider that fits the repository at `root`. */
  async load(
    root: string,
    selector: ContextSelector,
  ): Promise<StageContext> {
    const hasBase = await this.files.exists(
      root,
      '.context/agents',
    ) || await this.files.exists(
      root,
      '.context/skills',
    );

    return (hasBase ? this.dotcontext : this.plain).load(
      root,
      selector,
    );
  }
}
