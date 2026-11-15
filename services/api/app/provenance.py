"""Field -> evidence mapping for parcel attributes (PRD V-3, U6).

For any parcel field shown in the UI, `chain()` returns where it came from: dataset, file, line, JSON path,
formula (if derived), load timestamp and label. Fields that are NULL come back labeled Unknown.
"""
from __future__ import annotations

from typing import Any

from .costar.loader import LISTING_FILE, PROPERTY_FILE, SALE_FILE
from .labels import Label


def _prop(path: str, formula: str | None = None) -> tuple[str, str, str, str | None]:
    return ("source_row", PROPERTY_FILE, path, formula)


# field -> (row column holding the source line, source file, json path, formula or None)
FIELD_SOURCES: dict[str, tuple[str, str, str, str | None]] = {
    "name": _prop("buildingName"),
    "address": _prop("primaryAddress.streetNumber + streetName + streetType"),
    "lat": _prop("primaryAddress.latitude"),
    "lon": _prop("primaryAddress.longitude"),
    "market": _prop("primaryAddress.researchMarketId", "14 = Houston, 20 = Los Angeles"),
    "property_type": _prop("propertyType", "decoded with schemas/enums.json PropertyType"),
    "property_subtype": _prop("propertySubtype", "decoded with schemas/enums.json PropertySubtype"),
    "building_class": _prop("buildingClass"),
    "year_built": _prop("constructionEvents[eventType=2].year", "latest ConstructionComplete year"),
    "building_sf": _prop("grossBuildingAreaSquareFeet"),
    "lot_acres": _prop("lotSize + lotSizeMeasurementType", "acres as given; square feet / 43,560"),
    "zoning": _prop("zoningDescription", "raw text as recorded by CoStar"),
    "has_heavy_power": _prop("propertyIndustrial|propertyFlex.electric.hasHeavyPower", "CoStar: ampsHigh >= 800"),
    "amps_high": _prop("propertyIndustrial|propertyFlex.electric.ampsHigh"),
    "volts_high": _prop("propertyIndustrial|propertyFlex.electric.voltsHigh"),
    "ceiling_height_ft": _prop("propertyIndustrial|propertyFlex.structural.ceilingHeightFeet"),
    "availability": ("asking_source_row", LISTING_FILE, "listingStatus=Active; forSaleSummary / forLeaseSummary",
                     "derived from active listings on this property"),
    "asking_price_low": ("asking_source_row", LISTING_FILE, "forSaleSummary.askingPriceLow",
                         "asking price, not a transacted price"),
    "asking_price_high": ("asking_source_row", LISTING_FILE, "forSaleSummary.askingPriceHigh",
                          "asking price, not a transacted price"),
    "last_sale_price": ("last_sale_source_row", SALE_FILE,
                        "soldForPrice (single sale) | entities[].allocatedPrice (portfolio sale)",
                        "most recent priced sale that includes this property; always read with last_sale_status"),
}


def chain(parcel: dict[str, Any], field: str) -> dict[str, Any]:
    if field not in FIELD_SOURCES:
        raise KeyError(field)
    row_col, src_file, path, formula = FIELD_SOURCES[field]
    value = parcel.get(field)
    extra = None
    if field == "last_sale_price":
        extra = {
            "last_sale_status": parcel.get("last_sale_status"),
            "last_sale_date": parcel.get("last_sale_date"),
            "is_portfolio": bool(parcel.get("last_sale_is_portfolio")),
        }
    return {
        "parcel_id": parcel["parcel_id"],
        "field": field,
        "value": value,
        "label": (Label.SOURCED if value is not None else Label.UNKNOWN).value,
        "source": "CoStar Data Extract (HackPrinceton 2026 kit)",
        "source_file": src_file,
        "source_row": parcel.get(row_col),
        "json_path": path,
        "formula": formula,
        "loaded_at": parcel["loaded_at"],
        "extra": extra,
    }


def labels_for(parcel: dict[str, Any]) -> dict[str, str]:
    return {f: (Label.SOURCED if parcel.get(f) is not None else Label.UNKNOWN).value for f in FIELD_SOURCES}
