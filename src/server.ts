#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { registerMeasurementTools } from "./measurementTools.js";
import { ProductMetadata } from "./productMetadata.js";

const server = new McpServer({
  name: ProductMetadata.name,
  version: ProductMetadata.version
});

registerMeasurementTools(server, loadConfig());

const transport = new StdioServerTransport();
await server.connect(transport);
