# Matterport

**Backend** `services/api/app/sponsors/matterport/sitewalk.py` · **Frontend** `src/components/sponsors/matterport/site-walk.tsx`

**Site walk.** Open it from a CoStar building that has a scan ("Site walk: pin notes and measure"):

- **Pin a note:** hold the pointer on a spot in the scan. A short countdown freezes that 3D point, and the note
  (power, cooling, structure, access, fire, water) is pinned there as a Matterport tag. Notes come back as pins the next
  time anyone opens the scan.
- **Measure:** this uses Matterport's own measuring tool. Say what you measured (clear height, column spacing, delivery
  door, corridor). The conversion check then uses that value as **Measured**, where CoStar records nothing (column grid,
  door sizes) or replaces CoStar's clear height.
- The Property and Resource agents read the site walk (`site_walk_observations`).

How it works:

- It uses the Matterport Showcase SDK, with the key in `NEXT_PUBLIC_MATTERPORT_SDK_KEY`. The key must allow the page's
  domain. Without it the plain viewer still plays, and notes save without a 3D position.
- Notes and measurements are stored in MongoDB Atlas (`site_walk`), with a local file as fallback. They are the
  team's own observations, not CoStar data.
- Scan metadata (floors, rooms, scanned area, whole building vs suite) comes from the Matterport GraphQL API, in
  `sponsors/costar/building.py` and `routers/integrations.py`.
