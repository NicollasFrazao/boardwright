import type {
  BoardDescription,
  BoardItem,
  BoardPort,
  IssueRef,
} from '@boardwright/core';
import {
  splitRepository,
  type GitHubClient,
} from './client.ts';

/** Which board to read: its owner (a user or an organization), its number and the Status field's name. */
export interface ProjectLocation {
  readonly owner: string;
  readonly number: number;
  readonly statusField: string;
}

interface StatusField {
  readonly id: string;
  readonly options: readonly {
    readonly id: string;
    readonly name: string;
  }[];
}

interface Project {
  readonly id: string;
  readonly title: string;
  readonly statusField: StatusField | undefined;

  /** Every single-select field by name; `undefined` when the response did not list them. */
  readonly singleSelectFields: ReadonlyMap<string, StatusField> | undefined;
}

interface SingleSelectNode {
  readonly id?: string;
  readonly name?: string;
  readonly options?: StatusField['options'];
}

interface ProjectQuery {
  readonly repositoryOwner: {
    readonly projectV2?: {
      readonly id: string;
      readonly title: string;
      readonly field: {
        readonly id?: string;
        readonly options?: StatusField['options'];
      } | null;
      readonly fields?: { readonly nodes: readonly (SingleSelectNode | null)[] };
    } | null;
  } | null;
}

interface ItemsPage {
  readonly node: {
    readonly items: {
      readonly pageInfo: {
        readonly hasNextPage: boolean;
        readonly endCursor: string | null;
      };
      readonly nodes: readonly {
        readonly id: string;
        readonly fieldValueByName: { readonly name?: string } | null;
        readonly fieldValues?: {
          readonly nodes: readonly ({
            readonly name?: string;
            readonly field?: { readonly name?: string };
          } | null)[];
        };
        readonly content: {
          readonly number?: number;
          readonly repository?: { readonly nameWithOwner: string };
          readonly parent?: {
            readonly number: number;
            readonly repository: { readonly nameWithOwner: string };
          } | null;
        } | null;
      }[];
    };
  };
}

const PROJECT_QUERY = `query($login: String!, $number: Int!, $field: String!) {
  repositoryOwner(login: $login) {
    ... on ProjectV2Owner {
      projectV2(number: $number) {
        id
        title
        field(name: $field) { ... on ProjectV2SingleSelectField { id options { id name } } }
        fields(first: 50) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } } }
      }
    }
  }
}`;

const ITEMS_QUERY = `query($id: ID!, $after: String, $field: String!) {
  node(id: $id) {
    ... on ProjectV2 {
      items(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          fieldValueByName(name: $field) { ... on ProjectV2ItemFieldSingleSelectValue { name } }
          fieldValues(first: 20) {
            nodes { ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2SingleSelectField { name } } } }
          }
          content {
            ... on Issue { number repository { nameWithOwner } parent { number repository { nameWithOwner } } }
          }
        }
      }
    }
  }
}`;

const SET_STATUS_MUTATION = `mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $project, itemId: $item, fieldId: $field,
    value: { singleSelectOptionId: $option }
  }) { projectV2Item { id } }
}`;

