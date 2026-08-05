#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { registerMeasurementTools } from "./measurementTools.js";

const server = new McpServer({
  name: "nova-measured",
  version: "0.1.0"
});

registerMeasurementTools(server, loadConfig());

const transport = new StdioServerTransport();
await server.connect(transport);
