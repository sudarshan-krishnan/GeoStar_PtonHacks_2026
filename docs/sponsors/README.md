# Sponsors in GeoStar

Every sponsor integration lives in its own folder, on both sides of the app:

- backend: `services/api/app/sponsors/<sponsor>/`
- frontend: `src/components/sponsors/<sponsor>/`

GeoStar's own engines (layout, screening, public data, grid, optimizer) are in `services/api/app/engine/`.

| Sponsor | What it does in GeoStar | Backend | Frontend | Notes |
|---|---|---|---|---|
| **CoStar** | Real Houston and LA properties, sale comps, underwriting, tenancy, homes, redevelopment; the GeoStar CoStar **MCP server** (15 tools) | `sponsors/costar/` | `sponsors/costar/` (dossier, deal desk, existing vs proposed) | [costar.md](costar.md), [data dictionary](costar-data-dictionary.md) |
| **Matterport** (CoStar) | Site walk: pin notes in 3D and measure inside a building's scan; measurements fill the conversion check | `sponsors/matterport/` | `sponsors/matterport/site-walk.tsx` | [matterport.md](matterport.md) |
| **Vexcel** | Aerial photos under every plan and 3D model; 3D city mesh context | `sponsors/vexcel/` | `sponsors/vexcel/` | [vexcel.md](vexcel.md) |
| **LangChain** | Deep Agents orchestrator + six specialists on LangGraph, traced in LangSmith; one chat agent across the Studio; live Agent Intelligence graph | `sponsors/langchain/` | `sponsors/langchain/` | [langchain.md](langchain.md) |
| **MongoDB** | Atlas: projects, decisions, Atlas Search, Vector Search, geo, change streams, Triggers, agent memory, site walk | `sponsors/mongodb/` | `sponsors/mongodb/` (Data page) | [mongodb.md](mongodb.md) |
| **Google Gemini** | Embeddings for Atlas Vector Search; number-checked concept summaries | `sponsors/gemini/` | (server only) | [gemini.md](gemini.md) |
| **ElevenLabs** | Voice guide ("Talk to GeoStar") and text-to-speech | `sponsors/elevenlabs/` | `sponsors/elevenlabs/` | [elevenlabs.md](elevenlabs.md) |
| **Amazon (AWS)** | Bedrock as an optional model provider; container deployment notes | `sponsors/amazon/` | (none) | [amazon.md](amazon.md). Not used by the live demo |
| **ChatOverflow** | Field notes shared between coding agents while building GeoStar | (dev tool) | (none) | [chatoverflow.md](chatoverflow.md) |

The models behind the agents are Anthropic Claude (`claude-sonnet-5-5` orchestrator, `claude-haiku-5-5` specialists).

**Data rule across all sponsors:** CoStar descriptive fields (names, addresses, prices, rents, coordinates) stay on
the machine running GeoStar. They do not go into MongoDB Atlas, to Gemini, or to the agents' models or traces unless
`COPILOT_LLM_COSTAR=1`.
