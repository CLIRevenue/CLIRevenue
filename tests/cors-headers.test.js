import { describe, it, expect } from 'vitest'
import { corsFor, optionsResponse, serveWithCors } from '../supabase/functions/_shared/http.ts'

describe('CORS headers for CLIRevenue SDK', () => {
  it('includes all required SDK headers in Access-Control-Allow-Headers', () => {
    const headers = corsFor(new Request('http://localhost', { method: 'OPTIONS' }))
    const allowHeaders = headers['Access-Control-Allow-Headers']
    expect(allowHeaders).toContain('authorization')
    expect(allowHeaders).toContain('x-client-info')
    expect(allowHeaders).toContain('apikey')
    expect(allowHeaders).toContain('content-type')
    expect(allowHeaders).toContain('x-settlement-secret')
    expect(allowHeaders).toContain('x-idempotency-key')
    expect(allowHeaders).toContain('x-clirevenue-sdk-version')
  })

  it('returns wildcard origin when APP_ORIGINS is not set', () => {
    const headers = corsFor(new Request('http://localhost', { method: 'OPTIONS' }))
    expect(headers['Access-Control-Allow-Origin']).toBe('*')
  })

  it('optionsResponse includes the full CORS header set', () => {
    const response = optionsResponse(new Request('http://localhost', { method: 'OPTIONS' }))
    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    const allowHeaders = response.headers.get('Access-Control-Allow-Headers')
    expect(allowHeaders).toContain('x-idempotency-key')
    expect(allowHeaders).toContain('x-clirevenue-sdk-version')
  })

  it('serveWithCors preserves CORS headers on a real handler', async () => {
    const handler = serveWithCors(async (req) => {
      const headers = corsFor(req)
      return new Response('ok', { status: 200, headers })
    })
    const response = await handler(new Request('http://localhost', { method: 'GET' }))
    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    const allowHeaders = response.headers.get('Access-Control-Allow-Headers')
    expect(allowHeaders).toContain('x-idempotency-key')
    expect(allowHeaders).toContain('x-clirevenue-sdk-version')
  })
})