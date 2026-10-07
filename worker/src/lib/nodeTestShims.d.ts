// The Worker is type-checked against the Workers runtime, which has no Node
// built-ins. Only the SQLite-backed test (demoData.test.ts) runs under Node;
// this declares the few functions it uses, so no extra dependency is needed.
declare module 'node:fs' {
  export function readdirSync(path: URL): string[];
  export function readFileSync(path: URL, encoding: 'utf8'): string;
}

declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): { all(): unknown[]; get(): unknown };
  }
}

interface ImportMeta {
  url: string;
}
