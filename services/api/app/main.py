"""PlotStar API (FastAPI). Run: uvicorn app.main:app --reload --port 8000"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import config, external
from .db import db_ready
from .routers import context, copilot, design, studio, voice, guide
from .routers import agent, data, integrations, livegrid, optimize, projects, screen, sites, vexcel
from .routers import blueprint
from . import livegrid as livegrid_state
from . import optimizer as optimizer_mod


@asynccontextmanager
async def lifespan(_: FastAPI):
    projects.init()
    integrations.init()
    external.init()
    screen.init()
    optimizer_mod.init()
    livegrid_state.init()
    from . import triggers  # in-app change-stream worker; Atlas Triggers own what they can (see scripts/atlas_triggers.py)
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


# screen.router first so /sites/candidates is not captured by /sites/{parcel_id}
for r in (screen.router, sites.router, data.router, projects.router, integrations.router, vexcel.router,
          optimize.router, livegrid.router, agent.router, voice.router, design.router, context.router, studio.router,
          copilot.router, guide.router):
    app.include_router(r)
app.include_router(blueprint.router)  # import your own design (DXF, blueprint images)
from .routers import costar_building  # noqa: E402
app.include_router(costar_building.router)  # CoStar building facts + Matterport scope
from .routers import atlas as atlas_router  # noqa: E402
app.include_router(atlas_router.router)  # MongoDB Atlas: schema, search, vectors, geo, analytics, change streams

from .routers import costar_land  # noqa: E402
app.include_router(costar_land.router)

from .routers import intel  # noqa: E402
app.include_router(intel.router)  # CoStar intelligence tools, MCP audit timeline, deal room, Deal-to-Design

from .routers import costar_site  # noqa: E402
app.include_router(costar_site.router)  # CoStar control, occupancy, redevelopment screen, community exposure
