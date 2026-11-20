export function formatCount(count: number): string {
  if (!Number.isSafeInteger(count) || count < 0)
    throw new RangeError("Count must be a nonnegative safe integer");
  return `${count} items`;
}
