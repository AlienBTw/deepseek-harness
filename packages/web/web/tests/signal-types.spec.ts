import { describe, expectTypeOf, it } from 'vitest'
import type { WebRuntime } from '@maple/web'
import type {
  WebFetchProvider,
  WebFetchRequest,
  WebSearchProvider,
  WebSearchRequest,
} from '@maple/web'

/**
 * Compile-time contracts: web search/fetch require a caller-owned AbortSignal.
 * Omission must fail TypeScript compilation.
 */
function omissionContracts(
  web: WebRuntime,
  searchProvider: WebSearchProvider,
  fetchProvider: WebFetchProvider,
  searchRequest: WebSearchRequest,
  fetchRequest: WebFetchRequest,
): void {
  // @ts-expect-error -- WebRuntime.search requires caller-owned cancellation.
  void web.search(searchRequest)
  // @ts-expect-error -- WebRuntime.fetch requires caller-owned cancellation.
  void web.fetch(fetchRequest)

  // @ts-expect-error -- WebSearchProvider.search requires caller-owned cancellation.
  void searchProvider.search(searchRequest)
  // @ts-expect-error -- WebFetchProvider.fetch requires caller-owned cancellation.
  void fetchProvider.fetch(fetchRequest)
}
void omissionContracts

describe('web capability signal types', () => {
  it('requires an exact AbortSignal on search and fetch', () => {
    type Search = WebRuntime['search']
    type Fetch = WebRuntime['fetch']
    type ProviderSearch = WebSearchProvider['search']
    type ProviderFetch = WebFetchProvider['fetch']

    expectTypeOf<Search>().parameter(1).toEqualTypeOf<AbortSignal>()
    expectTypeOf<Fetch>().parameter(1).toEqualTypeOf<AbortSignal>()
    expectTypeOf<ProviderSearch>().parameter(1).toEqualTypeOf<AbortSignal>()
    expectTypeOf<ProviderFetch>().parameter(1).toEqualTypeOf<AbortSignal>()
  })
})
