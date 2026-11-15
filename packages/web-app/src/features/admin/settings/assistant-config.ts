import { mcpPath } from '@projo/shared/api/assistants'

type AssistantConfigInput = { origin: string; token: string }

export const mcpUrl = (origin: string): string => `${origin}${mcpPath}`

export const claudeCodeCommand = ({ origin, token }: AssistantConfigInput): string =>
  `claude mcp add --transport http projo ${mcpUrl(origin)} --header "Authorization: Bearer ${token}"`

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
