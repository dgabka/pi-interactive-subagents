import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type TodoStatus = "open" | "in_progress" | "closed";

export interface Todo {
  id: string;
  title: string;
  body: string;
  tags: string[];
  status: TodoStatus;
  createdAt: string;
  updatedAt: string;
}

interface TodoStore {
  version: 1;
  todos: Todo[];
}

function todoPath(cwd: string): string {
  return join(cwd, ".pi", "todos.json");
}

function load(cwd: string): TodoStore {
  const path = todoPath(cwd);
  if (!existsSync(path)) return { version: 1, todos: [] };
  const store = JSON.parse(readFileSync(path, "utf8")) as TodoStore;
  if (store.version !== 1 || !Array.isArray(store.todos)) throw new Error(`Invalid todo store: ${path}`);
  return store;
}

function save(cwd: string, store: TodoStore): void {
  const path = todoPath(cwd);
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`);
  renameSync(temp, path);
}

function nextId(todos: Todo[]): string {
  const last = todos.reduce((max, todo) => Math.max(max, Number(todo.id.slice(5)) || 0), 0);
  return `TODO-${String(last + 1).padStart(4, "0")}`;
}

export function listTodos(cwd: string): Todo[] {
  return load(cwd).todos;
}

export function getTodo(cwd: string, id: string): Todo | undefined {
  return load(cwd).todos.find((todo) => todo.id === id);
}

export function createTodo(cwd: string, input: Pick<Todo, "title"> & Partial<Pick<Todo, "body" | "tags">>): Todo {
  const store = load(cwd);
  const now = new Date().toISOString();
  const todo: Todo = {
    id: nextId(store.todos),
    title: input.title,
    body: input.body ?? "",
    tags: input.tags ?? [],
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
  store.todos.push(todo);
  save(cwd, store);
  return todo;
}

export function updateTodo(cwd: string, id: string, changes: Partial<Pick<Todo, "title" | "body" | "tags" | "status">>): Todo | undefined {
  const store = load(cwd);
  const todo = store.todos.find((item) => item.id === id);
  if (!todo) return undefined;
  Object.assign(todo, Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)), {
    updatedAt: new Date().toISOString(),
  });
  save(cwd, store);
  return todo;
}
