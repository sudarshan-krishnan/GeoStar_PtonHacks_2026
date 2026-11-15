# PlotStar for iPhone

A native SwiftUI app with two tabs.

**Sites:** HAVEN incident response away from the laptop.
- Every deployed site, with the ones that need attention first.
- The phone buzzes when a new incident appears.
- Each site opens its incident command:
  - status and severity
  - the response plan, which a person approves before staff guidance is shared
  - incidents to acknowledge
  - Level 4 exit routes on a live floor plan
  - readings, team progress, the simulated emergency call, building systems and the activity log

**Drone:**
- **Fly:** live video from the Tello, battery, height and temperature. Take off and land, move in 30 cm steps, turn 45°, capture frames, and an emergency motor cut you press and hold.
- **RoboMaster TT expansion kit (optional):** with the dot matrix and distance-sensing module attached, the bridge finds it on connect.
  - Forward moves stop 50 cm short of anything the forward distance sensor sees. The app shows the distance ahead.
  - The 8×8 display shows people near the drone what it's doing: a 3-2-1 countdown before take-off, arrows while moving (sideways arrows as seen from in front), a red X when it stops, and a flash on capture. The app shows a live copy.
  - Without the kit, everything works as before.
- **LiDAR scan:** scans a room with the iPhone's own LiDAR (Apple RoomPlan) into a 3D model. It measures ceiling (clear) height, floor area, walls, doors and windows. The Tello has a camera, not LiDAR; scanning uses a Pro iPhone.
- **Wi-Fi survey (during a LiDAR scan):**
  - Every 1.5 s the phone times a tiny request and a 256 KB download to the PlotStar server, over Wi-Fi only.
  - It places each reading where the phone is in the room, and buzzes with "Wi-Fi dead spot here" as you walk.
  - The 3D viewer shows the room with each reading as a marker and a coverage disc on the floor, with rings on dead spots. You can orbit it and AirDrop the model.
  - The thresholds: dead means nothing got through, or under 1 Mbps or over 500 ms; weak means under 8 Mbps or over 150 ms.
  - The phone must be on the building's Wi-Fi, not your hotspot, and able to reach the server: the deployed website, or the laptop on that Wi-Fi with `MOBILE_ALLOW` set to it.

Setup (models, protections, placement, deploy) stays in Dashboard 2 on the laptop. HAVEN data is simulation mode, labeled as such.

## How it connects

```
iPhone ──▶ scripts/mobile-gateway.mjs (port 3100) ──▶ web app (127.0.0.1:3000) ──▶ drone bridge (127.0.0.1:8010) ──▶ Tello
```

- The web app stays on `127.0.0.1` as designed.
- The gateway forwards only the phone routes, and only with the `MOBILE_API_KEY` bearer token. Those routes also check the token themselves.
  - Site routes: `/api/mobile/facilities[/<id>]`
  - Drone routes: `/api/mobile/drone/…`, which wraps the dashboard's existing drone proxy
- The gateway only accepts this Mac and an iPhone hotspot's network (`172.20.10.x`); `MOBILE_ALLOW` changes that.
- The phone can send incident-response commands only: acknowledge, approve plan, team update, simulated call, the demo triggers, reset, and complete recovery. Setup commands get a 403.

## Run it

1. **Laptop services.** In the repo root, start them once and they stay running. They start at login, restart if they stop, and pause while the Mac sleeps:
   ```bash
   TELLO_IP=172.20.10.14 npm run mobile:service install   # web app + gateway + drone bridge
   npm run mobile:service status                          # running? logs in ~/Library/Logs/PlotStar/
   npm run mobile:service restart                         # after pulling new code
   npm run mobile:service uninstall
   ```
   - `TELLO_IP` is the drone's address in station mode on your hotspot. Leave it out for the drone's own Wi-Fi.
   - The bridge needs `bridge/requirements.txt`. Set `DRONE_PYTHON` to a Python that has it (default: `bridge/.venv`, then `python3`). If none does, the bridge is skipped and the rest still runs.
   - Without the services: run `npm run dev`, `npm run mobile:gateway` and `python bridge/server.py --tello-ip …` by hand. The services and `npm run dev` both use port 3000, so run one or the other.
