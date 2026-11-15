"""LangChain, LangGraph and LangSmith.

    deep_agents/     the PlotStar orchestrator and six specialist subagents (Deep Agents SDK), live execution graph,
                     deterministic site score, verification; routes in routes_agents.py (POST /agents/*)
    copilot.py       the earlier LangGraph plan -> act -> verify -> respond copilot (still used by the voice guide)
    research_agent.py, deal_agent.py   the /explore research agent and the Deal-to-Design pipeline
"""
