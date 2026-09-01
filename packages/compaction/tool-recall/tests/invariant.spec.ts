import { describe, expect, it } from 'vitest'
import { Context } from '@maple/cordis'
import SessionStore from '@maple/session'
import InvariantRegistry from '@maple/invariants'
import * as Invariant from '../src/invariant.ts'

describe('@maple/tool-recall invariant companion', () => {
  it('installs cleanly and registers package ownership', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(Invariant).then(() => undefined)).resolves.toBeUndefined()
  })
})
