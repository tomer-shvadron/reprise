/** The value, or a failure that names the missing setup: a test's way to narrow without a cast. */
export function must<T>(value: T | undefined, what = 'value'): T {
  if (value === undefined) throw new Error(`test setup: no ${what}`);
  return value;
}
