"""Studio layout engine: geometry is consistent and the numbers follow from the brief."""
from __future__ import annotations

import math

import pytest

from app.engine import layout_engine as L

GRID = {"price": [30 + (i % 12) * 3 for i in range(24)], "carbon": [350 + (i % 6) * 20 for i in range(24)]}
SITE = {"gates": [{"gate": "Residential proximity", "status": "Pass", "value": 400},
                  {"gate": "Grid proximity", "status": "Pass", "value": 1.5}]}


def brief(**kw):
    b = dict(mw_it=20, rack_kw=20, redundancy="N+1", cooling="liquid", site_w=320, site_d=240, setback_m=8,
             expansion_pct=10, flexible_share=0)
    b.update(kw)
    return b


def run(**kw):
    return L.generate(brief(**kw), SITE, GRID, {"money": 1, "people": 1, "planet": 1, "resources": 1})


def test_three_distinct_concepts_place_every_rack():
    r = run()
    assert r["brief"]["racks"] == 1000 and r["brief"]["halls"] == 4
    assert [c["id"] for c in r["concepts"]] == ["long-halls", "service-bands", "opposed-banks"]
    for c in r["concepts"]:
        assert c["metrics"]["placed_racks"] == 1000
        assert c["metrics"]["rack_positions"] >= 1000
        assert c["feasible"], c["checks"]
    assert len({c["metrics"]["footprint_m2"] for c in r["concepts"]}) > 1
    assert sorted(c["rank"] for c in r["concepts"]) == [1, 2, 3]


def test_rooms_stay_inside_the_building_and_do_not_overlap():
    for c in run()["concepts"]:
        b = c["building"]
        rooms = c["rooms"]
        for q in rooms:
            assert q["x"] >= b["x"] - 0.05 and q["y"] >= b["y"] - 0.05
            assert q["x"] + q["w"] <= b["x"] + b["w"] + 0.05 and q["y"] + q["d"] <= b["y"] + b["d"] + 0.05
        for i, a in enumerate(rooms):
            for o in rooms[i + 1:]:
                ox = min(a["x"] + a["w"], o["x"] + o["w"]) - max(a["x"], o["x"])
                oy = min(a["y"] + a["d"], o["y"] + o["d"]) - max(a["y"], o["y"])
                assert ox <= 0.05 or oy <= 0.05, (c["id"], a["code"], o["code"])


def test_rack_rows_sit_inside_their_hall():
    for c in run()["concepts"]:
        for h in (q for q in c["rooms"] if q["type"] == "data_hall"):
            assert sum(w["n"] for w in h["rows"]) == h["racks"]
            for w in h["rows"]:
                assert w["x"] >= h["x"] and w["x"] + w["w"] <= h["x"] + h["w"] + 0.05
                assert w["y"] >= h["y"] and w["y"] + w["d"] <= h["y"] + h["d"] + 0.05


def test_money_adds_up_and_flexibility_never_costs_more():
    flat, flex = run(), run(flexible_share=0.3)
    for a, b in zip(flat["concepts"], flex["concepts"]):
        m = a["money"]
        assert m["capex"] == pytest.approx(m["shell"] + m["equipment"] + m["distribution"] + m["interconnect"], abs=3)
        assert b["money"]["energy_per_year"] < a["money"]["energy_per_year"]
        assert b["money"]["energy_per_year_flat"] == a["money"]["energy_per_year"]
    assert flex["operating"]["price_flex"] < flex["operating"]["price_flat"]


def test_redundancy_and_cooling_change_the_design():
    n, two = run(redundancy="N"), run(redundancy="2N")
    assert two["brief"]["generators"] == 2 * n["brief"]["generators"]
    assert two["concepts"][0]["money"]["capex"] > n["concepts"][0]["money"]["capex"]
    air, liquid = run(cooling="air"), run(cooling="liquid")
    assert air["concepts"][0]["resources"]["energy_mwh_per_year"] > liquid["concepts"][0]["resources"]["energy_mwh_per_year"]
    water = run(cooling="water")
    assert water["concepts"][0]["resources"]["water_m3_per_year"] > liquid["concepts"][0]["resources"]["water_m3_per_year"]
    assert any(y["type"] == "yard_water" for y in water["concepts"][0]["yard"])


