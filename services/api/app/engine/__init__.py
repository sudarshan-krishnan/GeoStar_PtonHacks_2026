"""GeoStar's own deterministic engines. Every number the product shows comes from here or from a sponsor's data.

    layout_engine   three facility concepts per brief: geometry, money (NPV P10/P50/P90), people, planet, resources
    screening       hard gates for a site: homes, sensitive places, flood, water stress, grid proximity
    external        public data fetchers with caching: FEMA NFHL, WRI Aqueduct, OpenStreetMap (homes, substations, land)
    grid            ERCOT day-ahead prices and fuel-mix carbon
    assumptions     every stated assumption with its value, unit and basis
    optimizer       joint site + cooling + schedule optimizer for /explore
    siting, designs, cad_import, livegrid, evals   site helpers, imported designs, DXF/blueprint reading, live grid rig, checks
"""
