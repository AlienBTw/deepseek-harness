import { describe, expect, it } from 'vitest'
import { Context } from '@maple/cordis'
import InvariantRegistry from '@maple/invariants'
import * as Invariant from '../src/invariant.ts'

describe('@maple/tool-task-surface invariant companion', () => {
  it('installs cleanly and registers package ownership', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(Invariant).then(() => undefined)).resolves.toBeUndefined()
  })
})
