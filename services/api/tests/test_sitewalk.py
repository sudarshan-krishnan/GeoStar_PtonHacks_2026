"""Site walk: notes and measurements made inside a Matterport scan feed the conversion check as Measured values."""
from __future__ import annotations

import pytest

from app.sponsors.matterport import sitewalk


@pytest.fixture()
def local_store(tmp_path, monkeypatch):
    monkeypatch.setattr(sitewalk, "_coll", lambda: None)
    monkeypatch.setattr(sitewalk, "_LOCAL", tmp_path / "site_walk.json")
    return tmp_path


def test_notes_and_measurements_round_trip(local_store):
    n = sitewalk.add_note("costar:1", "M1", "structure", "blocker", " Cracked slab by dock 3 ", {"x": 1, "y": 0, "z": 2}, None, 0, "Ishita")
    m = sitewalk.add_measurement("costar:1", "M1", "column_spacing", 7.42, None, [], 0, None, "Matterport measurement tool")
    s = sitewalk.summary("costar:1")
    assert n["stored"] == "this computer" and s["notes"][0]["text"] == "Cracked slab by dock 3"
    assert s["counts"] == {"notes": 1, "measurements": 1, "blockers": 1, "by_category": {"structure": 1}}
    assert s["derived"]["column_spacing"]["value_m"] == 7.42 and s["derived"]["column_spacing"]["need_m"] == 9.0
    assert sitewalk.delete("costar:1", m["id"]) and not sitewalk.summary("costar:1")["measurements"]
    assert sitewalk.summary("costar:2")["notes"] == []


def test_the_smallest_measurement_binds(local_store):
    for v in (6.1, 5.4, 7.0):
        sitewalk.add_measurement("costar:1", None, "clear_height", v, None, [], None, None, "test")
    d = sitewalk.summary("costar:1")["derived"]["clear_height"]
    assert d["value_m"] == 5.4 and d["count"] == 3


def test_bad_input_is_refused(local_store):
    with pytest.raises(ValueError):
        sitewalk.add_note("costar:1", None, "plumbing!", "concern", "x", None, None, None, None)
    with pytest.raises(ValueError):
        sitewalk.add_measurement("costar:1", None, "clear_height", 0.0, None, [], None, None, "test")
    with pytest.raises(ValueError):
        sitewalk.add_measurement("costar:1", None, "volume", 3.0, None, [], None, None, "test")
