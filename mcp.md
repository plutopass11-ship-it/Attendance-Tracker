# Attendance Tracker — MCP Server Documentation

> **What is this?** A Model Context Protocol (MCP) server that exposes the Attendance Tracker database as discoverable Tools and Resources for AI agents. Any MCP-compatible client (n8n, Claude Desktop, OpenClaw, Cursor, etc.) can connect and interact with attendance data using natural language.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                   Synology NAS                       │
│                                                      │
│  ┌──────────┐   ┌──────────────┐   ┌──────────────┐ │
│  │  Nginx   │──▶│   Backend    │   │  MCP Server  │ │
│  │ :3500    │   │   :4000      │   │   :3100      │ │
│  │          │──▶│              │   │              │ │
│  └──────────┘   └──────┬───────┘   └──────┬───────┘ │
│                        │                  │          │
│                   ┌────▼──────────────────▼────┐     │
│                   │     PostgreSQL :5434       │     │
│                   │   (attendance_tracker DB)  │     │
│                   └───────────────────────────┘     │
│                                                      │
│  ┌──────────┐                                        │
│  │   n8n    │───── connects via SSE ──▶ :3100        │
│  └──────────┘                                        │
└──────────────────────────────────────────────────────┘
```

The MCP server is a **standalone microservice** that connects directly to the same PostgreSQL database as the main backend. It does NOT proxy through the backend API — it runs its own SQL queries for maximum reliability and zero coupling.

### File Structure
```
mcp-server/
├── package.json       # Dependencies
├── Dockerfile         # Container build definition
├── index.js           # Express + SSE transport entry point
├── db.js              # PostgreSQL connection pool
├── tools.js           # All MCP Tool definitions (19 tools across 6 domains)
└── resources.js       # All MCP Resource definitions (4 resources)
```

---

## Connection Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/sse` | GET | Opens an SSE stream (persistent connection) |
| `/messages?sessionId=xxx` | POST | Sends JSON-RPC requests to the server |
| `/health` | GET | Health check (returns status, active sessions, uptime) |

### Direct Access (bypassing Nginx)
```
http://192.168.1.60:3100/sse
http://192.168.1.60:3100/health
```

### Via Nginx Proxy
```
http://192.168.1.60:3500/mcp/sse
http://192.168.1.60:3500/mcp/health
```

---

## Available Tools (19)

### Attendance Domain
| Tool | Description |
|---|---|
| `get_attendance_today` | Live attendance for all/specific employee |
| `get_attendance_by_date` | Attendance records for any date |
| `get_user_worktime` | Calculate hours worked (check-in to check-out) |
| `get_pending_clockouts` | List pending early clock-out approvals |
| `approve_early_clockout` | Approve an early clock-out (marks day complete) |
| `reject_early_clockout` | Reject clock-out (puts employee back on clock) |

### Leave Domain
| Tool | Description |
|---|---|
| `get_pending_leaves` | List all pending leave requests |
| `get_leave_balance` | Get remaining leave quota per type for a user |
| `approve_leave` | Approve a leave request by ID |
| `reject_leave` | Reject a leave request by ID |
| `submit_leave` | Create a leave request (with optional auto-approve) |
| `get_employees_on_leave` | Who's on leave today/on a specific date |

### User Domain
| Tool | Description |
|---|---|
| `list_users` | List all registered employees |
| `get_user_info` | Detailed user profile + today's status + recent leaves |

### Holiday Domain
| Tool | Description |
|---|---|
| `list_holidays` | All holidays (public + optional) |
| `get_upcoming_holidays` | Holidays in the next N days |

### WhatsApp Identity Domain
| Tool | Description |
|---|---|
| `lookup_user_by_phone` | Find employee by phone number (WhatsApp sender → user_id) |
| `get_all_user_phones` | List all employees with registered phone numbers |

### Attendance Write Domain
| Tool | Description |
|---|---|
| `mark_attendance` | Check in or check out an employee (with full business logic) |

## Available Resources (4)

| URI | Description |
|---|---|
| `attendance://status/today` | Full live employee status snapshot |
| `attendance://leaves/pending` | All pending leave requests |
| `attendance://policies` | Leave policy configuration |
| `attendance://holidays` | Full holiday calendar |

---

## How to Connect

### n8n
1. Install the `n8n-nodes-mcp` community package (Settings → Community Nodes)
2. Set environment variable: `N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true`
3. Add an **MCP Client** node to your workflow
4. Set transport to **SSE**
5. Set URL to: `http://attendance-mcp:3100/sse` (if n8n is on the same Docker network) or `http://192.168.1.60:3100/sse` (if on the same LAN)
6. The node will auto-discover all 16 tools

