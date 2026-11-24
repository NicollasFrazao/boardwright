# 0004. The agent authenticates only through the Agent SDK's documented methods

- Status: accepted
- Date: 2026-11-24
- Amends: [0002](./0002-local-runner-and-action.md), which said the runner would use "the agent login already on the machine"

## Context

ADR 0002 assumed the local runner could use whatever Claude login the machine has, including a
claude.ai subscription. The Agent SDK documentation says otherwise for products built on it:

> Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login
> or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key
> authentication methods described in this document instead.
> — https://code.claude.com/docs/en/agent-sdk/overview (read on 2026-11-24)

The documented methods are `ANTHROPIC_API_KEY`, Amazon Bedrock, Claude Platform on AWS, Google Cloud's
Agent Platform and Microsoft Foundry.

## Options

1. **Document and support only the documented methods**; boardwright never offers, detects or refreshes
   a claude.ai login.
2. **Offer the claude.ai login** as a convenience of the runner.
3. **Refuse to run** unless one of the documented variables is set.

## Decision

Option 1.

- Option 2 is what the documentation rules out for third-party products.
- Option 3 would have boardwright police credentials it otherwise never touches, and would break the
  cloud providers whose credentials come from their own SDK chains.

## Consequences

- The README, the CLI help and `security.md` name the documented methods only.
- The Claude provider passes the environment to the SDK with the GitHub tokens removed; whatever the SDK
  resolves from it is the user's configuration.
- Whether an individual may run their own tools on their own subscription is not something boardwright
  decides or documents.
