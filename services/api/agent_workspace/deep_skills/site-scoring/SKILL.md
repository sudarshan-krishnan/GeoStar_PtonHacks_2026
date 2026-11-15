---
name: site-scoring
description: How GeoStar scores a site for a data center from specialist evidence, and how to act on gaps and conflicts. Read before a site evaluation.
---
# Site scoring

The score is computed by `compute_site_score`, never by you. It reads the evidence the specialists' tools recorded.

| Pillar | Weight | Criteria (evidence tool) |
|---|---|---|
| Property | 20% | land for the target capacity (`get_property_intelligence` or `underwrite_acquisition`), diligence completeness (`identify_data_gaps`) |
| Money | 30% | NPV P50 ÷ investment, payback, months to power (`development_economics` or `underwrite_acquisition`) |
| Power and resources | 25% | substation distance, water stress, flood (`screen_site`) |
| People and planet | 25% | nearest home, generator noise at homes (`analyze_residential_impact` or `community_impact`), sensitive places (`screen_site`) |

- A criterion with no evidence is a gap: its weight moves to the criteria that have evidence and coverage drops.
- Coverage under 60% gives "Insufficient evidence". A failed hard gate gives "Not suitable" at any score.
- `conflicts` lists a specialist whose conclusion disagrees with its own evidence. Re-delegate once to that specialist
  with the specific question, then call `compute_site_score` again.
- To close a gap, delegate the named tool to the specialist that owns it. Do not close a gap by guessing.
