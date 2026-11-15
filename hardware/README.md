# PlotStar Live Digital Twin: hardware

A laptop runs a real AI training job and measures its own power. PlotStar schedules that job
against a real ERCOT day (Nov 12, 2026, replayed in 60 s). An ESP32 miniature grid on the table
shows the grid and the decision, and the knobs on it change the decision live.

```
 laptop (python twin)  ── USB ──  ESP32 ── wind turbine (fan)      ← ERCOT wind
  • AI workers (1 always-on       │        solar LEDs (5 yellow)   ← ERCOT solar
    + 3 flexible)                 │        gas LEDs (3 red)        ← ERCOT gas
  • power meter (powermetrics)    │        carbon needle (servo)   ← gCO2/kWh
  • LP scheduler (HiGHS)          │        24 h clock (stepper)    ← replay time
  • API + status page :8790       │        BACKUP DIESEL sign (relay)
                                  │        OLED: decision + live watts
                                  └ knobs: flex dial, joystick, keypad A-D, emergency button, thermistor
```

Everything below uses **only the kit**. Nothing to buy except 2 or 3 spare 9V batteries.

---

## 1. Parts used

| Part | Job |
|---|---|
| ESP32 DevKit (WROOM-32) | the controller |
| 0.96" OLED (SSD1306, I2C) | decision + live watts |
| SG90 servo | carbon needle, 0–700 gCO₂/kWh |
| 28BYJ-48 stepper + ULN2003 board | 24-hour clock hand |
| 3–6 V DC motor + fan blade + L293D | wind turbine |
| 5 yellow LEDs + PN2222 #1 | solar |
| 3 red LEDs | gas |
| 5 V relay + PN2222 #2 + diode + 5 white LEDs | BACKUP DIESEL sign |
| Active buzzer | diesel alarm, key clicks |
| 10k potentiometer | flexibility dial: 0 / 0.25 / 0.5 / 1 % |
| Joystick | up/down = carbon price, left = water cooling, right = air cooling |
| 4×4 membrane keypad | A/B/C = site, D = swap which plan runs on the real chip |
| Push button | GRID EMERGENCY |
| Thermistor (10k NTC) + 10k resistor | laptop exhaust temperature |
| Power supply module + 9V battery | 5 V rail for the motors, relay, LEDs |
| 2 × 400-tie breadboards | side by side, ESP32 bridging the gap |
| Resistors | 220 Ω × 13, 1 kΩ × 2, 10 kΩ × 1 |

Not used, on purpose: RC522, IMU, ultrasonic, PIR, tilt switch, photoresistors, DHT11, IR parts,
74HC595, 7-segment displays, passive buzzer. Using them would add parts without making the story
stronger.

---

## 2. Power: read this first

* **Two supplies, one ground.** The ESP32 runs from the laptop USB cable. The power module (on the
  9V battery) makes the **5 V rail** for the servo, stepper, motor, relay and LEDs.
* Set **both** jumpers on the power module to **5 V**.
* Run a jumper from **ESP32 GND to the power-module GND rail**. Without it, nothing works reliably.
* **Never** connect the 5 V rail to the ESP32's 5V/VIN pin while USB is plugged in.
* **3.3 V devices (OLED, potentiometer, joystick, thermistor) take 3V3 from the ESP32**, not from the
  5 V rail. 5 V on an ESP32 input pin can kill it.
* A 9V battery lasts about 1–2 hours here. Put a fresh one in right before judging. The firmware
  already saves power: stepper coils switch off between moves and the servo stops pulsing once it settles.
* If anyone has a 9–12 V barrel-jack wall adapter, plug it into the power module instead of the battery.

---

## 3. Wiring (pin by pin)

### ESP32 pin map

| ESP32 pin | Goes to | Notes |
|---|---|---|
| 3V3 | 3.3 V rail (OLED VCC, pot end, joystick +5V pin, 10k top) | |
| GND | GND rail **and** power-module GND | common ground |
| GPIO 21 | OLED SDA | |
| GPIO 22 | OLED SCL | |
| GPIO 16, 17, 18, 19 | ULN2003 IN1, IN2, IN3, IN4 | |
| GPIO 23 | servo signal (orange) | |
| GPIO 25 | L293D pin 1 (EN1,2) | PWM speed |
| GPIO 26 | 1 kΩ → PN2222 #1 base | solar LEDs |
| GPIO 27 | 3 red LEDs, each with its own 220 Ω | gas |
| GPIO 13 | 1 kΩ → PN2222 #2 base | relay |
| GPIO 33 | active buzzer + (long leg) | − leg to GND |
| GPIO 15 | emergency button | other leg to GND (internal pull-up) |
| GPIO 34 | potentiometer middle pin | ends: 3V3 and GND |
| GPIO 35 | thermistor/10k junction | |
| GPIO 36 (VP) | joystick VRy | |
| GPIO 39 (VN) | joystick VRx | joystick SW unused |
| GPIO 4, 5, 14, 12 | keypad pins 1, 2, 3, 4 (rows) | |
| GPIO 32 | keypad pin 8 (column with A B C D) | internal pull-up |
| GPIO 2 | on-board LED | heartbeat |

