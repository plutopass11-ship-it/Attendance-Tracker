const express = require('express');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { testConnection } = require('./db');
const { registerTools } = require('./tools');
const { registerResources } = require('./resources');

const app = express();
app.use(express.json());

// ─── MCP Server Instance ────────────────────────────────────────
const mcpServer = new McpServer({
    name: 'attendance-tracker-mcp',
    version: '1.0.0',
    description: 'MCP Server for the Attendance Tracker — exposes attendance, leave, user, and holiday management tools for AI agents.'
});

// Register all tools and resources
registerTools(mcpServer);
registerResources(mcpServer);

// ─── Session Management ─────────────────────────────────────────
const transports = {};

// SSE endpoint — clients connect here to open a persistent stream
app.get('/sse', async (req, res) => {
    console.log(`[MCP] New SSE connection from ${req.ip}`);
    const transport = new SSEServerTransport('/messages', res);
    transports[transport.sessionId] = transport;

    // Cleanup on disconnect
    res.on('close', () => {
        console.log(`[MCP] SSE session ${transport.sessionId} disconnected`);
        delete transports[transport.sessionId];
    });

    await mcpServer.connect(transport);
});

// Messages endpoint — clients send JSON-RPC requests here
app.post('/messages', async (req, res) => {
    const sessionId = req.query.sessionId;
    const transport = transports[sessionId];

    if (!transport) {
        return res.status(400).json({ error: 'Invalid or expired session ID. Reconnect via GET /sse.' });
    }

    await transport.handlePostMessage(req, res, req.body);
});

// ─── Health Check ────────────────────────────────────────────────
app.get('/health', async (req, res) => {
    try {
        const { pool } = require('./db');
        await pool.query('SELECT 1');
        res.json({
            status: 'healthy',
            server: 'attendance-tracker-mcp',
            version: '1.0.0',
            activeSessions: Object.keys(transports).length,
            uptime: process.uptime()
        });
    } catch (err) {
        res.status(503).json({ status: 'unhealthy', error: err.message });
    }
});

// ─── Startup ─────────────────────────────────────────────────────
const PORT = process.env.MCP_PORT || 3100;

async function start() {
    try {
        await testConnection();
        app.listen(PORT, () => {
            console.log(`\n══════════════════════════════════════════════`);
            console.log(`  Attendance Tracker MCP Server v1.0.0`);
            console.log(`  SSE endpoint:     http://0.0.0.0:${PORT}/sse`);
            console.log(`  Messages endpoint: http://0.0.0.0:${PORT}/messages`);
            console.log(`  Health check:      http://0.0.0.0:${PORT}/health`);
            console.log(`══════════════════════════════════════════════\n`);
        });
    } catch (err) {
        console.error('[MCP] Fatal startup error:', err);
        process.exit(1);
    }
}

start();
