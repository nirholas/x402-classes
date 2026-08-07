# Exposing x402-classes as an MCP tool for Claude

Model Context Protocol (MCP) lets Claude call this class server as a native tool.
The pattern: an MCP server wraps the paid endpoint with `x402-fetch`, so the one
paid call pays automatically from the agent's wallet. Everything else — the
schedule, the roster, pass verification — is free and needs no wallet at all.

The server quotes both rails in every 402 (USDC on Base and USDC on Solana);
`x402-fetch` settles the Base entry. To have the MCP server pay on Solana
instead, swap the wrapper for your own Solana signer — see
[`agent-client.ts`](agent-client.ts) for the exact envelope.

## Minimal MCP server (`mcp-server.ts`)

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { wrapFetchWithPayment } from "x402-fetch";
import { privateKeyToAccount } from "viem/accounts";

const BASE_URL = process.env.CLASSES_URL ?? "http://localhost:4023";
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const payFetch = wrapFetchWithPayment(fetch, account);

const server = new McpServer({ name: "classes", version: "0.1.0" });

server.tool(
  "get_schedule",
  "Read the class timetable with live seat counts (free — no payment)",
  { class: z.string().optional(), date: z.string().optional(), days: z.number().optional() },
  async ({ class: cls, date, days }) => {
    const qs = new URLSearchParams();
    if (cls) qs.set("class", cls);
    if (date) qs.set("date", date);
    if (days) qs.set("days", String(days));
    const res = await fetch(`${BASE_URL}/schedule?${qs}`);
    return { content: [{ type: "text", text: await res.text() }] };
  },
);

server.tool(
  "enroll_in_class",
  "Buy a seat in one class session for $0.05 USDC via x402. Returns the seat number, class details, an ICS invite and a signed QR pass. classId looks like 'vinyasa-am@2026-08-10' — get it from get_schedule.",
  { classId: z.string(), name: z.string(), email: z.string().optional() },
  async ({ classId, name, email }) => {
    const res = await payFetch(`${BASE_URL}/enroll/${encodeURIComponent(classId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email }),
    });
    return { content: [{ type: "text", text: await res.text() }] };
  },
);

server.tool(
  "verify_pass",
  "Check whether a QR pass token is valid (free)",
  { token: z.string() },
  async ({ token }) => {
    const res = await fetch(`${BASE_URL}/verify/${token}`);
    return { content: [{ type: "text", text: await res.text() }] };
  },
);

await server.connect(new StdioServerTransport());
```

Dependencies: `npm i @modelcontextprotocol/sdk x402-fetch viem zod`

Questions: **nichxbt@gmail.com**

## claude_desktop_config.json

```json
{
  "mcpServers": {
    "classes": {
      "command": "npx",
      "args": ["tsx", "/path/to/mcp-server.ts"],
      "env": {
        "CLASSES_URL": "http://localhost:4023",
        "PRIVATE_KEY": "0x...funded base-sepolia key"
      }
    }
  }
}
```

Claude can then be asked: *"Get me into a yoga class on Friday morning"* — it
reads the schedule for free, picks a session with seats left, pays $0.05 for the
seat, and hands back the seat number with the QR pass and calendar invite.

Because the QR is returned as an SVG data URI, Claude can show it directly or
save it to a file the user scans at the door.

## Spending safety

Give the MCP wallet a small, dedicated balance. `wrapFetchWithPayment` accepts a
`maxValue` (base units) to hard-cap what a single call may spend; combine with
per-session budgets in your agent framework. Because settlement is deferred until
the route returns `2xx`, a full class never draws down that budget.

Note that seats are **non-refundable** once the pass is issued — check
`passPolicy` from the free `/schedule` before letting an agent spend.
