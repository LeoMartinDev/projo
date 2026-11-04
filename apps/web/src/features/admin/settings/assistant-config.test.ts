import { describe, expect, test } from 'bun:test'

import { claudeCodeCommand, claudeDesktopConfig, mcpUrl } from './assistant-config.ts'

const input = { origin: 'https://projo.example.com', token: 'tok_123' }

describe('assistant configuration', () => {
  test('the MCP endpoint sits at the root of the origin', () => {
    expect(mcpUrl('http://192.168.1.20:8080')).toBe('http://192.168.1.20:8080/mcp')
  })

  test('Claude Code: one command with the bearer header', () => {
    expect(claudeCodeCommand(input)).toBe(
      'claude mcp add --transport http projo https://projo.example.com/mcp --header "Authorization: Bearer tok_123"',
    )
  })

  test('Claude Desktop: mcp-remote with the token in an environment variable', () => {
    const config = claudeDesktopConfig(input)
    expect(JSON.parse(config)).toEqual({
      mcpServers: {
        projo: {
          command: 'npx',
          args: [
            '-y',
            'mcp-remote',
            'https://projo.example.com/mcp',
            '--header',
            'Authorization:${PROJO_AUTH}',
          ],
          env: { PROJO_AUTH: 'Bearer tok_123' },
        },
      },
    })
    expect(config.split('\n').length).toBeGreaterThan(1)
  })
})
