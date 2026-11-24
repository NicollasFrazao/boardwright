/** A request the replay received. */
export interface ReplayedRequest {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

/** One canned response of the GitHub API. */
export interface ReplayRoute {
  readonly method: string;

  /** The URL path, compared without the query unless the route's path has one. */
  readonly path: string;

  /** For `POST /graphql`: a substring the query must contain. */
  readonly query?: string;

  /** An extra condition on the request, such as a GraphQL variable. */
  readonly when?: (request: ReplayedRequest) => boolean;
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;

  /** JSON for objects and arrays; a string is sent as plain text (raw file contents). */
  readonly body?: unknown;
}

/**
 * A `fetch` that answers from canned routes and records every request, so the GitHub adapters are
 * tested without the network.
 *
 * @remarks
 * Routes are tried in order and the first match answers. A request no route matches fails the test
 * with its method and path, so a missing fixture is never mistaken for a 404.
 */
export class GitHubReplay {
  readonly requests: ReplayedRequest[] = [];

  private readonly routes: readonly ReplayRoute[];

  constructor(routes: readonly ReplayRoute[]) {
    this.routes = routes;
  }

  /** The `fetch` to give Octokit. */
  readonly fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const bodyText = typeof init?.body === 'string' ? init.body : undefined;

    const request: ReplayedRequest = {
      method: (init?.method ?? 'GET').toUpperCase(),
      path: `${decodeURIComponent(url.pathname)}${url.search}`,
      body: bodyText === undefined ? undefined : JSON.parse(bodyText) as unknown,
    };

    this.requests.push(request);

    const route = this.routes.find((candidate) => matches(
      candidate,
      request,
    ));

    if (route === undefined) {
      throw new Error(`No replay route for ${request.method} ${request.path}`);
    }

    return Promise.resolve(respond(route));
  };

  /**
   * The request received at `index`.
   *
   * @throws {@link Error} when fewer requests were received, which fails the test.
   */
  nth(index: number): ReplayedRequest {
    const request = this.requests[index];

    if (request === undefined) {
      throw new Error(`Only ${this.requests.length} requests were received`);
    }

    return request;
  }

  /** The requests to a path, in order. */
  to(
    method: string,
    path: string,
  ): ReplayedRequest[] {
    return this.requests.filter((request) => request.method === method && pathOf(
      request.path,
      path,
    ) === path);
  }
}

function matches(
  route: ReplayRoute,
  request: ReplayedRequest,
): boolean {
  if (
    route.method !== request.method
    || pathOf(
      request.path,
      route.path,
    ) !== route.path
  ) {
    return false;
  }

  if (
    route.query !== undefined
    && !JSON.stringify(request.body).includes(route.query)
  ) {
    return false;
  }

  return route.when?.(request) ?? true;
}

function pathOf(
  requestPath: string,
  routePath: string,
): string {
  return routePath.includes('?') ? requestPath : requestPath.split('?')[0] ?? requestPath;
}

function respond(route: ReplayRoute): Response {
  const status = route.status ?? 200;
  const isText = typeof route.body === 'string';

  const headers = {
    'content-type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    ...route.headers,
  };

  const text = isText ? route.body : JSON.stringify(route.body ?? {});
  const body = status === 204 ? null : text;

  return new Response(
    body,
    {
      status,
      headers,
    },
  );
}

/** The variables of a GraphQL request the replay received. */
export function graphqlVariables(request: ReplayedRequest): Record<string, unknown> {
  const body = request.body as { variables?: Record<string, unknown> } | undefined;

  return body?.variables ?? {};
}
