# Vexcel

**Backend** `services/api/app/sponsors/vexcel/routes.py` · **Frontend** `src/components/sponsors/vexcel/`

- `GET /vexcel/ortho/{parcel}.jpg?buffer_m=` serves the orthophoto cut around a parcel. It sits under the 2D plan and
  the 3D model in the Studio and is the hero image on the landing page. `.../meta` gives the capture date and resolution.
- `GET /vexcel/3d/root`, `/3d/site.json` and `/3d/{endpoint}` proxy the 3D city mesh tileset, so the Studio can show
  the real surroundings. Coverage is limited, and a 404 means no mesh at that point.
- The API key stays server-side. Responses are cached on disk.
