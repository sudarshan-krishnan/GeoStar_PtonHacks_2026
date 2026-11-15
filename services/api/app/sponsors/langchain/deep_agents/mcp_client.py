"""One MCP client session to GeoStar's CoStar MCP server, shared by every agent run.

The server is app/sponsors/costar/mcp_server.py, the same server Claude Desktop or Claude Code connect to. Here the client talks to it
in-process (mcp.Client(server): the real MCP protocol, JSON-RPC over in-memory streams, no network), on a background
event loop. Agent tools run on LangGraph's worker threads and call into that loop, so parallel subagents can make
concurrent MCP calls over the one session.
"""
from __future__ import annotations

import asyncio
import threading
from typing import Any


class CostarMCP:
    transport = "in-process (mcp.Client over memory streams)"

    def __init__(self) -> None:
        self.loop: asyncio.AbstractEventLoop | None = None
        self.client: Any = None
        self.tools: list[Any] = []
        self.server_name: str | None = None
        self.error: str | None = None
        self._ready = threading.Event()
        self._started = False
        self._lock = threading.Lock()

    def ensure(self, timeout: float = 30) -> bool:
        with self._lock:
            if not self._started:
                self._started = True
                threading.Thread(target=lambda: asyncio.run(self._main()), name="costar-mcp", daemon=True).start()
        self._ready.wait(timeout)
        return self.client is not None

    async def _main(self) -> None:
        from mcp import Client

        from app.sponsors.costar.mcp_server import server
        self.loop = asyncio.get_running_loop()
        try:
            async with Client(server) as c:
                self.client = c
                self.tools = list((await c.list_tools()).tools)
                info = getattr(c, "server_info", None)
                self.server_name = getattr(info, "name", None) or "plotstar-costar"
                self._ready.set()
                await asyncio.Event().wait()  # keep the session open for the life of the process
        except Exception as e:  # noqa: BLE001 - surfaced in status and in every tool call
            self.error = f"{type(e).__name__}: {e}"
            self.client = None
            self._ready.set()

    def call(self, name: str, args: dict[str, Any], timeout: float = 90) -> dict[str, Any]:
        """Call one MCP tool; returns the server's structured envelope {ok, data, sources, label, error, ms}."""
        if not self.ensure():
            return {"ok": False, "error": f"CoStar MCP server unavailable: {self.error}", "data": None, "sources": []}
        fut = asyncio.run_coroutine_threadsafe(self.client.call_tool(name, args), self.loop)
        res = fut.result(timeout)
        body = getattr(res, "structured_content", None)
        if body is None:
            import json
            try:
                body = json.loads(res.content[0].text)
            except Exception:  # noqa: BLE001
                body = {"ok": False, "error": "MCP tool returned no structured content", "data": None}
        if getattr(res, "is_error", False) and body.get("ok") is not False:
            body = {**body, "ok": False, "error": body.get("error") or "MCP tool error"}
        return body

    def status(self) -> dict[str, Any]:
        return dict(server=self.server_name or "plotstar-costar", transport=self.transport, connected=self.client is not None,
                    tools=[t.name for t in self.tools], error=self.error)


MCP = CostarMCP()
