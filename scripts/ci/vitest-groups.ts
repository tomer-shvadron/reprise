/** Names the projects of a Vitest config; an entry it cannot name is reported by index, never skipped. */
export function projectNames(projects: readonly unknown[]): { names: string[]; unnamed: number[] } {
  const names: string[] = [];
  const unnamed: number[] = [];
  projects.forEach((project, index) => {
    const test: unknown =
      typeof project === 'object' && project !== null ? Reflect.get(project, 'test') : undefined;
    const name: unknown =
      typeof test === 'object' && test !== null ? Reflect.get(test, 'name') : undefined;
    if (typeof name === 'string') names.push(name);
    else unnamed.push(index);
  });
  return { names, unnamed };
}
