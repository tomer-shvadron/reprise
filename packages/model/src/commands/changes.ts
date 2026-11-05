/** A partial update: a value sets a field, `null` removes an optional one. */
export type Changes<T> = {
  [K in keyof T]?: undefined extends T[K] ? Exclude<T[K], undefined> | null : T[K];
};

export function assignChanges<T extends object>(target: T, changes: Changes<T>): void {
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) Reflect.deleteProperty(target, key);
    else Reflect.set(target, key, value);
  }
}
