# CoStar Data Extract: data dictionary and intake findings

Source: HackPrinceton 2026 CoStar track kit (`costar-hackathon-kit.zip`), extracted **outside the repo** to the
folder named by `COSTAR_KIT_DIR` in `.env`. The kit is licensed sponsor data: never commit it, its extracts, or the
SQLite cache (`data/cache/` is gitignored). Loader: `services/api/app/sponsors/costar/loader.py`.

## What the kit actually contains

The kit covers properties and homes on **CoStar's Matterport 3D capture list** in two research markets:
Houston (`researchMarketId` 14) and Los Angeles (20). It is a list of scanned buildings, not a land-for-sale
inventory. That shapes the product (see "Gaps" below).

| File | Records | Used in GeoStar |
|---|---|---|
| `data/commercial-property.jsonl` | 3,339 | **Yes.** Parcel master: location, type, lot size, building, electric service, zoning text, photo |
| `data/commercial-listing-summary.jsonl` | 1,022 | **Yes.** Active for-sale asking prices and lease availability |
| `data/commercial-sale-comp.jsonl` | 6,120 | **Yes.** Most recent priced sale per property, with price status |
| `commercial-properties.csv` | 13,147 rows | **Yes.** PropertyId → Matterport model ids (S-7 3D tours) |
| `data/location-occupancy.jsonl` | 74,093 | Not yet. Tenancies; possible signal for vacancy and availability |
| `data/company-detail.jsonl` | 49,575 | Not yet. Tenant companies |
| `data/apartment-listing.jsonl` | 1,747 | No. Multifamily rents |
| `data/residential-listings*.jsonl` | 2,120 / 1,899 | Possibly Phase 2: home locations as a residential-proximity input |
| `schemas/enums.json` | n/a | Decodes every integer enum |

## Coverage of data-center site candidates

Site candidates = `propertyType` in {Industrial, Flex, Land}. Numbers from the loaded store (`GET /data/summary`).

| Market | All properties | Candidates | Industrial / Flex / Land | Asking price | Last sale price | Heavy power | Matterport scan |
|---|---|---|---|---|---|---|---|
| Houston | 1,758 | 121 | 98 / 21 / 2 | 4 | 34 | 28 | 113 |
| Los Angeles | 1,581 | 37 | 24 / 10 / 3 | 7 | 29 | 8 | 34 |

Houston candidates: 35 have lots ≥ 5 acres, 10 have lots ≥ 10 acres (largest: Presidents Park 4, 50 acres,
3,000 A heavy power). 67 have a zoning text value. 59 have an active listing (sale or lease).

**Answer to PRD open decision #1:** Houston *is* covered, with use-type indicators and electric-service fields.
**Price coverage is thin:** only 4 Houston candidates carry an asking price and 34 a historical sale price.
Most are existing industrial buildings with lots of 1 to 50 acres, which suits a 5 to 30 MW footprint per site better than
a 100 MW greenfield campus. Per PRD principle 5 ("report what the data shows"), the demo should either
(a) present the study as a portfolio of smaller industrial sites / phased build, or (b) treat land cost as an explicit
evidence gap where unpriced. Do not impute prices.

## Normalized parcel schema (`parcels` table)

Every row traces to `source_file` + `source_row` (1-based line in the JSONL). Price fields carry the line of the
listing or sale comp that supplied them. NULL = not in the data → shown as **Unknown**.

| Column | From | Notes / label |
|---|---|---|
| `parcel_id` | `"costar:" + id` | Stable key used by the API and audit trail |
| `source_file`, `source_row`, `loaded_at` | loader | Provenance |
| `name`, `building_park` | `buildingName`, `buildingPark` | Sourced |
| `address`, `city`, `state`, `postcode` | `primaryAddress.*` | Sourced |
| `lat`, `lon` | `primaryAddress.latitude/longitude` | Sourced; point location, no parcel polygon in the extract |
| `market`, `submarket_id`, `county_id` | `researchMarketId`, `primarySubmarketId`, `countyId` | Sourced |
| `property_type`, `property_subtype` | `propertyType`, `propertySubtype` decoded via `enums.json` | Sourced |
| `building_class`, `construction_status`, `year_built`, `stories`, `building_sf` | type fields; year = latest `constructionEvents[eventType=2]` | Sourced |
| `lot_acres` | `lotSize` + `lotSizeMeasurementType` (2 = acres, 1 = sq ft ÷ 43,560) | Sourced; unknown unit is never guessed |
| `zoning` | `zoningDescription`, raw text | Sourced. Houston has no citywide zoning; values like "None" or "N/A" are recorded text, not missing data |
| `has_heavy_power` | `propertyIndustrial/Flex.electric.hasHeavyPower` | CoStar definition: ampsHigh ≥ 800. Tri-state 1 / 0 / NULL |
| `amps_low/high`, `volts_low/high` | `electric.*` | Building service, **not** grid interconnection capacity |
| `ceiling_height_ft`, `has_rail` | `structural.ceilingHeightFeet`, `railAccess` | Sourced |
| `leed_certified` | `environmental.leedCertifications` non-empty | Sourced |
| `availability` | Active listings (`listingStatus = 1`) on the property | For sale / For lease / For sale and lease / Not listed |
| `asking_price_low/high`, `asking_listing_id`, `asking_source_row`, `asking_listed_date` | `forSaleSummary.askingPriceLow/High`, `minDateOnMarket` | Asking, not transacted. USD only (non-USD prices dropped) |
| `last_sale_price`, `last_sale_status`, `last_sale_date`, `last_sale_comp_id`, `last_sale_is_portfolio`, `last_sale_source_row` | Most recent priced comp containing the property | Single sale: `soldForPrice`. Portfolio: entity `allocatedPrice` only (never the portfolio total). Always shown with `salePriceStatus` |
| `photo_url` | `primaryPhoto.attachmentUri` | CoStar CDN; `/112/` can be swapped for other sizes |
| `matterport_count` | `commercial-properties.csv` | Model ids in table `matterport_models` |
| `dc_candidate` | `property_type in {Industrial, Flex, Land}` | Team rule; adjustable |

## Gaps (become evidence gaps, not invented values)

- No parcel polygons, only points. Distance-to-homes will be point-based (label Estimated).
- No assessed land value. Land cost = asking price, else last sale (with status and date), else Unknown.
- No flood, water-stress or substation data in the kit. These come from FEMA/WRI Aqueduct/OSM in Phase 2.
- Electric amps/volts describe building service, not available grid capacity.
- Texas is a non-disclosure state; sale prices may be estimated. Carry `last_sale_status`.

## Sponsor APIs: status at intake (2026-11-14)

| API | Status |
|---|---|
| Matterport GraphQL (`https://api.matterport.com/api/models/graph`, basic auth key:token) | **Working.** e.g. model `oNAvrNiXZS7` → "Northwest Trade Center – 9750 Tanner Rd", public. Proxied by `GET /matterport/models/{id}`; token never reaches the browser |
| Matterport SDK | Key set; domain allowlist is `localhost` only. Add the deployed domain before using it from AWS |
| Vexcel API v2 (`https://api.vexcelgroup.com/v2`, `x-api-key` header) | **Working.** `/ortho/extract` (7 cm orthophoto by point + buffer, XMP carries capture date and collection) proxied at `GET /vexcel/ortho/{parcel}.jpg`; `/3d/tileset` photogrammetric city mesh (3D Tiles, collection `us-tx-houstonr2-2023`, inner-loop Houston only) proxied and pruned at `GET /vexcel/3d/root`. Key stays server-side |