const ISSUE_ID_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $number) { id } }
}`;

const ADD_ITEM_MUTATION = `mutation($project: ID!, $content: ID!) {
  addProjectV2ItemById(input: { projectId: $project, contentId: $content }) { item { id } }
}`;

interface IssueIdQuery {
  readonly repository: { readonly issue: { readonly id: string } | null } | null;
}

interface AddItemMutation {
  readonly addProjectV2ItemById: { readonly item: { readonly id: string } };
}

/**
 * The board as a GitHub Project (v2), owned by a user or an organization.
 *
 * @remarks
 * The project and its Status field are read once per instance. A Status is only ever set to an option
 * that exists: the adapter never creates fields or options.
 */
export class ProjectBoard implements BoardPort {
  private project: Promise<Project> | undefined;

  private readonly client: GitHubClient;

  private readonly location: ProjectLocation;

  constructor(
    client: GitHubClient,
    location: ProjectLocation,
  ) {
    this.client = client;
    this.location = location;
  }

  /** The project's title and the options of its Status field. */
  async describe(): Promise<BoardDescription> {
    const project = await this.load();

    return {
      title: project.title,
      statusOptions: project.statusField?.options.map((option) => option.name),
      ...project.singleSelectFields === undefined ? {} : {
        singleSelectFields: Object.fromEntries([...project.singleSelectFields].map(([
          name,
          field,
        ]) => [
          name,
          field.options.map((option) => option.name),
        ])),
      },
    };
  }

  /** Every item whose content is an issue, across all pages. */
  async listItems(): Promise<BoardItem[]> {
    const project = await this.load();
    const items: BoardItem[] = [];
    let after: string | null = null;

    do {
      const page: ItemsPage = await this.client.graphql<ItemsPage>(
        ITEMS_QUERY,
        {
          id: project.id,
          after,
          field: this.location.statusField,
        },
      );

      for (const node of page.node.items.nodes) {
        const issue = node.content;

        if (
          issue?.number !== undefined
          && issue.repository !== undefined
        ) {
          items.push({
            itemId: node.id,
            status: node.fieldValueByName?.name ?? null,
            issue: {
              repository: issue.repository.nameWithOwner,
              number: issue.number,
            },
            ...optionalDetails(node),
          });
        }
      }

      after = page.node.items.pageInfo.hasNextPage ? page.node.items.pageInfo.endCursor : null;
    } while (after !== null);

    return items;
  }

  /**
   * Adds an issue to the board; GitHub returns the existing item when the issue is already there.
   *
   * @throws {@link Error} when the issue does not exist or cannot be read with the token.
   */
  async addIssue(ref: IssueRef): Promise<string> {
    const project = await this.load();

    const {
      owner,
      repo,
    } = splitRepository(ref.repository);

    const data = await this.client.graphql<IssueIdQuery>(
      ISSUE_ID_QUERY,
      {
        owner,
        name: repo,
        number: ref.number,
      },
    );

    const issueId = data.repository?.issue?.id;

    if (issueId === undefined) {
      throw new Error(`No issue ${ref.repository}#${ref.number}.`);
    }

    const added = await this.client.graphql<AddItemMutation>(
      ADD_ITEM_MUTATION,
      {
        project: project.id,
        content: issueId,
      },
    );

    return added.addProjectV2ItemById.item.id;
  }

  /**
   * Sets a single-select field of an item to an existing option.
   *
   * @throws {@link Error} when the board has no such field or the field has no such option.
   */
  async setField(
    itemId: string,
    field: string,
    value: string,
  ): Promise<void> {
    const project = await this.load();
    const target = project.singleSelectFields?.get(field);
    const option = target?.options.find((candidate) => candidate.name === value);

    if (
      target === undefined
      || option === undefined
    ) {
      throw new Error(`The board has no ${field} option "${value}".`);
    }

    await this.client.graphql(
      SET_STATUS_MUTATION,
      {
        project: project.id,
        item: itemId,
        field: target.id,
        option: option.id,
      },
    );
  }

  /**
   * Moves an item to an existing Status option.
   *
   * @throws {@link Error} when the board has no Status field or no option with that name.
   */
  async setStatus(
    itemId: string,
    status: string,
  ): Promise<void> {
    const project = await this.load();
    const field = project.statusField;
    const option = field?.options.find((candidate) => candidate.name === status);

    if (
      field === undefined
      || option === undefined
    ) {
      throw new Error(`The board has no ${this.location.statusField} option "${status}".`);
    }

    await this.client.graphql(
      SET_STATUS_MUTATION,
      {
        project: project.id,
        item: itemId,
        field: field.id,
        option: option.id,
      },
    );
  }

  private load(): Promise<Project> {
    this.project ??= this.fetchProject();

    return this.project;
  }

  private async fetchProject(): Promise<Project> {
    const {
      owner,
      number,
      statusField,
    } = this.location;

    const data = await this.client.graphql<ProjectQuery>(
      PROJECT_QUERY,
      {
        login: owner,
        number,
        field: statusField,
      },
    );

    const project = data.repositoryOwner?.projectV2;

    if (
      project === undefined
      || project === null
    ) {
      throw new Error(`No project #${number} owned by ${owner}.`);
    }

    const field = project.field;

    return {
      id: project.id,
      title: project.title,
      statusField: field?.id === undefined || field.options === undefined ? undefined : {
        id: field.id,
        options: field.options,
      },
      singleSelectFields: project.fields === undefined ? undefined : singleSelectFieldsOf(project.fields.nodes),
    };
  }
}

function singleSelectFieldsOf(nodes: readonly (SingleSelectNode | null)[]): ReadonlyMap<string, StatusField> {
  const fields = new Map<string, StatusField>();

  for (const node of nodes) {
    if (
      node?.id !== undefined
      && node.name !== undefined
      && node.options !== undefined
    ) {
      fields.set(
        node.name,
        {
          id: node.id,
          options: node.options,
        },
      );
    }
  }

  return fields;
}

/** The single-select values and the parent of an item, when the response has them. */
function optionalDetails(node: ItemsPage['node']['items']['nodes'][number]): Pick<BoardItem, 'fields' | 'parent'> {
  const fields: Record<string, string> = {};

  for (const value of node.fieldValues?.nodes ?? []) {
    const fieldName = value?.field?.name;

    if (
      fieldName !== undefined
      && value?.name !== undefined
    ) {
      fields[fieldName] = value.name;
    }
  }

  const parent = node.content?.parent;

  return {
    ...Object.keys(fields).length === 0 ? {} : { fields },
    ...parent === undefined || parent === null ? {} : {
      parent: {
        repository: parent.repository.nameWithOwner,
        number: parent.number,
      },
    },
  };
}