### Circuits

**Solar (PN2222 #1, flat face toward you: E B C left to right)**
`5V → 220Ω → yellow LED (long leg first) → collector` (×5 in parallel, each LED with its own 220Ω)
`emitter → GND`, `base ← 1kΩ ← GPIO 26`

**Gas**
`GPIO 27 → 220Ω → red LED → GND` (×3 in parallel, each with its own 220Ω)

**BACKUP DIESEL sign (PN2222 #2 + relay)**
`5V → relay coil → collector`, `emitter → GND`, `base ← 1kΩ ← GPIO 13`
Diode **across the coil**: stripe (cathode) to the 5V side. This protects the transistor.
Relay contacts: `COM → 5V`, `NO → 5 white LEDs` (each `220Ω → LED → GND`).
Put the white LEDs behind a paper sign that says BACKUP DIESEL.

**Wind turbine (L293D, notch at top, pin 1 top-left)**

| L293D pin | Connect |
|---|---|
| 1 EN1,2 | GPIO 25 |
| 2 IN1 | 5V (tied high) |
| 3 OUT1 | motor lead 1 |
| 4, 5, 12, 13 | GND |
| 6 OUT2 | motor lead 2 |
| 7 IN2 | GND |
| 8 VCC2 (motor) | 5V |
| 16 VCC1 (logic) | 5V |

If the fan spins backwards, swap the two motor leads.

**Clock (ULN2003 board)**: IN1–IN4 ← GPIO 16–19, `+` → 5V, `−` → GND, plug in the stepper.
Glue a paper hand on the shaft. Point it at 00:00 **before** powering on (or send `ZERO`).

**Carbon needle (SG90)**: brown → GND, red → 5V, orange → GPIO 23. Glue a paper needle on and
mount it over a printed 0–700 gCO₂/kWh dial (low = left/green, high = right/red). If it moves the wrong
way, set `SERVO_REVERSE = true` at the top of the firmware.

**Thermistor**: `3V3 → 10kΩ → junction → thermistor → GND`, junction → GPIO 35. Tape the
thermistor at the laptop's exhaust vent. If it is not connected, the OLED says so and nothing breaks.

**Keypad**: hold it face up with the ribbon at the bottom. The ribbon pins are 1–8 left to right:
pins 1–4 = rows, 5–8 = columns. Only pins 1, 2, 3, 4 and 8 are used. If keys come out wrong, run
`monitor` (below) and press A, B, C, D. If nothing registers, your keypad's numbering runs the other
way: wire ribbon positions 8, 7, 6, 5 to GPIO 4, 5, 14, 12 and position 1 to GPIO 32.

### Breadboard layout
Put the two breadboards side by side. The ESP32 bridges the gap: left pin row in board 1, right
pin row in board 2. Each pin then has 4 free holes. Plug the power module into the top rails of
board 2. Build the L293D, the two transistors and the LEDs in the free rows below the ESP32.

---

## 4. Flash the ESP32

Arduino IDE 2:
1. Boards Manager → install **esp32 by Espressif** (2.x or 3.x both work).
2. Library Manager → install **Adafruit SSD1306** (say yes to **Adafruit GFX**).
3. Open `hardware/firmware/esp32_grid/esp32_grid.ino`, board **ESP32 Dev Module**, pick the port, Upload.
   If upload hangs at "Connecting...", hold the **BOOT** button until it starts.

Or with arduino-cli:

```bash
arduino-cli compile --fqbn esp32:esp32:esp32 hardware/firmware/esp32_grid
```

```bash
arduino-cli upload --fqbn esp32:esp32:esp32 -p /dev/cu.usbserial-0001 hardware/firmware/esp32_grid
```

(Verified: compiles on esp32 core 3.3.12, using 27% of flash.)

With no laptop software running, the OLED shows **OFFLINE** plus live knob readings. That's
the fastest wiring check. **Hold the emergency button while powering on** to run the self-test:
needle sweep, solar fade, gas fade, turbine and relay with a beep, clock quarter-turn.

---

## 5. Run the laptop side

```bash
cd PlotStar && python3 -m venv .venv && .venv/bin/pip install -r twin/requirements.txt
```

The real ERCOT day is already cached in `twin/data/ercot_2026-11-12.csv`. To fetch another day:

```bash
.venv/bin/python twin/scripts/fetch_ercot_day.py 2026-11-12
```

**One command checks everything** (Python packages, data, Arduino core and libraries, power meter, port,
and, if the board is plugged in, that the firmware is talking and the knobs read sensibly):

```bash
.venv/bin/python twin/run.py doctor
```

**No board yet? Use the fake ESP32.** It opens a virtual serial port and speaks exactly the firmware's
protocol. It draws the OLED, turbine, solar, gas, needle, clock and diesel sign as text, and the keyboard acts
as the knobs (0–3 flex dial, i/k carbon price, j/l water/air, a/b/c site, p swap plan, e emergency, q quit).

```bash
.venv/bin/python twin/run.py fake-esp32
```

Then in a second terminal, using the port it prints:

```bash
.venv/bin/python twin/run.py run --serial /dev/ttys012
```

`tests/test_serial_e2e.py` runs the same path automatically.

Check the hardware (close the Arduino Serial Monitor first, because only one program can hold the port):

```bash
.venv/bin/python twin/run.py monitor
```

```bash
.venv/bin/python twin/run.py selftest
```

Run the demo. On a Mac, unlock sudo **in the same terminal** first so the twin can read real chip power:

```bash
sudo -v
```

```bash
.venv/bin/python twin/run.py run
```

The first 25 seconds are **calibration**: it measures idle, then 1, 2, 3 and 4 workers. Keep the laptop
idle and close other apps. Then open http://127.0.0.1:8790/ for the status page.

**Right before judging, calibrate fresh:** laptop plugged in, other apps closed, and no `--skip-calibration`.
A laptop's power at the same workload drifts as it heats up (tested Nov 13: the live meter was 3% off the
model at first, then 30–56% off an hour later). Each replayed day prints `live meter vs model X%`, and the twin
warns you once the gap passes 15%. The PlotStar vs cost-first headline numbers stay apples to apples either way.

Useful flags:

| Flag | Use |
|---|---|
| `--skip-calibration` | reuse the last calibration (faster restart) |
| `--serial none` | no ESP32 (software team) |
| `--fake-load --serial none` | no CPU load at all, for UI work |
| `--day-seconds 90` | slower replay |
| `--meter estimate` | if powermetrics/sudo fails (screen says EST, so say so) |

Tests: `cd twin && ../.venv/bin/python -m pytest -q` (21 tests, including the serial end-to-end ones).

### API for the dashboard team
* `GET /api/twin/state`: the full live snapshot
* `GET /api/twin/day`: the 24 h ERCOT data + both plans
* `POST /api/twin/control`: `{"site":"B","cooling":"air","flex_pct":0.5,"carbon_price":80,"physical_plan":"plotstar","emergency":true}`
* `WS /ws/twin`: the snapshot 5×/s

---

## 6. What the knobs do

| Control | Effect |
|---|---|
| Flex dial (pot) | flexibility offered to the grid: 0 / 0.25 / 0.5 / 1 % of yearly hours. This sets the LP's curtailment budget, assuming the yearly hours are spent over ~10 stress days. |
| Joystick up/down (hold) | carbon price $0–200/t. The LP moves work away from dirty hours. |
| Joystick left / right (flick) | water cooling (PUE 1.15, uses water) / air cooling (PUE 1.40, no water) |
| Keypad A / B / C | site. The OLED and status page show the grid, water and homes pass/fail. |
| Keypad D | swap which plan runs on the real chip (PlotStar ↔ cost-first) |
| Red button | **grid emergency** for 3 replay hours. With flex > 0 the AI load drops to 1 worker. With flex 0 (or the cost-first plan) the BACKUP DIESEL sign lights and the buzzer sounds. |

## 7. The 20-second hardware moment in the demo
1. Dial at **0 %**. Press the red button → **BACKUP DIESEL** lights, buzzer, OLED `!! DIESEL BACKUP ON`.
2. Turn the dial to **0.5 %**. Press again → workers drop 4 → 1, watts on the OLED fall in real time,
   sign stays dark, OLED `GRID CALL: CURTAILED`.
3. Line to say: *"Same data center, same day of the Texas grid. Offering half a percent of flexibility means
   no diesel generators next to homes, and that's real power from a real chip, not a slide."*

## 8. Honest labels (say these if asked)
* Watts are **measured** by the laptop chip's own energy counter. The twin scales them to a 300 MW facility.
* The replay is time-compressed: each replayed hour holds the measured power for that hour.
* The plan not running on the chip is computed from the per-worker power measured during calibration.
* Emission factors are approximate (coal 1000, gas 440 gCO₂/kWh). Site values in `twin/config/sites.json`
  are **placeholders** until the software team fills them from CoStar / Aqueduct / OSM.

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| OLED blank | SDA/SCL swapped? VCC on 3V3? Some modules use address 0x3D (the firmware tries both). |
| Servo jitters or ESP32 resets when it moves | missing common GND, or a weak 9V battery |
| Fan doesn't spin at low wind | normal: Nov 12 wind was low in the afternoon. Self-test spins it at full. |
| Clock hand drifts | point it at 00 and send `ZERO` (or restart with the hand at 00) |
| Joystick drifts | don't touch it while the ESP32 boots (it learns its centre then) |
| `ESP32 not found` | use a data USB cable; close Serial Monitor; on Mac install the CP210x/CH340 driver if needed |
| `[power] ... sudo needs a password` | run `sudo -v` in that same terminal, then start again |
| Upload fails | hold BOOT during "Connecting..."; GPIO 12 must not be pulled high (don't press keypad D while flashing) |
