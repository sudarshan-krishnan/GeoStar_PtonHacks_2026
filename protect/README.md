# SiteStar PROTECT

**Find It. Design It. Protect It.** This is the third module. DESIGN's floor plan decides where
sensors go. A model dorm on the table runs real sensors. An AI incident commander
(LangChain **Deep Agents** on **Claude via Amazon Bedrock**) investigates, writes the dossier,
plans the repair, and asks the building manager for approval **over iMessage (Photon)**.

```
 DESIGN building.json ──► sensor planner (where sensors go, and why)
                              │
 ESP32 model dorm ──USB──► detector ──► reflexes (instant, deterministic)
   leak probe + valve          │            └─► "ALERT" text in < 1 s
   smoke beam, DHT11,          ▼
   pipe temp, PIR, sump     Deep Agent incident commander (Claude on Bedrock)
                              ├─ diagnostician sub-agent   (history + topology → cause)
                              ├─ maintenance-planner       (vendor + work order)
                              ├─ filesystem: /incidents/<id>/report.md, work_order.md
                              └─ human-in-the-loop: dispatch / reopen valve ──► iMessage YES/NO
```

**Safety design (say this to judges):** the AI is never in the safety loop. Water on the probe
closes the valve **in firmware within ~50 ms**, with no laptop and no AI involved. A hardware
interlock refuses to reopen while the probe is wet, whoever asks. The AI does the judgment work:
it works out cause and risk across rooms, the repair plan, and who to call. A human approves
anything that costs money or re-pressurises a pipe.

## Run it

```bash
.venv/bin/pip install -r protect/requirements.txt
```

No hardware (fake board, controls on the dashboard):

```bash
.venv/bin/python protect/run.py run --sim
```

Real ESP32 (auto-detects the port):

```bash
.venv/bin/python protect/run.py run
```

Dashboard: http://127.0.0.1:8796/. Fake board in its own terminal:
`.venv/bin/python protect/run.py fake-board`. Sensor plan: `.venv/bin/python protect/run.py plan`.

Tests: `cd protect && ../.venv/bin/python -m pytest -q` (13 tests). One of them drives the real
Deep Agents graph through tool calls, the dossier write, and the approval pause and resume.

### AI model
| Credentials found | Model used |
|---|---|
| AWS credentials (`aws configure` or env vars) | Claude on **Amazon Bedrock**, `BEDROCK_MODEL_ID` (default `anthropic.claude-opus-5-5`; confirm the ID in your Bedrock console), `AWS_REGION` (default us-east-1) |
| `ANTHROPIC_API_KEY` | Claude API, `claude-opus-5-5` |
| none, or a model error mid-demo | **Offline playbook**: same dossier, work order, texts and approvals, labelled OFFLINE |

Force one with `--llm bedrock|anthropic|offline`.

### iMessage (Photon track)
1. Create a project at https://app.photon.codes, add an iMessage line, and copy the project ID and secret.
2. Start the bridge:

```bash
cd protect/photon-bridge && npm install && SPECTRUM_PROJECT_ID=... SPECTRUM_PROJECT_SECRET=... npm start
```

3. Text the agent's number "hi" from the manager's phone, or set `MANAGER_PHONE=+1...`.
4. Run PROTECT as usual. Alerts, updates and approvals arrive as iMessages, and a reply of "YES",
   "NO" or a question ("what happened?") goes straight back to the agent.
   If the bridge is down, the dashboard phone panel works the same way.

## Wiring (final data-hall build)

**The picture is the source of truth: [hardware/docs/protect_wiring.png](../hardware/docs/protect_wiring.png)**
(regenerate with `python hardware/docs/make_wiring.py`).

**Board 1, ESP32 (sensors and safety).** Runs from USB. Servo, PIR and the fan's L293D take 5 V from
the ESP32 **VIN** pin (USB power); the servo and fan ramp slowly so USB never drops. 3.3 V sensors run
from the **3V3** pin. Flash `hardware/firmware/esp32_building/esp32_building.ino`.

