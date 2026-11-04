import { mcpPath } from '@projo/shared/api/assistants'

type AssistantConfigInput = { origin: string; token: string }

/** The MCP endpoint of this server as the page reaches it (§27.2). */
export const mcpUrl = (origin: string): string => `${origin}${mcpPath}`

/** Claude Code: one command adds projo as an HTTP MCP server (§27.3). */
export const claudeCodeCommand = ({ origin, token }: AssistantConfigInput): string =>
  `claude mcp add --transport http projo ${mcpUrl(origin)} --header "Authorization: Bearer ${token}"`

/**
 * Claude Desktop (`claude_desktop_config.json`): through the `mcp-remote` bridge, the header
 * passed by an environment variable (its value holds a space, which `args` would split).
 */
export const claudeDesktopConfig = ({ origin, token }: AssistantConfigInput): string =>
  JSON.stringify(
    {
      mcpServers: {
        projo: {
          command: 'npx',
          args: ['-y', 'mcp-remote', mcpUrl(origin), '--header', 'Authorization:${PROJO_AUTH}'],
          env: { PROJO_AUTH: `Bearer ${token}` },
        },
      },
    },
    undefined,
    2,
  )
