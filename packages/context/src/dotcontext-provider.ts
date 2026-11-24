import {
  PREVC_PHASES,
  type ContextProvider,
  type ContextSelector,
  type PrevcPhase,
  type SkillReference,
  type StageContext,
} from '@boardwright/core';
import {
  exists,
  listNames,
  readText,
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
  /** The playbook named by the selector and the skills of its phase. */
  async load(
    root: string,
    selector: ContextSelector,
  ): Promise<StageContext> {
    const [
      agents,
      skills,
    ] = await Promise.all([
      scanAgents(root),
      scanSkills(root),
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
      instructionFiles: await exists(
        root,
        CONTEXT_INDEX,
      ) ? [CONTEXT_INDEX] : [],
      warnings,
    };
  }
}

async function scanAgents(root: string): Promise<Scan<AgentFile>> {
  const scan: Scan<AgentFile> = {
    items: [],
    warnings: [],
  };

  const names = (await listNames(
    root,
    AGENTS_DIRECTORY,
  )).filter((name) => name.endsWith('.md') && name !== 'README.md');

  for (const name of names) {
    const path = `${AGENTS_DIRECTORY}/${name}`;

    const data = await frontMatterOf(
      root,
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

async function scanSkills(root: string): Promise<Scan<SkillFile>> {
  const scan: Scan<SkillFile> = {
    items: [],
    warnings: [],
  };

  for (const name of await listNames(
    root,
    SKILLS_DIRECTORY,
  )) {
    const path = `${SKILLS_DIRECTORY}/${name}/SKILL.md`;

    if (await exists(
      root,
      path,
    )) {
      const data = await frontMatterOf(
        root,
        path,
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
  root: string,
  path: string,
  warnings: string[],
): Promise<Record<string, unknown> | undefined> {
  try {
    const data = readFrontMatter(await readText(
      root,
      path,
    ));

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
