"""MongoDB Atlas: the shared database. atlas.py (schema validators, Atlas Search, Vector Search, geo, analytics, change
streams), store.py (Studio projects), mongo.py (collections, agent and copilot checkpointers), triggers.py (in-app change
stream worker; real Atlas Triggers are created by scripts/atlas_triggers.py), routes.py (GET /atlas/*).
CoStar descriptive fields never go into Atlas: it keeps CoStar ids and public facts only."""
