# Exposing an MCP Server to the Frontend

This document outlines the plan for making a remote **Model Context Protocol (MCP)** server accessible to the React frontend in this repository. The proposed approach builds on the MCP specification and leverages the existing Lambda function deployed by the CDK stack.

## MCP Specification Highlights

The 2025-06-18 MCP specification describes a protocol for connecting language model hosts, clients, and servers using JSON-RPC 2.0 messages and stateful connections. Key elements include:

- **Hosts** initiate connections to obtain context and capabilities.
- **Clients** run inside the host application.
- **Servers** provide resources, prompts, and tools.
- Capability negotiation and stateful JSON-RPC exchanges form the base protocol.
- Security guidelines emphasize explicit user consent and careful control over resource access and tool execution.

These details are summarized from `modelcontextprotocol.io/specification/2025-06-18/index`.

## Current Architecture

- The CDK stack defines a Lambda function (`WorkspaceFunction`) with a public Function URL.
- The React frontend is deployed to an S3 bucket and can invoke this Lambda.
- The Lambda currently returns a simple payload.

## Implementation Plan

1. **Implement MCP Server Logic in Lambda**
   - Extend the existing Lambda handler to process MCP JSON-RPC requests.
   - Support server features such as `resources`, `prompts`, and `tools` as defined by the MCP specification.
   - Ensure that each request/response follows the MCP schema so that clients can negotiate capabilities and maintain stateful connections.

2. **Expose an HTTP Endpoint**
   - Continue using the Lambda Function URL as the HTTP transport for MCP messages.
   - Optionally add WebSocket support (via API Gateway) if persistent connections are required.

3. **Update Frontend Client**
   - Implement an MCP client in TypeScript that sends JSON-RPC requests to the Lambda endpoint.
   - Manage connection state and capability negotiation in the browser.
   - Provide UI components to display resources and prompt the user for consent before invoking tools or sharing data, following the security principles in the specification.

4. **Security Considerations**
   - Obtain explicit user consent before sharing data with the MCP server.
   - Clearly display the actions each tool performs before the user authorizes execution.
   - Restrict what information the server can see from prompts, and enforce access controls within Lambda.

5. **Future Enhancements**
   - Add progress tracking, logging, and cancellation utilities as described by the MCP spec.
   - Explore additional MCP features such as sampling and roots for advanced workflows.

## References

- [Model Context Protocol – Specification](https://modelcontextprotocol.io/specification/2025-06-18/index)
- [Model Context Protocol – Documentation](https://modelcontextprotocol.info/specification/)
