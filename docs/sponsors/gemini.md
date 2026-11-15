# Google Gemini

**Backend** `services/api/app/sponsors/gemini/client.py`

- `embed()` uses `gemini-embedding-001` at 768 dimensions. It embeds each site's public facts and each project for
  **MongoDB Atlas Vector Search**: plain-language site search (`/atlas/similar`) and similar projects. It is paced for
  the free tier (8 per batch, with backoff), and falls back to a labelled local hashing embedder.
- `generate()` uses `GEMINI_MODEL` (default `gemini-3.5-flash-lite`) to write the Studio's three-sentence concept
  summary (`POST /studio/explain`). It only sees numbers the layout engine computed. A draft containing any number that
  was not computed is discarded and the built-in text is used.
- `GEMINI_API_KEY` stays server-side. Gemini never receives CoStar descriptive fields.
