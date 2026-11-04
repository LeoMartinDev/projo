export const isServerPath = (path: string): boolean =>
  path === '/api' ||
  path.startsWith('/api/') ||
  path === '/health' ||
  path === '/mcp' ||
  path.startsWith('/mcp/') ||
  path.startsWith('/.well-known/') ||
  path === '/oauth/token' ||
  path === '/oauth/register'

export const hasFileExtension = (path: string): boolean => /\.[a-z0-9]+$/i.test(path)
