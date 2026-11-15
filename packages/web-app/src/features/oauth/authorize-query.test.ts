import { describe, expect, test } from 'bun:test'

import { readAuthorizeQuery } from './authorize-query.ts'

const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
const base = `?response_type=code&client_id=abc&redirect_uri=${encodeURIComponent('https://chatgpt.com/connector/oauth/cb')}&code_challenge=${challenge}&code_challenge_method=S256`

describe('readAuthorizeQuery', () => {
  test('keeps the values as they came, numbers and JSON-looking ones included', () => {
    expect(
      readAuthorizeQuery(
        `${base}&state=1e3&scope=projo&resource=${encodeURIComponent('https://projo.example.com/mcp')}&extra=1`,
      ),
    ).toEqual({
      response_type: 'code',
      client_id: 'abc',
      redirect_uri: 'https://chatgpt.com/connector/oauth/cb',
      state: '1e3',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      scope: 'projo',
      resource: 'https://projo.example.com/mcp',
    })
  })

  test('optional parameters may be left out', () => {
    expect(readAuthorizeQuery(base)).not.toHaveProperty('state')
  })

  test('a missing, repeated or out-of-bounds parameter makes it invalid', () => {
    expect(readAuthorizeQuery('?response_type=code&client_id=abc')).toBeUndefined()
    expect(readAuthorizeQuery(`${base}&state=a&state=b`)).toBeUndefined()
    expect(readAuthorizeQuery(base.replace(challenge, 'short'))).toBeUndefined()
  })
})
