"""GeoStar Deep Agents: one orchestrator, six specialist subagents, one conversation.

    runtime.py   run registry, the callback recorder that turns real LangChain/LangGraph callbacks into the live
                 execution graph, and the evidence store (full tool output stays local; the model sees a view)
    mcp_client   one process-wide MCP session to GeoStar's CoStar MCP server (app/sponsors/costar/mcp_server.py)
    tools.py     the tools each agent may call: CoStar over MCP, and GeoStar's deterministic engines
    scoring.py   the reproducible site score: documented weights, normalisation, gates and evidence gaps
    agents.py    the orchestrator (create_deep_agent) and its subagents; site evaluation and conversation runs

Rule: models choose what to investigate and explain it; deterministic code produces every number and the score.
"""
