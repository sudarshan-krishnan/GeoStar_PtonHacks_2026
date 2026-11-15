"""GeoStar API (FastAPI). Run from services/api: uvicorn app.main:app --port 8000

Layout:
    app/routers/       GeoStar's own endpoints (studio, screening, projects, design import, optimizer, live grid)
    app/engine/        GeoStar's deterministic engines (layout, screening, public data, grid, optimizer)
    app/sponsors/<x>/  one package per sponsor integration, each with its own routes
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import config
from app.db import db_ready
from app.engine import external
from app.engine import livegrid as livegrid_state
from app.engine import optimizer as optimizer_mod
from app.routers import blueprint, context, data, design, integrations, livegrid, optimize, projects, screen, studio
from app.sponsors.costar import routes_building as costar_building
from app.sponsors.costar import routes_intel as costar_intel
from app.sponsors.costar import routes_land as costar_land
from app.sponsors.costar import routes_site as costar_site
from app.sponsors.costar import routes_sites as costar_sites
from app.sponsors.elevenlabs import routes_guide as elevenlabs_guide
from app.sponsors.elevenlabs import routes_voice as elevenlabs_voice
from app.sponsors.langchain import routes_agents as langchain_agents
from app.sponsors.langchain import routes_copilot as langchain_copilot
from app.sponsors.langchain import routes_research as langchain_research
from app.sponsors.mongodb import routes as mongodb_atlas
from app.sponsors.vexcel import routes as vexcel


@asynccontextmanager
async def lifespan(_: FastAPI):
    projects.init()
    integrations.init()
    external.init()
    screen.init()
    optimizer_mod.init()
    livegrid_state.init()
    from app.sponsors.mongodb import triggers  # in-app change-stream worker; Atlas Triggers own what they can (scripts/atlas_triggers.py)
    triggers.start()
    yield
    triggers.stop()


app = FastAPI(title=f"{config.PRODUCT_NAME} API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["meta"])
def health() -> dict:
    return {"status": "ok", "product": config.PRODUCT_NAME, "parcel_store_ready": db_ready()}


# Registration order matters where paths overlap: screen before CoStar sites, so /sites/candidates is not captured by
# /sites/{parcel_id}.
ROUTERS = (
    screen.router, costar_sites.router, data.router, projects.router, integrations.router, vexcel.router,
    optimize.router, livegrid.router, langchain_research.router, elevenlabs_voice.router, design.router, context.router,
    studio.router, langchain_copilot.router, elevenlabs_guide.router, blueprint.router,
    costar_building.router,     # CoStar building facts, Matterport scan scope, conversion check, site walk
    mongodb_atlas.router,       # MongoDB Atlas: schema, search, vectors, geo, analytics, change streams
    costar_land.router,         # comps, valuation, market
    costar_intel.router,        # CoStar intelligence tools, MCP audit timeline, deal room, Deal-to-Design
    costar_site.router,         # control, occupancy, redevelopment screen, community exposure
    langchain_agents.router,    # Deep Agents: orchestrator, specialists, live execution graph, evidence
)
for r in ROUTERS:
    app.include_router(r)
