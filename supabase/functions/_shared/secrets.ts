/**
 * Shared-secret comparison for privileged endpoints.
 *
 * Kept dependency-free and separate from auth.ts so it can be unit tested
 * without loading the Supabase client. The comparison is length-checked and
 * branch-free so it does not leak how many characters matched.
 */
export function constantTimeEqual(expected: string, supplied: string): boolean {
  if (!expected || expected.length !== supplied.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  }
  return diff === 0;
}
