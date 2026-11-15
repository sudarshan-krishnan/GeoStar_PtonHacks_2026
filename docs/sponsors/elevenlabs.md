# ElevenLabs

**Backend** `services/api/app/sponsors/elevenlabs/` · **Frontend** `src/components/sponsors/elevenlabs/`

- **Voice guide ("Talk to GeoStar"):** an ElevenLabs Agents agent configured from `guide.py` (prompt, voice, client
  tools). The browser connects with a signed URL from `routes_guide.py`. Its client tools let it read the screen, fill
  the brief, pick a site, and ask the copilot.
- **Text-to-speech:** `routes_voice.py` proxies ElevenLabs TTS. Without a key the UI uses the browser voice.
- `ELEVENLABS_API_KEY` stays server-side. The guide is billed per minute.
