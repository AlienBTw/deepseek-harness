import { describe, expectTypeOf, it } from 'vitest'
import type {
  FileSystem,
  FsEditRequest,
  FsTarget,
  FsVersion,
  FsWriteIntent,
} from '@maple/fs'
import type { SandboxExecutionPolicy } from '@maple/sandbox'

/**
 * Compile-time contracts: asynchronous filesystem operations require a
 * caller-owned AbortSignal. Omission must fail TypeScript compilation.
 */
function omissionContracts(fs: FileSystem, target: FsTarget): void {
  // @ts-expect-error -- resolve requires caller-owned cancellation in opts.
  void fs.resolve('a.txt')
  // @ts-expect-error -- resolve opts cannot omit signal.
  void fs.resolve('a.txt', { cwd: '/' })

  // @ts-expect-error -- stat requires caller-owned cancellation.
  void fs.stat(target)
  // @ts-expect-error -- lstat requires caller-owned cancellation.
  void fs.lstat('a.txt')
  // @ts-expect-error -- lstat requires signal even when opts is supplied.
  void fs.lstat('a.txt', { cwd: '/' })
  // @ts-expect-error -- readText requires caller-owned cancellation.
  void fs.readText(target)
  // @ts-expect-error -- streamText requires caller-owned cancellation.
  void fs.streamText(target)
  // @ts-expect-error -- readBytes requires caller-owned cancellation.
  void fs.readBytes(target)
  // @ts-expect-error -- listDir requires caller-owned cancellation.
  void fs.listDir(target)
  // @ts-expect-error -- writeText requires caller-owned cancellation.
  void fs.writeText(target, 'x', undefined)
  // @ts-expect-error -- editText requires caller-owned cancellation.
  void fs.editText(target, { oldString: 'a', newString: 'b', replaceAll: false }, undefined)
}
void omissionContracts

describe('filesystem capability signal types', () => {
  it('requires an exact AbortSignal on every awaited filesystem operation', () => {
    type Resolve = FileSystem['resolve']
    type Stat = FileSystem['stat']
    type Lstat = FileSystem['lstat']
    type ReadText = FileSystem['readText']
    type StreamText = FileSystem['streamText']
    type ReadBytes = FileSystem['readBytes']
    type ListDir = FileSystem['listDir']
    type WriteText = FileSystem['writeText']
    type EditText = FileSystem['editText']

    expectTypeOf<Resolve>().parameter(1).toMatchTypeOf<{ cwd?: string; signal: AbortSignal }>()
    expectTypeOf<Stat>().parameter(1).toEqualTypeOf<AbortSignal>()
    expectTypeOf<Lstat>().parameter(2).toEqualTypeOf<AbortSignal>()
    expectTypeOf<ReadText>().parameter(1).toEqualTypeOf<AbortSignal>()
    expectTypeOf<StreamText>().parameter(1).toEqualTypeOf<AbortSignal>()
    expectTypeOf<ReadBytes>().parameter(1).toEqualTypeOf<AbortSignal>()
    expectTypeOf<ListDir>().parameter(1).toEqualTypeOf<AbortSignal>()
    expectTypeOf<WriteText>().parameter(2).toEqualTypeOf<FsWriteIntent | undefined>()
    expectTypeOf<WriteText>().parameter(3).toEqualTypeOf<AbortSignal>()
    expectTypeOf<WriteText>().parameter(4).toEqualTypeOf<SandboxExecutionPolicy | undefined>()
    expectTypeOf<EditText>().parameter(2).toEqualTypeOf<{ version: FsVersion } | undefined>()
    expectTypeOf<EditText>().parameter(3).toEqualTypeOf<AbortSignal>()
    expectTypeOf<Parameters<EditText>[1]>().toEqualTypeOf<FsEditRequest>()
  })
})