2. **Network.** Join the Mac to your iPhone's hotspot. Turn the Tello on in station mode so it joins the same hotspot.
3. **Xcode.** Open `mobile/PlotStar.xcodeproj` (Xcode 26 or later; tested with Xcode 27).
   - **Simulator:** pick an iPhone and press Run. LiDAR scanning shows as unavailable there.
   - **Your iPhone:**
     1. Select it as the run destination.
     2. Under *PlotStar target → Signing & Capabilities*, choose your Apple ID as the Team.
     3. Press Run.
     4. On the phone, trust the developer under *Settings → General → VPN & Device Management*.
     5. Allow *Local Network* and *Camera* access when asked.
   - A free Apple account allows 3 sideloaded apps per phone, and the app expires after 7 days. Run it from Xcode again to renew.
4. **Pair.** Run `npm run mobile:pair` and scan the QR code with the iPhone Camera. Or type the address and access code on the first screen.

In the simulator there's no camera. Type the address (`http://127.0.0.1:3100`) and code, or launch a debug build with a link:

```bash
SIMCTL_CHILD_PLOTSTAR_OPEN='plotstar://connect?url=http%3A%2F%2F127.0.0.1%3A3100&token=<code>' \
  xcrun simctl launch booted dev.plotstar.mobile
```

Other links:
- `plotstar://drone` opens the Drone tab.
- `plotstar://facility/<id>?section=plan|incidents|floor|readings|team|call|systems|activity` opens a site at a section.

## Using the deployed website

The phone routes are part of the web app, so a deployment serves them directly over HTTPS, without the gateway.

1. Set `MOBILE_API_KEY` in the deployment's environment. Use the value from your `.env`, or a separate key that you pass when pairing.
2. On the laptop, run:
   ```bash
   npm run mobile:pair -- --url https://your-deployment.example --role data
   ```
3. Scan the QR code.

Sites and incidents then come from the website. A website can't reach a drone, so the laptop stays the drone link. Scanning a laptop QR code while connected to the website only updates the drone link. *Connections* (the link button) shows both links.

## Demo

1. Open the app on the *Sites* list.
2. On the laptop, trigger a fire in the Dashboard 2 command center.
3. Within about 2 seconds the phone buzzes and a banner slides in.
4. Tap the banner, approve the response plan, and acknowledge the incident. The laptop shows the same state: both read and write the same revision-checked HAVEN record.
5. Switch to *Drone*:
   1. Take off.
   2. Fly a short pass and capture a frame.
   3. Land.
6. Then do a LiDAR scan of the room to show its ceiling height.

## Limits

- Alerts arrive while the app is open: it polls every 1.5–2 s. Lock-screen push would need Apple Push Notification service and a paid developer account.
- HAVEN data is simulation only: no sensors, alarms, doors or emergency services are connected, and the routes are demo routes on a representative model.
- The bridge keeps a hovering Tello from auto-landing and does not land it if the phone disconnects. Land before closing the app.
- RoomPlan is built for rooms up to about 9 m (30 ft) across. Its measurements are estimates.
- LiDAR scanning and the Wi-Fi survey haven't been run on a device yet: RoomPlan can't run in the simulator. The 3D viewer was checked with a synthetic scan.
- iOS doesn't let apps read Wi-Fi signal strength, so the survey measures response time and speed instead. The map is for placing wireless sensors (like HAVEN's DataBot), the drone link and staff areas. Data halls run on wired fiber, so it doesn't rate a spot for servers.
- The expansion kit's distance sensor only looks forward and has a short range. Sideways, up and back moves aren't guarded. The kit code is tested against the simulated drone only.
