---
name: plan-auto
description: >
  Autonomous planning and implementation workflow. Scouts, plans, executes
  plan-local todos, and reviews without invoking-user interaction.
---

# Autonomous Plan

Run this workflow unattended for the supplied task. Do not ask the invoking user questions, request approval, offer choices, or pause at a user gate. Resolve ambiguity with the smallest conventional repository choice and report assumptions at the end.

Briefly orient yourself (repository shape and relevant area), then choose a short slug from the task. Use `.pi/plans/YYYY-MM-DD-<slug>/` as the workflow directory. If that directory belongs to this active workflow, reuse it; otherwise use deterministic suffixes (`-2`, `-3`, ...) until an unused directory is found. Define these exact paths:

- `PLAN=.pi/plans/YYYY-MM-DD-<slug>/plan.md`
- `SCOUT=.pi/plans/YYYY-MM-DD-<slug>/scout-context.md`
- `REVIEW=.pi/plans/YYYY-MM-DD-<slug>/review.md`
- `FINAL_REVIEW=.pi/plans/YYYY-MM-DD-<slug>/final-review.md`

All `todo` calls in this workflow must use `plan: PLAN`, never a directory-only or inferred selector. Do not poll for subagent completion. A `subagent` completion delivered by the harness is the only completion signal.

## State-aware retry protocol

Every scout, planner, worker, and reviewer invocation has **three total attempts**: one initial attempt and at most two retries. Apply this protocol separately to every invocation:

```text
for attempt in 1..3:
  inspect persisted artifact, selected plan-local todo state, and repository state
  if the phase result is already valid, reuse it and continue
  spawn the autonomous agent with interactive: false
  wait for harness completion delivery; never poll
  validate the expected result
  if valid: continue to the next phase
  retain all partial work and diagnostics
stop after attempt 3; report the failed phase, attempts, diagnostics, artifacts, and todo state
```

Before a retry, read the expected artifact and list selected-plan todos. Inspect repository changes (for example `git status --short` and relevant diffs) when a phase can have modified the repository. Never destructively reset partial changes. Never recreate valid artifacts or duplicate todos. Never rerun a closed todo.

An artifact is valid only when it is readable and structurally useful: scout context contains concrete repository findings; `PLAN` is a readable plan with implementation scope; each phase's expected review artifact is a readable review with a verdict and severity-ranked findings. Treat missing, unreadable, empty, or structurally incomplete artifacts as a failed attempt.

## 1. Scout

Create the selected directory if needed. Run the scout before planning:

```typescript
subagent({
  name: "🔍 Scout",
  agent: "scout",
  interactive: false,
  task: `Analyze the repository for: [original task]. Map relevant files, conventions, tests, and gotchas. Save concrete findings to ${SCOUT}.`,
});
```

Use the retry protocol. On retry, retain a valid `SCOUT`; otherwise tell the scout to repair or complete its existing context rather than replace useful findings. Stop the entire workflow if its third attempt fails.

## 2. Autonomous planning

After validating `SCOUT`, run `planner-auto` (never `planner`) with the unchanged original task and scout context/path:

```typescript
subagent({
  name: "🧭 Autonomous Planner",
  agent: "planner-auto",
  interactive: false,
  task: `Plan: [original task]

Read scout context at ${SCOUT}. Write the plan to ${PLAN}. Record sensible-default assumptions. Before creating anything, inspect ${PLAN} and list todos using plan: ${PLAN}; on a retry repair valid planning work and do not duplicate todos. Load write-todos before creating todos. Every created todo must use ${PLAN} as its plan selector.`,
});
```

Use the retry protocol. After each completion, read `PLAN` and run:

```typescript
todo({ action: "list", plan: PLAN });
```

Accept zero todos only when `PLAN` explicitly states implementation is unnecessary. Otherwise a missing/invalid plan or no todos is a failed planning attempt. On the third failure, stop with preserved state and diagnostics.

## 3. Sequential implementation

List todos with `todo({ action: "list", plan: PLAN })`. Process open todos in listed order, **one at a time in this same repository**. Do not start another worker until the current worker has succeeded or the workflow has stopped. Do not use parallel workers.

For each open todo, first get it with the exact selector. If it is closed, skip it. For a non-closed todo, invoke a worker with the retry protocol:

```typescript
subagent({
  name: "🔨 Worker [position]/[total]",
  agent: "worker",
  interactive: false,
  task: `Implement TODO-xxxx using plan selector ${PLAN}. Mark the todo closed with that same selector. Plan: ${PLAN}

Read ${SCOUT} before implementation. Inspect the todo and current repository state before doing work; preserve partial work on retries.`,
});
```

After completion, get/list the todo using `PLAN` and inspect repository state. Success requires that exact todo to be closed. A closed todo is never rerun, even if a previous worker result looked unsuccessful. If a worker's third attempt does not produce a closed todo, stop and report the failed todo, diagnostics, artifacts, and selected-plan todo state.

When all implementation todos are closed, list them again with `PLAN` before review.

## 4. Initial review

Run the reviewer after implementation:

```typescript
subagent({
  name: "Reviewer",
  agent: "reviewer",
  interactive: false,
  task: `Review implementation against ${PLAN}. Read ${SCOUT} and repository changes. Write a severity-ranked review with a verdict to ${REVIEW}.`,
});
```

Use the retry protocol and validate `REVIEW`. A third failure stops the workflow with diagnostics and preserved state.

Report P2/P3 findings but do not create automatic fixes for them. If there are no P0/P1 findings, report success.

## 5. One remediation cycle and final review

If the initial review has P0 or P1 findings, create only the necessary remediation todos using `PLAN`. Each remediation todo must quote the review finding, include files/constraints plus a code example or repository reference, and name the applicable acceptance check. List `PLAN` before creating them so retries repair existing remediation todos instead of duplicating them.

Execute remediation todos sequentially in todo order using the same worker protocol above. Do not rerun closed remediation todos. If any worker exhausts three attempts, stop.

Run exactly one final reviewer invocation after all remediation todos close. Use the same three-total-attempt protocol with `FINAL_REVIEW` as its expected artifact: validate/reuse only `FINAL_REVIEW`, never `REVIEW`. Keep the initial `REVIEW` unchanged. The post-remediation reviewer must write its severity-ranked verdict to `FINAL_REVIEW`:

```typescript
subagent({
  name: "Final Reviewer",
  agent: "reviewer",
  interactive: false,
  task: `Review the remediation against ${PLAN}. Read ${SCOUT}, the initial review at ${REVIEW}, and repository changes. Write a new severity-ranked review with a verdict to ${FINAL_REVIEW}.`,
});
```

Do not begin another remediation cycle. If final review still has P0/P1 findings, report an unsuccessful terminal result with those findings. P2/P3 findings remain report-only.

## Final report

Report terminal status without asking for approval. Include the selected plan directory and artifact paths, recorded assumptions, todo IDs/statuses, attempt/retry counts, repository state, review verdict(s), P2/P3 notes, and any failed phase diagnostics. Parent interruption must leave artifacts and todo state intact for manual inspection or continuation.