### Claude Desktop / OpenClaw
Add to your MCP config file (`claude_desktop_config.json` or equivalent):
```json
{
  "mcpServers": {
    "attendance-tracker": {
      "url": "http://192.168.1.60:3100/sse"
    }
  }
}
```

---

## How to Add a New Tool

Open `tools.js` and add a new `server.tool()` call inside the `registerTools` function:

```javascript
server.tool(
    'my_new_tool',                          // 1. Tool name (snake_case)
    'Description the AI reads to decide when to use this tool',  // 2. Description
    {                                        // 3. Parameters (Zod schema)
        userId: z.string().describe('Employee user ID'),
        date: z.string().optional().describe('Date in YYYY-MM-DD')
    },
    async ({ userId, date }) => {            // 4. Handler function
        const result = await pool.query(
            'SELECT * FROM my_table WHERE user_id = $1', [userId]
        );
        return {
            content: [{
                type: 'text',
                text: JSON.stringify(result.rows, null, 2)
            }]
        };
    }
);
```

After adding the tool, rebuild the container:
```bash
cd /volume1/docker/Apps/Attendance-Tracker/Attendance-Tracker/deployment
sudo docker-compose up -d --build attendance-mcp
```

The new tool will be auto-discovered by all connected MCP clients.

## How to Add a New Resource

Open `resources.js` and add a new `server.resource()` call inside `registerResources`:

```javascript
server.resource(
    'resource-name',                        // 1. Display name
    'attendance://my/resource/uri',         // 2. URI
    async (uri) => {                        // 3. Handler
        const result = await pool.query('SELECT * FROM my_table');
        return {
            contents: [{
                uri: uri.href,
                mimeType: 'application/json',
                text: JSON.stringify(result.rows, null, 2)
            }]
        };
    }
);
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_DB` | `attendance_tracker` | Database name |
| `POSTGRES_USER` | `attendance_admin` | Database user |
| `POSTGRES_PASSWORD` | `AttendancePluto@2026` | Database password |
| `POSTGRES_HOST` | `attendance-db` | Database host (Docker service name) |
| `POSTGRES_PORT` | `5432` | Database port |
| `MCP_PORT` | `3100` | Port the MCP server listens on |

All values are inherited from the same `.env` file used by the main backend.

---

## Deployment

The MCP server is defined as the `attendance-mcp` service in `deployment/docker-compose.yml`. It:
- Builds from the `../mcp-server` directory
- Connects to the same PostgreSQL instance as the backend
- Exposes port 3100
- Auto-restarts on crash (`unless-stopped`)
- Waits for PostgreSQL health check before starting

### Build & Start
```bash
cd /volume1/docker/Apps/Attendance-Tracker/Attendance-Tracker/deployment
sudo docker-compose up -d --build
```

### Rebuild MCP Only (after code changes)
```bash
sudo docker-compose up -d --build attendance-mcp
```

### View Logs
```bash
sudo docker logs attendance-mcp -f
```

---

## Troubleshooting

### MCP server won't start
- Check logs: `docker logs attendance-mcp`
- Most likely cause: PostgreSQL not ready yet. The health check dependency should handle this, but verify with `docker ps` that `attendance-postgres` shows as healthy.

### n8n can't connect
- If n8n is on the same Docker network, use `http://attendance-mcp:3100/sse`
- If n8n is on a different machine/network, use `http://192.168.1.60:3100/sse`
- If connecting through Nginx, use `http://192.168.1.60:3500/mcp/sse`
- Verify SSE is working: open `http://192.168.1.60:3100/sse` in a browser — you should see a stream of `data:` messages

### Tools not showing up
- Hit the health endpoint: `http://192.168.1.60:3100/health`
- If healthy but no tools, rebuild: `docker-compose up -d --build attendance-mcp`

### SSE connection drops through Nginx
- Ensure `proxy_buffering off` and `X-Accel-Buffering no` are set in the Nginx config for the `/mcp/sse` location block
- Ensure no Gzip compression is applied to SSE responses

---

## Database Schema Reference

The MCP server queries these tables directly:
- **`users`** — Employee accounts (user_id, name, role)
- **`attendance`** — Daily check-in/out records with status (working, completed, pending_early_clockout)
- **`leave_requests`** — Leave/WFH requests with approval status
- **`leave_policies`** — Leave type quotas and cycles
- **`holidays`** — Public and optional holiday calendar
- **`holiday_claims`** — Employee claims on optional holidays
