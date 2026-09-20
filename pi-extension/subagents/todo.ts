import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

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

const ticketName = /^TODO-(\d{4})\.json$/;

function todoDirectory(cwd: string, plan: string): string {
  if (!plan) throw new Error("Plan selector is required");

  const plans = join(resolve(cwd), ".pi", "plans");
  const selector = resolve(cwd, plan);
  let directory: string;

  if (!existsSync(selector)) throw new Error(`Plan does not exist: ${plan}`);
  if (statSync(selector).isDirectory()) {
    directory = selector;
  } else if (statSync(selector).isFile() && basename(selector) === "plan.md") {
    directory = join(selector, "..");
  } else {
    throw new Error(`Plan selector must be a plan directory or plan.md: ${plan}`);
  }

  const root = realpathSync(plans);
  directory = realpathSync(directory);
  const pathFromPlans = relative(root, directory);
  if (!pathFromPlans || pathFromPlans.startsWith("..") || pathFromPlans.includes("../") || resolve(root, pathFromPlans) !== directory) {
    throw new Error(`Plan must be beneath ${plans}: ${plan}`);
  }

  return join(directory, "todos");
}

function ticketPath(todos: string, id: string): string {
  if (!/^TODO-\d{4}$/.test(id)) throw new Error(`Invalid todo ID: ${id}`);
  return join(todos, `${id}.json`);
}

function readTodo(path: string): Todo {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Todo;
  } catch (error) {
    throw new Error(`Invalid todo ticket: ${path}`, { cause: error });
  }
}

function writeTodo(path: string, todo: Todo): void {
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(todo, null, 2)}\n`);
  renameSync(temp, path);
}

function ticketFiles(todos: string): string[] {
  if (!existsSync(todos)) return [];
  return readdirSync(todos).filter((file) => ticketName.test(file)).sort();
}

function nextId(todos: string): string {
  const last = ticketFiles(todos).reduce((max, file) => Math.max(max, Number(ticketName.exec(file)![1])), 0);
  if (last === 9999) throw new Error(`Todo ID limit reached: ${todos}`);
  return `TODO-${String(last + 1).padStart(4, "0")}`;
}

export function listTodos(cwd: string, plan: string): Todo[] {
  const todos = todoDirectory(cwd, plan);
  return ticketFiles(todos).map((file) => readTodo(join(todos, file)));
}

export function getTodo(cwd: string, plan: string, id: string): Todo | undefined {
  const path = ticketPath(todoDirectory(cwd, plan), id);
  return existsSync(path) ? readTodo(path) : undefined;
}

export function createTodo(cwd: string, plan: string, input: Pick<Todo, "title"> & Partial<Pick<Todo, "body" | "tags">>): Todo {
  const todos = todoDirectory(cwd, plan);
  mkdirSync(todos, { recursive: true });
  const now = new Date().toISOString();
  const todo: Todo = {
    id: nextId(todos),
    title: input.title,
    body: input.body ?? "",
    tags: input.tags ?? [],
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
  writeTodo(ticketPath(todos, todo.id), todo);
  return todo;
}

export function updateTodo(cwd: string, plan: string, id: string, changes: Partial<Pick<Todo, "title" | "body" | "tags" | "status">>): Todo | undefined {
  const path = ticketPath(todoDirectory(cwd, plan), id);
  if (!existsSync(path)) return undefined;
  const todo = readTodo(path);
  Object.assign(todo, Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)), {
    updatedAt: new Date().toISOString(),
  });
  writeTodo(path, todo);
  return todo;
}
