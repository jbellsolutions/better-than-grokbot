export type ToolConnection = {
  id: string;
  botId: string;
  name: string;
  description: string;
  kind: "api" | "cli" | "mcp";
  /** API or MCP endpoint. Its address is configured by the user, never by a model. */
  url?: string;
  /** Name of a server environment variable, never its value. */
  tokenEnv?: string;
  /** CLI receives JSON arguments on stdin; executable and argv are fixed. */
  command?: string;
  args?: string[];
  inputSchema: Record<string, unknown>;
};
