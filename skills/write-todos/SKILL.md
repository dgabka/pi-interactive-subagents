---
name: write-todos
description: Create plan-local implementation tickets with the bundled todo tool. Use after a plan is approved and before delegating workers.
---

# Write Todos

Create one focused ticket per independently executable change. Todos belong to the approved plan; IDs are plan-local.

## Create

Use the plan artifact path for **every** call:

```typescript
todo({
  action: "create",
  plan: ".pi/plans/YYYY-MM-DD-name/plan.md",
  title: "Short imperative task title",
  tags: ["plan-name"],
  body: `Plan: .pi/plans/YYYY-MM-DD-name/plan.md

Modify: path/to/file.ts

Implement: exact change and constraints.

Reference: path/to/existing.ts:10-30 — pattern to follow.

Acceptance: named, verifiable result.`,
});
```

The tool writes each ticket to `<plan directory>/todos/TODO-NNNN.json`. Do not write ticket files directly. Do not omit `plan`, infer it from tags, or use `.pi/todos.json`.

## Required ticket body

Every ticket includes:

- plan path and files to modify/create;
- exact implementation scope and constraints;
- a code example **or** a file path with line range and what to copy;
- a concrete acceptance check; and
- dependencies when ordering matters.

Keep it self-contained: a worker should need only its ticket and the referenced plan, not other tickets.

## Before creating

- Split work into sequential, small tasks.
- Put prerequisite work first.
- Repeat architectural constraints in each affected ticket.
- Include tests with the ticket that changes behavior.

## After creating

List the selected plan's tickets and report their IDs:

```typescript
todo({ action: "list", plan: ".pi/plans/YYYY-MM-DD-name/plan.md" });
```

Workers must use that same `plan` plus their assigned ID for `get`, `claim`, and `update`.
