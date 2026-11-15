"""Matterport: the site walk (sitewalk.py, routes in sponsors/costar/routes_building.py) stores notes pinned in 3D and
measurements drawn inside a CoStar building's scan; measured values feed the conversion check. Scan metadata (floors,
rooms, scanned area) is read through the Matterport GraphQL API in sponsors/costar/building.py and routers/integrations.py.
The browser side is src/components/sponsors/matterport/."""