def test_a_site_that_is_too_small_is_reported_not_hidden():
    r = run(mw_it=60, site_w=200, site_d=150)
    assert not any(c["feasible"] for c in r["concepts"])
    assert any(not k["ok"] for k in r["concepts"][0]["checks"])


def test_noise_follows_distance():
    near = L.generate(brief(), {"gates": [{"gate": "Residential proximity", "value": 50}]}, GRID, {})
    far = L.generate(brief(), {"gates": [{"gate": "Residential proximity", "value": 800}]}, GRID, {})
    assert near["concepts"][0]["people"]["noise_at_home_dba"] > far["concepts"][0]["people"]["noise_at_home_dba"]
    unknown = L.generate(brief(), {"gates": []}, GRID, {})
    assert unknown["concepts"][0]["people"]["noise_at_home_dba"] is None
    assert math.isfinite(unknown["concepts"][0]["people"]["noise_at_boundary_dba"])


def edited(edits):
    return L.generate(brief(), SITE, GRID, {}, None, edits)["concepts"][0]


def test_user_edits_are_measured_and_checked_like_generated_geometry():
    base = run()["concepts"][0]
    gen = next(y for y in base["yard"] if y["type"] == "yard_gen")
    # generators pushed to the site edge: louder at the boundary, and outside the setback
    moved = edited({"long-halls": {"yard": {"GEN": {"x": 320 - gen["w"] - 1, "y": gen["y"]}}}})
    assert moved["people"]["noise_at_boundary_dba"] > base["people"]["noise_at_boundary_dba"]
    assert not next(k for k in moved["checks"] if k["name"] == "Inside the setback")["ok"]
    assert not moved["feasible"]
    # building dragged onto the outdoor plant
    clash = edited({"long-halls": {"building": {"dx": 60, "dy": 0}}})
    assert not next(k for k in clash["checks"] if k["name"] == "Nothing overlaps")["ok"]
    assert clash["building"]["x"] == pytest.approx(base["building"]["x"] + 60, abs=0.01)
    assert clash["rooms"][0]["x"] == pytest.approx(base["rooms"][0]["x"] + 60, abs=0.01)
    # edits to one concept leave the others alone
    other = L.generate(brief(), SITE, GRID, {}, None, {"long-halls": {"building": {"dx": 60}}})["concepts"][1]
    assert other["building"] == run()["concepts"][1]["building"]


def test_added_battery_and_solar_change_cost_and_capacity():
    base = run()["concepts"][0]
    add = edited({"long-halls": {"added": [
        {"code": "BESS-1", "type": "yard_bess", "x": 12, "y": 12, "w": 20, "d": 10},
        {"code": "PV-1", "type": "yard_solar", "x": 12, "y": 30, "w": 30, "d": 20}]}})
    assert add["resources"]["bess_mwh"] == pytest.approx(20.0)
    assert add["planet"]["canopy_solar_kwp"] == 108 and add["planet"]["roof_solar_kwp"] == base["planet"]["roof_solar_kwp"] + 108
    assert add["money"]["added"] == 20 * 350_000 + 108 * 1400
    assert add["money"]["capex"] == pytest.approx(base["money"]["capex"] + add["money"]["added"], abs=3)
    assert {"BESS-1", "PV-1"} <= {y["code"] for y in add["yard"]}
    assert all(k["ok"] for k in add["checks"][:5])


def test_storeys_stack_the_same_plan_and_keep_every_rack():
    one, two = run()["concepts"], run(storeys=2)["concepts"]
    for a, b in zip(one, two):
        assert b["metrics"]["placed_racks"] == 1000 and b["metrics"]["storeys"] == 2
        assert b["metrics"]["footprint_m2"] < a["metrics"]["footprint_m2"] * 0.75
        assert b["metrics"]["gross_floor_m2"] == pytest.approx(2 * b["metrics"]["footprint_m2"], abs=2)
        assert {r["level"] for r in b["rooms"]} == {0, 1}
        assert len({r["code"] for r in b["rooms"]}) == len(b["rooms"])
        assert b["feasible"], b["checks"]
    odd = run(mw_it=15, storeys=2)["concepts"][0]  # 3 halls on 2 storeys: one empty bay kept for growth
    assert odd["metrics"]["placed_racks"] == 750
    assert any(r["type"] == "reserve" and r["name"] == "Expansion hall" for r in odd["rooms"])


