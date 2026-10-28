# 0001: The Living Mindmap room

Status: proposed by Claude on the owner's delegation, 2026-10-20. Reversible.

## Decided by Garfield

- The recorded agent session is scripted. `scripts/record-session.ts` writes the agent's moves and runs them against the real stdio MCP server (release plan, owner decisions, 2026-10-28). The page says so: "The agent's moves were scripted, not chosen by a model."

## Proposed by Claude, waiting for Garfield's review

- The demo is its own package in `demo/` with its own lockfile. It imports `src/core/similar.ts`, `types.ts`, `seed-spec.ts` and `guard-eval.ts`, which have no native code, so the Pages build never compiles better-sqlite3.
- `tests/demo-parity.test.ts` proves the demo's in-memory guard gives the server's `findSimilar` scores, refusals and refusal text on every fixture title and all 60 labelled pairs. The refusal text now comes from one shared function in `similar.ts`.
- The guard line stays at 0.85 (`DUPLICATE_THRESHOLD`). The eval measures it and does not tune it.
- The 60 pair labels in `evals/guard-pairs.json` were drafted by Claude Code before they were scored, and are marked "Garfield has not reviewed them yet" until he signs off.
- The page opens on the finished map. Replay the agent starts from the first call. Keep and Undo change the visitor's copy only.
- The sample map "Planning a support-inbox assistant" lives in `src/core/seed-spec.ts` and is labelled sample content.

## Consequences

Lexical matching only. Synonyms are missed (the eval shows 0 of 12 caught), and a one-prefix difference can look like a duplicate. An embedding guard is out of scope for this room.
