import {
  InvalidConfigError,
  parsePipelineConfig,
  type PipelineConfig,
} from '@boardwright/core';
import { parse } from 'yaml';

/** The config file the commands read unless `--config` names another. */
export const DEFAULT_CONFIG_PATH = 'pipeline.config.yml';

/** A config file that cannot be used, with the reason for each problem. */
export class ConfigFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigFileError';
  }
}

/**
 * Parses and validates the text of a config file.
 *
 * @throws {@link ConfigFileError} when the YAML is invalid or the config does not match the schema.
 */
export function readConfigText(
  path: string,
  text: string,
): PipelineConfig {
  let data: unknown;

  try {
    data = parse(text);
  } catch (error) {
    throw new ConfigFileError(`${path} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    return parsePipelineConfig(data);
  } catch (error) {
    if (error instanceof InvalidConfigError) {
      throw new ConfigFileError([
        `${path} is not a valid pipeline config:`,
        ...error.problems.map((problem) => `  - ${problem}`),
      ].join('\n'));
    }

    throw error;
  }
}

/** What `init` writes, before any option is changed. */
export interface InitAnswers {
  readonly owner: string;
  readonly projectNumber: number;
  readonly repositories: readonly string[];
}

/** A commented starter config; every omitted option keeps the default the README documents. */
export function starterConfig(answers: InitAnswers): string {
  return [
    '# boardwright pipeline. Every option left out keeps its documented default:',
    '# https://github.com/NicollasFrazao/boardwright#configuration',
    'project:',
    `  owner: ${answers.owner}`,
    `  number: ${answers.projectNumber}`,
    'repositories:',
    ...answers.repositories.map((repository) => `  - ${repository}`),
    'stages:',
    '  # Ready → In Progress → In review; a blocked or denied run goes to Todo for a person.',
    '  - id: implement',
    '',
  ].join('\n');
}
