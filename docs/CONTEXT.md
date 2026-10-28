# Kuru / Living Mindmap: Local context

Updated: 2026-10-20 (Asia/Manila). Facts come from local README/layout inspection; historical app metrics were not rerun.

## Implementation

Local SQLite graph shared by React Flow UI, REST API, and stdio MCP server. The README still uses Living Mindmap.

See [README](../README.md) for setup and detailed architecture.

The public room lives in `demo/` (own package, no native modules). ADR: [0001](decisions/0001-living-mindmap-room.md). Visitor copy says "Living Mindmap".

## Current context

The historical conversation proposed Kuru naming and an Avatar credit, but this checkpoint does not establish a user-approved rename or the exact reference. No rename implementation was made.

[Shared current state](../../monsieurgregorio2001-coder.github.io/docs/portfolio/CURRENT-STATE.md) holds cross-project priorities. [Workflow](../../monsieurgregorio2001-coder.github.io/docs/portfolio/WORKFLOW.md) keeps documentation proportional. Formatting defaults are in .editorconfig. This checkpoint's documentation/config changes are local and uncommitted.

## Verification entry points

Use `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`. MCP changes also need `npm run verify:mcp`. Consult README for browser end-to-end checks.

## Standalone checkout

Local facts are usable without sibling repositories. Shared context lives in the [portfolio hub repository](https://github.com/monsieurgregorio2001-coder/monsieurgregorio2001-coder.github.io), under docs/portfolio/. New files may not be committed there yet. Record unavailable context instead of inventing decisions. Update this file only when project facts change.
