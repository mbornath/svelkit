import type { Response, Headers } from '../types.dom'
import type { GraphQLExchange, GraphQLRequestOptions, GraphQLServerResult } from '../types'
import stableStringify from 'fast-json-stable-stringify'
import { isString } from '../internal/is'

export class GraphQLFetchError extends Error {
  readonly status: number
  readonly body: string | GraphQLServerResult
  readonly headers: Headers

  constructor(response: Response, body: string | GraphQLServerResult) {
    super(
      (isString(body) ? body : (body.errors || [])[0]?.message) ||
        `[${response.status}] ${response.statusText}`,
    )
    this.name = 'GraphQLFetchError'
    this.status = response.status
    this.body = body
    this.headers = response.headers
  }
}

const emptyToUndefined = <T extends Record<string, unknown>>(
  object: undefined | T,
): undefined | T => (object && Object.keys(object).length > 0 ? object : undefined)

const MAX_URL_LENGTH = 2000

const isJsonResponse = (response: Response): boolean | undefined =>
  response.headers.get('Content-Type')?.startsWith('application/json')

/**
 * A default exchange for fetching GraphQL requests.
 */
const fetchExchange = (config: GraphQLRequestOptions = {}): GraphQLExchange => async (
  { operation, query, variables, extensions, options },
  next,
) => {
  if (operation.type === 'query' || operation.type === 'mutation') {
    const { fetch = globalThis.fetch, uri = '/graphql', preferGetForQueries, ...init } = {
      referrerPolicy: 'strict-origin-when-cross-origin' as ReferrerPolicy,
      ...config,
      ...options,
      headers: {
        Accept: 'application/json',
        ...config.headers,
        ...options.headers,
      },
    }

    let response: Response | undefined

    const args = {
      operationName: operation.name,
      query: query || undefined,
      variables: emptyToUndefined(variables),
      extensions: emptyToUndefined(extensions),
    }

    if (preferGetForQueries && operation.type === 'query') {
      const url = new URL(uri, document.baseURI)

      // Add all defined args as search parameters
      for (const [key, value] of Object.entries(args)) {
        if (value) {
          url.searchParams.set(key, isString(value) ? value : stableStringify(value))
        }
      }

      if (url.href.length < MAX_URL_LENGTH) {
        response = await fetch(url.href, { ...init, method: 'GET' })
      }
    }

    if (!response) {
      response = await fetch(new URL(uri, document.baseURI).href, {
        ...init,
        method: 'POST',
        headers: {
          ...init.headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(args),
      })
    }

    if (response.ok && isJsonResponse(response)) {
      return response.json()
    }

    throw new GraphQLFetchError(
      response,
      await (isJsonResponse(response) ? response.json() : response.text()),
    )
  }

  return next()
}

export { fetchExchange as fetch }
