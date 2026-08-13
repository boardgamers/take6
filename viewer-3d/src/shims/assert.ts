/** Minimal browser shim for node's `assert` (used by take6-engine). */
export default function assert(value: unknown, message?: string): asserts value {
  if (!value) {
    throw new Error(message ?? "Assertion failed");
  }
}
