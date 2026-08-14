// @lanhu-context/mcp — MCP compatibility layer for lanhu-context
// (DESIGN.md §9). Keeps the upstream lanhu-context-mcp wire contract
// (get_design_context, inline/files modes, resource_link, STOP errors) while
// running on @lanhu-context/core's graded-severity pipeline.

export {
  type LanhuMcpOptions,
  type McpMode,
  registerGetDesignContext
} from './get-design-context';
export { createServer } from './server';
export {
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_PORT,
  type McpTransportKind,
  type RunningServer,
  type StartServerOptions,
  startServer
} from './start';
export { MCP_PKG_NAME, MCP_PKG_VERSION } from './version';
