import { describe, expectTypeOf, it } from 'vitest'
import type { ShellExecRequest, ShellExecSpec } from '@maple/shell'

/**
 * Compile-time proof that tool-reachable shell requests require a caller-owned
 * AbortSignal. Runtime behavior is covered by bash-local / pwsh-local abort tests.
 */
function omissionContracts(request: ShellExecRequest, spec: ShellExecSpec): void {
  // @ts-expect-error -- ShellExecRequest.signal is required; omission must fail typecheck.
  const missingRequestSignal: ShellExecRequest = { command: 'true' }
  void missingRequestSignal

  // @ts-expect-error -- required request signal cannot become undefined.
  request.signal = undefined
  // @ts-expect-error -- required resolved signal cannot become undefined.
  spec.signal = undefined
}
void omissionContracts

describe('shell execution signal types', () => {
  it('requires AbortSignal on ShellExecRequest and ShellExecSpec', () => {
    expectTypeOf<ShellExecRequest['signal']>().toEqualTypeOf<AbortSignal>()
    expectTypeOf<ShellExecSpec['signal']>().toEqualTypeOf<AbortSignal>()
  })
})
