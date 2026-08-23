#!/usr/bin/env node

import { Context } from '@maple/cordis'
import { pathToFileURL } from 'node:url'
import Loader from '@maple/cordis-plugin-loader'

const ctx = new Context()
ctx.baseUrl = pathToFileURL(process.cwd()).href + '/'

await ctx.plugin(Loader)
await ctx.loader.create({
  name: '@maple/cordis-plugin-include',
  config: {
    path: './cordis.yml',
  },
})
