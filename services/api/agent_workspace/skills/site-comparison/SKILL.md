---
name: site-comparison
description: Compare two or more candidate properties side by side for a data center and say which is preferable and why.
---
# Site comparison

1. Call `site_detail` for each property (ids like `costar:123`). If the user gave names, find ids with `search_sites`.
2. Build a table: screen result, failed gate (if any), acres, acquisition (with its label), substation distance,
   homes within 1 mile.
3. If an optimizer run exists, call `get_run` and add each site's plan cost when present.
4. A site that fails a gate loses regardless of price. Otherwise prefer the lower 10-year cost.
5. End with one sentence on what a utility must confirm.
