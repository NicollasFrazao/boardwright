import { parse } from 'yaml';

const FRONT_MATTER = /^---\r?\n(?<yaml>[\s\S]*?)\r?\n---(?:\r?\n|$)/u;

/**
 * The YAML front matter at the top of a Markdown file, as a plain object.
 *
 * @throws {@link Error} when the front matter is not valid YAML or not a mapping.
 */
export function readFrontMatter(markdown: string): Record<string, unknown> | undefined {
  const yaml = FRONT_MATTER.exec(markdown)?.groups?.yaml;

  if (yaml === undefined) {
    return undefined;
  }

  const data: unknown = parse(yaml);

  if (
    data === null
    || typeof data !== 'object'
    || Array.isArray(data)
  ) {
    throw new Error('the front matter is not a mapping');
  }

  return data as Record<string, unknown>;
}
