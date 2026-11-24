import {
  PREVC_PHASES,
  type ContextProvider,
  type ContextSelector,
  type PrevcPhase,
  type SkillReference,
  type StageContext,
} from '@boardwright/core';
import {
  localFiles,
  type FileSource,
} from './files.ts';
import { readFrontMatter } from './front-matter.ts';

const AGENTS_DIRECTORY = '.context/agents';
const SKILLS_DIRECTORY = '.context/skills';
const CONTEXT_INDEX = '.context/docs/README.md';

interface AgentFile {
  readonly agentType: string;
  readonly phases: readonly PrevcPhase[];
  readonly path: string;
}

interface SkillFile extends SkillReference {
  readonly phases: readonly PrevcPhase[];
}

interface Scan<T> {
  readonly items: T[];
  readonly warnings: string[];
}

/**
 * Reads a repository's dotcontext base: the playbooks in `.context/agents` and the skills in
 * `.context/skills`, selected by their front matter.
 *
 * @remarks
 * Only files present in the repository count. The dotcontext MCP's own selection also returns its
 * built-in agents and skills, including ones a repository removed on purpose, so it is not used here.
 */
export class DotcontextProvider implements ContextProvider {
  private readonly files: FileSource;

  constructor(files: FileSource = localFiles) {
    this.files = files;
  }

  /** The playbook named by the selector and the skills of its phase. */
  async load(
    root: string,
    selector: ContextSelector,
  ): Promise<StageContext> {
    const reader = {
      files: this.files,
      root,
    };

    const [
      agents,
      skills,
    ] = await Promise.all([
      scanAgents(reader),
      scanSkills(reader),
    ]);

    const warnings = [
      ...agents.warnings,
      ...skills.warnings,
    ];

    const playbook = agents.items.find((agent) => agent.agentType === selector.agent);

    if (playbook === undefined) {
      warnings.push(`No playbook for "${selector.agent}" in ${AGENTS_DIRECTORY}.`);
    } else if (!playbook.phases.includes(selector.phase)) {
      warnings.push(`The playbook "${selector.agent}" does not declare phase ${selector.phase}.`);
    }

    return {
      source: 'dotcontext',
      playbook: playbook === undefined ? undefined : {
        agentType: playbook.agentType,
        path: playbook.path,
      },
      skills: skills.items
        .filter((skill) => skill.phases.includes(selector.phase))
        .map((skill) => ({
          slug: skill.slug,
          description: skill.description,
          path: skill.path,
        })),
      instructionFiles: await this.files.exists(
        root,
        CONTEXT_INDEX,
      ) ? [CONTEXT_INDEX] : [],
      warnings,
    };
  }
}

interface Reader {
  readonly files: FileSource;
  readonly root: string;
}

async function scanAgents(reader: Reader): Promise<Scan<AgentFile>> {
  const scan: Scan<AgentFile> = {
    items: [],
    warnings: [],
  };

  const names = await reader.files.listNames(
    reader.root,
    AGENTS_DIRECTORY,
  );

  for (const name of names.filter((entry) => entry.endsWith('.md') && entry !== 'README.md')) {
    const path = `${AGENTS_DIRECTORY}/${name}`;

    const data = await frontMatterOf(
      reader,
      path,
      scan.warnings,
    );

    const agentType = data?.agentType;

    if (typeof agentType === 'string') {
      scan.items.push({
        agentType,
        phases: phasesOf(data?.phases),
        path,
      });
    } else if (data !== undefined) {
      scan.warnings.push(`${path}: the front matter has no agentType.`);
    }
  }

  return scan;
}

async function scanSkills(reader: Reader): Promise<Scan<SkillFile>> {
  const scan: Scan<SkillFile> = {
    items: [],
    warnings: [],
  };

  for (const name of await reader.files.listNames(
    reader.root,
    SKILLS_DIRECTORY,
  )) {
    const path = `${SKILLS_DIRECTORY}/${name}/SKILL.md`;

    const text = await reader.files.readText(
      reader.root,
      path,
    );

    if (text !== undefined) {
      const data = parseFrontMatter(
        path,
        text,
        scan.warnings,
      );

      scan.items.push({
        slug: typeof data?.skillSlug === 'string' ? data.skillSlug : name,
        description: typeof data?.description === 'string' ? data.description : '',
        path,
        phases: phasesOf(data?.phases),
      });
    }
  }

  return scan;
}

async function frontMatterOf(
  reader: Reader,
  path: string,
  warnings: string[],
): Promise<Record<string, unknown> | undefined> {
  const text = await reader.files.readText(
    reader.root,
    path,
  );

  if (text === undefined) {
    warnings.push(`${path}: could not be read.`);

    return undefined;
  }

  return parseFrontMatter(
    path,
    text,
    warnings,
  );
}

function parseFrontMatter(
  path: string,
  text: string,
  warnings: string[],
): Record<string, unknown> | undefined {
  try {
    const data = readFrontMatter(text);

    if (data === undefined) {
      warnings.push(`${path}: no front matter.`);
    }

    return data;
  } catch (error) {
    warnings.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);

    return undefined;
  }
}

function phasesOf(value: unknown): PrevcPhase[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return PREVC_PHASES.filter((phase) => value.includes(phase));
}
