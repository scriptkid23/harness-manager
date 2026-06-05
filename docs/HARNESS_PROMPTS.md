# Harness Manager — Sample Prompts

Copy-paste prompts for an agent (Cursor / Claude) connected to the `harness` MCP server.
Replace every `<PLACEHOLDER>` with your own values.

There are four prompts: a **system prompt** (use once as a rule), a **project init** prompt,
a **session start** prompt, and a **session handoff** prompt.

---

## 1. System prompt (set as a rule / paste at the top of the chat)

```text
You work on a repo that exposes the "harness" MCP server. Absolute repo path: <PASTE_REPO_PATH>.
Always follow the harness lifecycle below. Do NOT skip any step.

RULES:
- Every feature must have BOTH a "behavior" (what it does) and a "verification" (a concrete command / way to check it). Never create a feature without a verification.
- NEVER set a feature to "passing" without real "evidence" (test output / logs proving the verification runs green).
- Strictly respect the "hardConstraints" in config. If a request would violate one, stop and tell me.
- Every important architectural decision or trade-off must be recorded via harness_add_decision, including "rejected" (the alternative you discarded).
- At the start of each session, call harness_get_context; at the end of each session, call harness_handoff and reach a "clean state" (no feature left in the "active" state).

TOOL ORDER:
1. harness_get_context        (open the session, load full context)
2. harness_update_feature     (set the feature you are working on to state "active")
3. harness_update_progress    (update currentCommit / testStatus / inProgress / nextSteps as things change)
4. harness_set_feature_passing (only when you have evidence)
5. harness_add_decision       (when there is a significant decision)
6. harness_handoff            (end of session, with a summary; clear all active features first)
```

---

## 2. Project init prompt (run once)

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
1. Call harness_get_context and summarize: hard constraints, currently active features, nextSteps, recent decisions.
2. Today I want to work on: "<TASK_DESCRIPTION>".
3. Map this work to the matching feature (or create a new feature with behavior + verification), and set it to "active".
4. Propose a short plan, then start. Update progress as you make headway.
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

## "Fully optimized" checklist

- Every feature has a concrete `verification` (no feature without a way to check it).
- `hardConstraints` are declared in full right at `init`.
- A feature is never set to passing without `evidence`.
- Each session opens with `get_context` and ends with `handoff`, and the handoff is always "clean".
- Every major decision is captured as a `decision` with its `rejected` alternative.
- The generated `AGENTS.md` accurately reflects hard constraints + active features + next steps.
