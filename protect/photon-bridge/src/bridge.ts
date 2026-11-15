/**
 * SiteStar PROTECT <-> Photon (iMessage) bridge.
 *
 *   POST http://127.0.0.1:8797/send  {"text": "..."}   -> iMessage to the building manager
 *   manager's replies                                   -> POST {PROTECT_URL}/api/manager/reply
 *
 * Env:
 *   SPECTRUM_PROJECT_ID, SPECTRUM_PROJECT_SECRET   Photon dashboard -> project settings
 *   MANAGER_PHONE   optional, e.g. +15551234567. If set, the bridge opens the DM itself.
 *                   If not, the manager texts the agent's number once ("hi") to subscribe.
 *   PROTECT_URL     default http://127.0.0.1:8796
 *   BRIDGE_PORT     default 8797
 */
import http from "node:http";
import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";

const PROTECT_URL = process.env.PROTECT_URL ?? "http://127.0.0.1:8796";
const PORT = Number(process.env.BRIDGE_PORT ?? 8797);
const MANAGER_PHONE = process.env.MANAGER_PHONE;

type Sendable = { send(text: string): Promise<unknown> };

const app = await Spectrum({ providers: [imessage.config()] });
let manager: Sendable | null = null;
const seen = new Set<string>();

if (MANAGER_PHONE) {
  try {
    manager = await imessage(app).space.create(MANAGER_PHONE);
    console.log("[bridge] DM open with the manager");
  } catch (err) {
    console.log(`[bridge] could not open a DM with MANAGER_PHONE (${String(err)}); waiting for the manager to text in`);
  }
}

async function forward(text: string, sender: string, channel: string): Promise<void> {
  try {
    await fetch(`${PROTECT_URL}/api/manager/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, sender, channel }),
    });
  } catch (err) {
    console.log(`[bridge] PROTECT not reachable: ${String(err)}`);
  }
}

// Inbound: the manager's texts.
(async () => {
  for await (const [space, message] of app.messages) {
    if (seen.has(message.id)) continue; // at-least-once delivery
    seen.add(message.id);
    if (message.content.type !== "text") continue;
    const text = message.content.text.trim();
    const firstContact = manager === null;
    manager = space;
    if (firstContact && /^(hi|hello|start|subscribe)\b/i.test(text)) {
      await space.send("SiteStar Protect here. I'm watching your building and will text you here the moment anything needs you.");
      continue;
    }
    console.log(`[bridge] manager: ${text}`);
    await forward(text, message.sender?.id ?? "manager", message.platform);
  }
})();

// Outbound: PROTECT asks us to text the manager.
http
  .createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, managerConnected: manager !== null }));
      return;
    }
    if (req.method !== "POST" || req.url !== "/send") {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const { text } = JSON.parse(body) as { text?: string };
      if (!text) throw new Error("missing text");
      if (!manager) {
        res.writeHead(409, { "Content-Type": "text/plain" });
        res.end("manager has not texted the agent yet (or set MANAGER_PHONE)");
        return;
      }
      await manager.send(text);
      res.writeHead(200, { "Content-Type": "application/json" }).end('{"ok":true}');
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" }).end(String(err));
    }
  })
  .listen(PORT, "127.0.0.1", () => console.log(`[bridge] listening on http://127.0.0.1:${PORT}  ->  ${PROTECT_URL}`));
