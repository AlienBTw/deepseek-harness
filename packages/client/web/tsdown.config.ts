import { staticLinked } from '../tsdown.client.ts'

export default staticLinked(
  '@maple/client-web',
  ['lib/types/index.js', 'lib/types/invariant.js'],
)