| ESP32 pin | Part | Notes |
|---|---|---|
| 35 | soil moisture sensor SIG (liquid-cooling leak) | Grove: yellow SIG, red VCC (3.3 V), black GND; dry at power-up |
| 32 | Grove micro switch SIG | the valve arm presses it when the valve is shut ("valve stuck" check) |
| 23 | SG90 servo (coolant valve) | red to VIN, brown GND |
| 26 | DHT11 S | hot-aisle temperature + humidity, on 3.3 V |
| 27 | PIR OUT (middle pin) | VCC to VIN; people in the data hall |
| 14 | L293D pin 1 (EN) | pins 2, 8, 16 to VIN; 4, 5, 12, 13 GND; 7 GND; 3 and 6 to the motor (cooling fan) |
| 18 / 5 / TX2 (17) / 13 | RC522 SCK / SDA / MOSI / MISO | **3.3 V only**; RST to 3.3 V; manager card tap = approval |
| 34 / 33 / 25 | joystick VRx / VRy / SW | on 3.3 V; push = change the grid cut live, press = silence alarm |
| 22 / 21 | OLED SCL / SDA | 3.3 V |
| RX2 (16) | active buzzer + | |
| 15 / 2 / 4 | RGB LED R / G / B (220 Ω each, common cathode to GND) | AI status: purple thinking, yellow needs you, green done |
| 19 / VN | smoke beam LED / photoresistor | **paused** (`HAS_SMOKE_BEAM = false` until the wiring is fixed) |

**Board 2, UNO R4 WiFi (operator console).** Its own USB cable. Flash
`hardware/firmware/r4_console/r4_console.ino`, then **press the R4's RESET button once**: after an
upload from arduino-cli it often does not start until reset.

| R4 pins | Part |
|---|---|
| D2-D8 | 5641AS display segments A-G (direct) |
| A0-A3 | display digits 1-4, each through 220-470 Ω (display legs in breadboard rows 25-30, dots on the a-e side) |
| D10, D11, D12, D13, D9, A4, A5, D0 | 4x4 keypad pins 1-8 (A = grid event, B = end, digits + # = cut %) |
| built-in LED matrix | live power graph, fan at real speed, tap-card / rain / fire / bolt animations |

Run the live system: `.venv/bin/python protect/run.py run --lobby auto --haven http://127.0.0.1:3000
--haven-facility portfolio-riverside-compute`, and for 1-second power readings, in your own terminal:
`sudo .venv/bin/python protect/run.py power-feed`.

## Things a judge can do at the table
| Do this | What happens |
|---|---|
| Drip water on the paper towel | valve snaps shut in ~50 ms, bathroom LED red, lounge LED amber (it's below), iMessage alert, AI investigates, plumber approval on your phone |
| Hold a hand or paper in the smoke beam | strobe + alarm, **fan forced OFF** (smoke spread), lounge + corridor red, evacuation note if the PIR sees someone |
| Breathe on the DHT11 | humidity spike → fan 60%, AI checks for steam or a slow leak |
| Pinch the DHT11 | overheat → fan 100% |
| Ice cube on the pipe thermistor | freeze-risk warning → plumbing work order |
| Text "what happened?" | the agent answers from the incident thread |

## 3-minute demo (PROTECT is the last 60 seconds)
1. *(DISCOVER, 60 s)* "200-bed dorm near Rice": the agent ranks Houston parcels from CoStar.
2. *(DESIGN, 50 s)* pick a parcel: the Vexcel footprint becomes the massing and floor plan.
3. *(PROTECT, 60 s)* "Here's that building." The sensor plan comes from the floor plan. A judge drips
   water: the valve shuts **before the AI even starts**, the phone buzzes, and the AI says the lounge
   below is occupied. The judge's phone gets "Approve plumber, $185?" They reply YES and it's dispatched.
4. *(10 s)* "From idea, to land, to design, to a building that protects itself."
