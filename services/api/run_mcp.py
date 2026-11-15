"""Launch the GeoStar CoStar MCP server from any working directory (used by .mcp.json)."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
sys.path.insert(0, HERE)

from app.sponsors.costar.mcp_server import main  # noqa: E402

main()
