# Harness Manager — Sample Prompts

Copy-paste prompts for an agent (Cursor / Claude) connected to the `harness` MCP server.
Replace every `<PLACEHOLDER>` with your own values.

## Recommended setup (minimal)

| Layer | What to create | Purpose |
| ----- | -------------- | ------- |
| **Harness** | `.harness/` via MCP init | Source of truth: agents, features, decisions, progress |
| **Superpowers** | Enable plugin in Cursor | Skills referenced inside `.harness/agents/*.md` |
| **Cursor rules** | **One** `harness-lifecycle.mdc` | Trigger MCP lifecycle — do not duplicate agent instructions |

Agent role definitions and Superpowers skill lists live in `.harness/agents/`, not in Cursor rules.
`AGENTS.md` is auto-generated and lists agent ids only; full instructions come from `harness_get_context`.

---

## 1. Cursor rule — lifecycle only (create once per repo)

Save as `.cursor/rules/harness-lifecycle.mdc` in your project repo:

```markdown
---
description: Harness lifecycle — read agents from .harness via MCP
alwaysApply: true
---

# Harness Lifecycle

Repo path: <REPO_PATH>

Every session:
1. harness_get_context — read agents, hardConstraints, features, progress from snapshot
2. State which harness agent role you are acting as (planner / coder / reviewer / architect)
3. Follow that agent's instructions from the snapshot — do not duplicate them here
4. End: harness_handoff (clean — no active features)

Route by user intent: plan → planner, code → coder, review → reviewer, architecture → architect.
Never set feature "passing" without evidence. Record decisions via harness_add_decision.
```

---

## 2. Project init — multi-agent (recommended, run once)

Requires the **Superpowers** plugin enabled in Cursor.

```text
Initialize harness for repo at <REPO_PATH>.

1. harness_init:
   name: "<PROJECT_NAME>"
   description: "<SHORT_DESCRIPTION>"
   hardConstraints: [
     "No real network calls in unit tests",
     "Any DB schema change must go through a migration",
     "Architecture changes require harness_add_decision before implementation"
   ]

2. harness_upsert_agent — create four agents:

   id: "planner", role: "planner"
   instructions: |
     You plan work only — do not write production code.
     REQUIRED SKILLS (in order):
     1. superpowers:brainstorming — explore requirements and design
     2. superpowers:writing-plans — write plan to docs/superpowers/plans/
     Save plans as docs/superpowers/plans/YYYY-MM-DD-<feature>.md
     After plan: harness_update_feature for each task, state "not_started"
     End with harness_update_progress (nextSteps)

   id: "coder", role: "implementer"
   instructions: |
     You implement code from approved plans only.
     REQUIRED SKILLS:
     - superpowers:executing-plans OR superpowers:subagent-driven-development
     - superpowers:test-driven-development when adding behavior
     - superpowers:verification-before-completion before claiming done
     Rules:
     - One active feature at a time (WIP=1)
     - Set feature "active" before coding
     - harness_set_feature_passing only with real evidence (test output)
     - Do NOT change architecture without harness_add_decision

   id: "reviewer", role: "reviewer"
   instructions: |
     You review code quality — do not implement unless fixing review findings.
     REQUIRED SKILL: superpowers:requesting-code-review
     Dispatch superpowers:code-reviewer subagent with BASE_SHA/HEAD_SHA
     Output: Critical / Important / Minor issues
     Record significant findings via harness_add_decision if architectural

   id: "architect", role: "architect"
   instructions: |
     You own system design and trade-offs — no feature implementation.
     Workflow:
     1. Read harness_get_context + existing decisions
     2. Propose design (components, boundaries, data flow)
     3. harness_add_decision for every significant choice (include "rejected" alternatives)
     4. Update feature specs (behavior + verification) if design changes scope
     Use superpowers:brainstorming for greenfield design

3. harness_update_feature — declare initial features (state: "not_started"),
   each with behavior + a concrete verification command

4. harness_get_context — print snapshot for my confirmation.
```

---

## 2b. Project init — single agent (optional)

For small repos that do not need role separation:

```text
Initialize the harness for the repo at <PATH>.
- Call harness_init with:
  name: "<PROJECT_NAME>"
  description: "<SHORT_DESCRIPTION>"
  hardConstraints: [
    "No real network calls in unit tests",
    "Any DB schema change must go through a migration",
    "<add your own constraint>"
  ]
- Define an agent via harness_upsert_agent:
  id: "builder", role: "implementer",
  instructions: "Write code + tests; do not change the architecture without a recorded decision."
- Declare ALL planned features via harness_update_feature, each with:
  id, behavior (description), verification (a check command, e.g. "pnpm exec vitest run packages/core"),
  state: "not_started".
When done, print the context snapshot back so I can confirm.
```

---

## 3. Session start prompt

```text
Start a work session on repo <PATH>.
1. Call harness_get_context and summarize: hard constraints, agents, active features, nextSteps, recent decisions.
2. Today I want to work on: "<TASK_DESCRIPTION>".
3. Acting as: <planner|coder|reviewer|architect> — follow that agent's instructions from the snapshot.
4. Map this work to the matching feature (or create one with behavior + verification), and set it to "active".
5. Propose a short plan, then start. Update progress as you make headway.
```

---

## 4. Session handoff prompt (end of session)

```text
End the session on repo <PATH>:
1. For each completed feature: run its verification, capture the output as evidence, and call harness_set_feature_passing.
2. For any unfinished feature: move it out of "active" (back to not_started / blocked) and record the reason in progress.blocked or nextSteps.
3. If there was a significant decision this session: call harness_add_decision (including "rejected").
4. Call harness_handoff with:
   updatedAt: <ISO time>,
   currentCommit: <hash>, testStatus: "<e.g. 42 passed>",
   completed: [...], nextSteps: [...],
   summary: "session summary".
5. If the clean-state check warns about a still-active feature, resolve it and handoff again until the state is clean.
```

---

## 5. Feature workflow example (multi-agent)

```text
Phase 1 — Architect (if needed):
  "Act as architect: evaluate auth approach for this app"
  → harness_add_decision (JWT vs session, rejected alternatives)

Phase 2 — Planner:
  "Act as planner: create implementation plan for user-auth"
  → brainstorming → writing-plans → docs/superpowers/plans/...
  → harness_update_feature (each task)

Phase 3 — Coder:
  "Act as coder: implement Task 1 from plan"
  → harness_update_feature (active) → code + tests
  → harness_set_feature_passing (with evidence)

Phase 4 — Reviewer:
  "Act as reviewer: review commits for user-auth"
  → requesting-code-review → code-reviewer subagent

Phase 5 — Handoff:
  "End session" → harness_handoff (clean state)
```

---

## "Fully optimized" checklist

- Every feature has a concrete `verification` (no feature without a way to check it).
- `hardConstraints` are declared in full right at `init`.
- A feature is never set to passing without `evidence`.
- Each session opens with `get_context` and ends with `handoff`, and the handoff is always "clean".
- Every major decision is captured as a `decision` with its `rejected` alternative.
- Four agents in `.harness/agents/` with Superpowers skills in their instructions.
- **One** Cursor rule (`harness-lifecycle.mdc`) — no duplicate role or Superpowers rules.
- The generated `AGENTS.md` accurately reflects hard constraints + active features + next steps.
- `docs/superpowers/plans/` exists for planner output.
