import type * as v from 'valibot'

// Which field a failed parse should be reported as. The valibot issues already
// name the failing key, so the body is never re-parsed against a shadow schema
// to find out. Only the name rule's own `check` earns the field's code
// (docs/specs/attestation-model.md): a missing or non-string field fails the
// string schema first and stays bad_input, as it did before.
export const fieldErrorFor = (
  issues: readonly v.BaseIssue<unknown>[],
  field: string,
  code: 'bad_handle' | 'bad_slug',
): 'bad_handle' | 'bad_slug' | 'bad_input' =>
  issues.some(
    (issue) => issue.type === 'check' && issue.path?.some((segment) => segment.key === field) === true,
  )
    ? code
    : 'bad_input'