def test_rotating_the_building_swaps_its_sides():
    a = run()["concepts"][0]
    b = edited({"long-halls": {"rotate": True}})
    assert (b["building"]["w"], b["building"]["d"]) == pytest.approx((a["building"]["d"], a["building"]["w"]), abs=0.01)
    assert b["metrics"]["placed_racks"] == 1000
    hall = next(r for r in b["rooms"] if r["type"] == "data_hall")
    assert all(w["v"] and w["x"] >= hall["x"] and w["y"] + w["d"] <= hall["y"] + hall["d"] + 0.05 for w in hall["rows"])


def test_finance_follows_rent_land_and_distance_to_power():
    base = run()["concepts"][0]["money"]
    assert base["npv_p10"] <= base["npv_p50"] <= base["npv_p90"]
    rich = run(rent_kw_month=220)["concepts"][0]["money"]
    assert rich["npv"] > base["npv"] and rich["revenue_per_year"] > base["revenue_per_year"]
    assert rich["payback_years"] is not None and (base["payback_years"] is None or rich["payback_years"] < base["payback_years"])
    landed = L.generate(brief(), {**SITE, "land_cost": 5e6, "land_label": "Sourced"}, GRID, {})
    assert landed["concepts"][0]["money"]["land"] == 5e6 and landed["site"]["land_label"] == "Sourced"
    assert landed["concepts"][0]["money"]["npv"] == pytest.approx(base["npv"] - 5e6, abs=5)
    assert run()["site"]["land_label"] == "Unknown"
    far = L.generate(brief(), {"gates": [{"gate": "Grid proximity", "value": 9.0}]}, GRID, {})["concepts"][0]["money"]
    assert far["months_to_power"] > base["months_to_power"] and far["npv"] < base["npv"]


def test_ranking_keeps_small_real_differences_small():
    r = run()
    for c in r["concepts"]:
        assert all(s >= 90 for s in c["scores"].values()), c["scores"]
    assert r["ranking"]["spread"] < 6
    assert isinstance(r["ranking"]["close"], bool) and r["ranking"]["note"]


def test_flexible_hours_weigh_carbon_as_well_as_price():
    price = [20.0] * 12 + [21.0] * 12       # first half slightly cheaper...
    carbon = [900.0] * 12 + [100.0] * 12    # ...but far dirtier
    r = L.generate(brief(flexible_share=0.3), SITE, {"price": price, "carbon": carbon}, {})
    assert r["operating"]["carbon_flex"] < r["operating"]["carbon_flat"]
    days = L.generate(brief(flexible_share=0.3), SITE, {**GRID, "days": [{"date": "a", "prices": GRID["price"]}, {"date": "b", "prices": [50.0] * 24}]}, {})
    assert days["operating"]["price_days"] == 2
    assert days["operating"]["price_flat"] == pytest.approx((sum(GRID["price"]) / 24 + 50) / 2, abs=0.01)


def test_a_noise_wall_and_other_added_items_count():
    base = run()["concepts"][0]
    gen = next(y for y in base["yard"] if y["type"] == "yard_gen")
    wall = edited({"long-halls": {"added": [{"code": "WALL-1", "type": "yard_wall", "x": gen["x"] + gen["w"] + 2, "y": gen["y"], "w": 1, "d": 40}]}})
    assert wall["people"]["noise_wall"] and wall["people"]["noise_at_boundary_dba"] == pytest.approx(base["people"]["noise_at_boundary_dba"] - 8, abs=0.11)
    assert wall["money"]["added"] == 40 * 1500
    far_wall = edited({"long-halls": {"added": [{"code": "WALL-1", "type": "yard_wall", "x": 10, "y": 10, "w": 1, "d": 40}]}})
    assert not far_wall["people"]["noise_wall"]
    tank = edited({"long-halls": {"added": [{"code": "TANK-1", "type": "yard_water", "x": 12, "y": 12, "w": 10, "d": 10}]}})
    assert tank["money"]["added"] == 100 * 1800
