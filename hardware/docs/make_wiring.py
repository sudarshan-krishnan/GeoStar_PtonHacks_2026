"""Generates protect_wiring.svg: one Cirkit-style wiring picture for the PROTECT build.

    python hardware/docs/make_wiring.py      (then open protect_wiring.svg / .png)
"""
from pathlib import Path

W, H = 1700, 1960
OUT = Path(__file__).resolve().parent / "protect_wiring.svg"
s: list[str] = []

RED, ORANGE, BLACK = "#e53935", "#fb8c00", "#212121"
RAIL = {"5V": (72, 1384, RED), "3V3": (44, 1404, ORANGE), "GND": (100, 1364, BLACK)}       # left x, bottom y
RRAIL = {"GND": 1594, "5V": 1622, "3V3": 1650}                                            # right x


def t(x, y, txt, size=12, fill="#222", anchor="middle", weight=400, family="Helvetica, Arial, sans-serif"):
    s.append(f'<text x="{x}" y="{y}" font-size="{size}" fill="{fill}" text-anchor="{anchor}" '
             f'font-weight="{weight}" font-family="{family}" dominant-baseline="central">{txt}</text>')


def wire(pts, color, w=3.2):
    d = " ".join(f"{'M' if i == 0 else 'L'}{x},{y}" for i, (x, y) in enumerate(pts))
    s.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{w}" stroke-linejoin="round" stroke-linecap="round"/>')
    for x, y in (pts[0], pts[-1]):
        s.append(f'<circle cx="{x}" cy="{y}" r="3.6" fill="{color}"/>')


def pin(x, y):
    s.append(f'<circle cx="{x}" cy="{y}" r="5.5" fill="#d9a520" stroke="#7a5a00" stroke-width="1"/>'
             f'<circle cx="{x}" cy="{y}" r="2.2" fill="#3a2a00"/>')


def tag(x, y, txt, color):
    w = len(txt) * 7 + 10
    s.append(f'<rect x="{x - w / 2}" y="{y - 9}" width="{w}" height="18" rx="4" fill="#fff" stroke="{color}" stroke-width="1.5"/>')
    t(x, y, txt, 11, "#222", weight=700)


# ------------------------------------------------------------------ canvas
s.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">')
s.append('<defs><pattern id="g" width="20" height="20" patternUnits="userSpaceOnUse">'
         '<path d="M20 0H0V20" fill="none" stroke="#e3e6ea" stroke-width="1"/></pattern></defs>')
s.append(f'<rect width="{W}" height="{H}" fill="#f7f8fa"/><rect width="{W}" height="{H}" fill="url(#g)"/>')
t(W / 2, 30, "SiteStar data hall  -  board 1: ESP32 sensors + safety (top)   ·   board 2: UNO R4 operator console (bottom)", 22, "#333", weight=700)
t(W / 2, 56, "Every coloured line is one jumper wire. Gold dots are pins. Rails: red = 5V, orange = 3.3V, black = GND.", 13, "#555")

# ------------------------------------------------------------------ rails
for name, (x, yb, c) in RAIL.items():
    s.append(f'<line x1="{x}" y1="110" x2="{x}" y2="{yb}" stroke="{c}" stroke-width="5"/>')
    s.append(f'<line x1="{x}" y1="{yb}" x2="{RRAIL[name]}" y2="{yb}" stroke="{c}" stroke-width="5"/>')
    s.append(f'<line x1="{RRAIL[name]}" y1="110" x2="{RRAIL[name]}" y2="{yb}" stroke="{c}" stroke-width="5"/>')
    t(x, 98, name, 11, c, weight=700)
    t(RRAIL[name], 98, name, 11, c, weight=700)

# ------------------------------------------------------------------ ESP32
BX, BY, BW, BH = 740, 228, 200, 692
LX, RX = BX + 16, BX + BW - 16
LEFT = ["EN", "VP", "VN", "D34", "D35", "D32", "D33", "D25", "D26", "D27", "D14", "D12", "D13", "GND", "VIN"]
RIGHT = ["D23", "D22", "TX0", "RX0", "D21", "D19", "D18", "D5", "TX2", "RX2", "D4", "D2", "D15", "GND", "3V3"]
PY = {name: 380 + 36 * i for i, name in enumerate(LEFT)}
PYR = {name: 380 + 36 * i for i, name in enumerate(RIGHT)}
s.append(f'<rect x="{BX}" y="{BY}" width="{BW}" height="{BH}" rx="10" fill="#1f2328"/>')
s.append(f'<rect x="{BX + 46}" y="{BY + 8}" width="{BW - 92}" height="44" rx="3" fill="#fafafa"/>')
s.append(f'<path d="M{BX + 56},{BY + 44} v-26 h12 v20 h12 v-20 h12 v20 h12 v-20 h12 v20 h12 v-26" fill="none" stroke="#333" stroke-width="3"/>')
s.append(f'<rect x="{BX + 46}" y="{BY + 52}" width="{BW - 92}" height="86" rx="3" fill="#c9ccd1" stroke="#9aa0a6"/>')
t(BX + BW / 2, BY + 82, "ESPRESSIF", 13, "#333", weight=700)
t(BX + BW / 2, BY + 102, "ESP32-WROOM-32", 11, "#333")
s.append(f'<rect x="{BX + 75}" y="{BY + BH - 60}" width="50" height="34" rx="4" fill="#b0b4ba" stroke="#777"/>')
t(BX + BW / 2, BY + BH - 14, "USB", 10, "#ccc")
for name, y in PY.items():
    pin(LX, y)
    t(LX + 14, y, name, 11, "#fff", anchor="start", weight=700)
for name, y in PYR.items():
    pin(RX, y)
    t(RX - 14, y, name, 11, "#fff", anchor="end", weight=700)


# ------------------------------------------------------------------ parts
BUILT = {"OLED 0.96in (I2C)", "SG90 servo (coolant valve)", "Soil moisture = LEAK sensor", "Grove micro switch",
         "Active buzzer", "RGB LED (AI status)", "DHT11", "PIR HC-SR501"}          # tested on the real board


def part(x, y, w, title, rows, note, fill="#1565c0", side="left", art=0):
    """rows: list of (outer_pin_label, inner_pin_label). side=left => power pins on the left edge."""
    h = 34 + len(rows) * 22 + 20 + art
    s.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="7" fill="{fill}" stroke="#0d0d0d" stroke-opacity=".25"/>')
    if title in BUILT:
        s.append(f'<rect x="{x + w - 64}" y="{y - 9}" width="70" height="18" rx="9" fill="#2e7d32" stroke="#fff" stroke-width="1.5"/>')
        t(x + w - 29, y, "✓ working", 10.5, "#fff", weight=700)
    t(x + w / 2, y + 16, title, 13, "#fff", weight=700)
    pins = {}
    for i, (outer, inner) in enumerate(rows):
        py = y + 41 + i * 22
        ox, ix = (x, x + w) if side == "left" else (x + w, x)
        if outer:
            pin(ox, py)
            t(ox + (12 if side == "left" else -12), py, outer, 11, "#fff", "start" if side == "left" else "end")
            pins["o" + outer] = (ox, py)
        if inner:
            pin(ix, py)
            t(ix + (-12 if side == "left" else 12), py, inner, 11, "#fff", "end" if side == "left" else "start", 700)
            pins["i" + inner] = (ix, py)
    t(x + w / 2, y + h - 12 - art, note, 10.5, "#e8eef7")
    return pins, (x, y, w, h)


def power(p, rail, side):
    x, y = p
    if rail == "VIN":   # servos: red wire straight to the ESP32's VIN pin (USB 5V), not to a rail
        tx = x - 30 if side == "left" else x + 30
        wire([(x, y), (tx, y)], RED, 2.6)
        tag(tx + (-4 if side == "left" else 4), y, "VIN", RED)
        return
    c = RAIL[rail][2]
    tx = RAIL[rail][0] if side == "left" else RRAIL[rail]
    wire([(x, y), (tx, y)], c, 2.6)


def signal(esp_side, esp_pin, p, lane, color, label):
    ex, ey = (LX, PY[esp_pin]) if esp_side == "L" else (RX, PYR[esp_pin])
    px, py = p
    wire([(ex, ey), (lane, ey), (lane, py), (px, py)], color)
    tag((lane + px) / 2, py, label, color)


LPX, LPW = 150, 240
# Left column: power pins face the left rails, signal pins face the ESP32.
# (title, rows, note, fill, [(inner_pin_label, esp_pin, colour)])
L = [
    ("Photoresistor + 10k", [("3V3", "OUT"), ("GND", None)], "SMOKE receiver · LDR to 3V3 · 10k to GND", "#1565c0", [("OUT", "VN", "#ff8a65")]),
    ("Soil moisture = LEAK sensor", [("3V3", "SIG"), ("GND", None)], "liquid-cooling leak · Grove yellow=SIG", "#0277bd", [("SIG", "D35", "#1e88e5")]),
    ("Grove micro switch", [("3V3", "SIG"), ("GND", None)], "valve arm presses it when SHUT", "#00695c", [("SIG", "D32", "#43a047")]),
    ("DHT11", [("3V3", "S"), ("GND", None)], "hot-aisle temperature + humidity", "#1565c0", [("S", "D26", "#2e7d32")]),
    ("PIR HC-SR501", [("VIN", "OUT"), ("GND", None)], "people in the data hall · middle pin = OUT", "#2e7d32", [("OUT", "D27", "#00838f")]),
    ("L293D + DC motor (cooling fan)", [("VIN", "EN"), ("GND", None)], "pins 2,8,16→VIN · 4,5,7,12,13→GND · 3,6→motor", "#263238", [("EN", "D14", "#6d4c41")]),
]
sigs = []
y = 130
for title, rows, note, fill, conns in L:
    pins, (_, _, _, h) = part(LPX, y, LPW, title, rows, note, fill)
    for k, (px, py) in pins.items():
        if k.startswith("o"):
            power((px, py), k[1:], "left")
    for inner, esp, color in conns:
        sigs.append((esp, pins["i" + inner], color))
    y += h + 20
# Lanes: wires going UP take lanes nearest the board (top pin first); wires going DOWN take the
# next lanes out (bottom pin nearest). This staircase keeps every left wire from crossing another.
up = sorted([x for x in sigs if x[1][1] <= PY[x[0]]], key=lambda x: PY[x[0]])
down = sorted([x for x in sigs if x[1][1] > PY[x[0]]], key=lambda x: -PY[x[0]])
for i, (esp, pt, color) in enumerate(up):
    signal("L", esp, pt, 735 - 11 * i, color, esp)
for i, (esp, pt, color) in enumerate(down):
    signal("L", esp, pt, 735 - 11 * len(up) - 22 - 11 * i, color, esp)
# RFID MISO lives on this side of the board: a short stub + tag (the reader is drawn on the right)
wire([(LX, PY["D13"]), (690, PY["D13"])], "#8e24aa")
tag(655, PY["D13"], "D13 → RFID MISO", "#8e24aa")

RPX, RPW = 1300, 250
R = [
    ("SG90 servo (coolant valve)", [("VIN", "SIG"), ("GND", None)], "red → ESP32 VIN · brown GND · orange SIG", "#37474f", 0),
    ("OLED 0.96in (I2C)", [("3V3", "SCL"), ("GND", "SDA")], "3.3V only", "#2e7d32", 0),
    ("Smoke beam LED", [("GND", "ANODE")], "green LED + 220Ω · aim at photoresistor", "#1565c0", 0),
    ("RC522 RFID (manager approval)", [("3V3", "SCK"), ("GND", "SDA"), ("RST", "MOSI"), (None, "MISO")], "3.3V ONLY · RST → 3.3V · IRQ unused", "#0d47a1", 0),
    ("Active buzzer", [("GND", "+")], "long leg = +", "#212121", 0),
    ("RGB LED (AI status)", [(None, "B"), ("GND", "G"), (None, "R")], "220Ω on each colour · longest leg = GND", "#455a64", 0),
]
RSIG = {
    "SG90 servo (coolant valve)": [("SIG", "D23", 950, "#5d4037")],
    "OLED 0.96in (I2C)": [("SCL", "D22", 960, "#00897b"), ("SDA", "D21", 970, "#00acc1")],
    "Smoke beam LED": [("ANODE", "D19", 980, "#7cb342")],
    "RC522 RFID (manager approval)": [("SCK", "D18", 995, "#fb8c00"), ("SDA", "D5", 1005, "#1e88e5"), ("MOSI", "TX2", 1015, "#43a047")],
    "Active buzzer": [("+", "RX2", 1075, "#6a1b9a")],
    "RGB LED (AI status)": [("R", "D15", 1030, "#e53935"), ("G", "D2", 1045, "#43a047"), ("B", "D4", 1060, "#1e88e5")],
}
ytops = [150, 280, 410, 506, 712, 812]
for (title, rows, note, fill, art), y in zip(R, ytops):
    pins, (x0, y0, w0, h0) = part(RPX, y, RPW, title, rows, note, fill, side="right", art=art)
    for k, (px, py) in pins.items():
        if k.startswith("o"):
            power((px, py), "3V3" if k[1:] == "RST" else k[1:], "right")
    for inner, esp, lane, color in RSIG[title]:
        signal("R", esp, pins["i" + inner], lane, color, esp)
    if "MISO" in "".join(pins):
        mx, my = pins["iMISO"]
        wire([(mx, my), (mx - 40, my)], "#8e24aa")
        tag(mx - 92, my, "→ ESP32 D13", "#8e24aa")

# ------------------------------------------------------------------ ESP32 power + power module
wire([(LX, PY["VIN"]), (722, PY["VIN"])], RED)
tag(712, PY["VIN"], "VIN", RED)
wire([(LX, PY["GND"]), (700, PY["GND"]), (700, 1364)], BLACK)
tag(700, 1000, "ESP32 GND", BLACK)
wire([(RX, PYR["3V3"]), (952, PYR["3V3"]), (952, 1404)], ORANGE)
tag(952, 960, "ESP32 3V3", ORANGE)

s.append('<rect x="760" y="960" width="150" height="80" rx="6" fill="#263238"/>')
t(835, 980, "Power module", 12, "#fff", weight=700)
t(835, 998, "5V side: jumper 5V · other: OFF", 9.5, "#cfd8dc")
t(1055, 1056, "Optional: only if the USB", 10.5, "#37474f")
t(1055, 1071, "power is not enough.", 10.5, "#37474f")
pin(800, 1040); pin(870, 1040)
t(800, 1026, "5V", 10, "#fff"); t(870, 1026, "GND", 10, "#fff")
wire([(800, 1040), (800, 1384)], RED)
wire([(870, 1040), (870, 1364)], BLACK)
s.append('<rect x="1000" y="985" width="110" height="52" rx="6" fill="#37474f"/>'
         '<rect x="1110" y="998" width="10" height="26" fill="#9e9e9e"/>')
t(1055, 1011, "9V battery", 12, "#fff", weight=700)
wire([(1000, 1011), (930, 1011), (930, 1000), (910, 1000)], "#9e9e9e", 2.6)
t(835, 1060, "", 1)

t(W / 2, 1436, "VIN = USB 5V for the servo, PIR and fan.  Never join the battery 5V rail to VIN.  Leak sensor dry + beam clear at power-up.", 13, "#b71c1c", weight=700)

# ------------------------------------------------------------------ board 2: operator console
s.append('<rect x="40" y="1466" width="1620" height="470" rx="12" fill="#eef3f6" stroke="#90a4ae" stroke-dasharray="8 6"/>')
t(W / 2, 1490, "Board 2: operator console  -  UNO R4 WiFi + 4-digit display + keypad.  Its own USB cable.  NOT wired to the ESP32 or the rails.", 14, "#37474f", weight=700)
# UNO R4 in the middle
s.append('<rect x="740" y="1515" width="220" height="400" rx="10" fill="#00878f"/>')
t(850, 1533, "Arduino UNO R4 WiFi", 13, "#fff", weight=700)
s.append('<rect x="790" y="1700" width="120" height="78" rx="4" fill="#111"/>')
for gy in range(8):
    for gx in range(12):
        s.append(f'<circle cx="{797 + gx * 9.6:.1f}" cy="{1707 + gy * 9.2:.1f}" r="2.4" fill="{"#ff5a4f" if gx in (5, 6) or gy == 3 else "#3a1d1b"}"/>')
t(850, 1792, "LED matrix (status)", 10, "#e0f2f1")
# 4-digit display on the left
DISP = [("A", "top 2nd", "D2", 1), ("B", "top 6th", "D3", 1), ("C", "bottom 4th", "D4", 1), ("D", "bottom 2nd", "D5", 1),
        ("E", "bottom 1st", "D6", 1), ("F", "top 3rd", "D7", 1), ("G", "bottom 5th", "D8", 1),
        ("DIG1", "top 1st", "A0", 0), ("DIG2", "top 4th", "A1", 0), ("DIG3", "top 5th", "A2", 0), ("DIG4", "bottom 6th", "A3", 0),
        ("dot", "bottom 3rd", None, 0)]
s.append('<rect x="150" y="1515" width="250" height="400" rx="8" fill="#263238"/>')
t(275, 1533, "5641AS 4-digit display", 13, "#fff", weight=700)
t(275, 1550, "dots at the BOTTOM · pin 1 = bottom-left", 10, "#cfd8dc")
s.append('<rect x="175" y="1560" width="200" height="40" rx="3" fill="#111"/>')
t(275, 1581, "8.8.8.8.", 26, "#ff5a4f", weight=700, family="Menlo, monospace")
SEGC = ["#e53935", "#fb8c00", "#fdd835", "#43a047", "#00acc1", "#1e88e5", "#8e24aa", "#212121", "#455a64", "#6d4c41", "#00695c"]
for i, (name, where, r4, res) in enumerate(DISP):
    yy = 1620 + i * 24
    pin(400, yy)
    t(388, yy, f"{name}  ({where})", 10.5, "#fff", "end", 700)
    if r4:
        c = SEGC[i]
        wire([(400, yy), (740, yy)], c)
        pin(740, yy); t(752, yy, r4, 11, "#fff", "start", 700)
        if res:
            s.append(f'<rect x="520" y="{yy - 6}" width="34" height="12" rx="2" fill="#d7b98e" stroke="#8d6e63"/>')
            t(537, yy, "220", 8.5, "#3e2723", weight=700)
        tag(640, yy, r4, c)
    else:
        t(430, yy, "(leave empty)", 10.5, "#78909c", "start")
t(275, 1903, "7 × 220Ω on segment wires · digits direct", 10.5, "#cfd8dc")
# keypad on the right
KP = [("1", "row 1", "D10"), ("2", "row 2", "D11"), ("3", "row 3", "D12"), ("4", "row 4", "D13"),
      ("5", "col 1", "D9"), ("6", "col 2", "A4"), ("7", "col 3", "A5"), ("8", "col 4", "D0")]
s.append('<rect x="1300" y="1515" width="250" height="400" rx="8" fill="#37474f"/>')
t(1425, 1533, "4×4 membrane keypad", 13, "#fff", weight=700)
t(1425, 1550, "ribbon at the bottom · pins left → right", 10, "#cfd8dc")
for r, row in enumerate(["123A", "456B", "789C", "*0#D"]):
    for c, ch in enumerate(row):
        s.append(f'<rect x="{1370 + c * 30}" y="{1562 + r * 22}" width="26" height="19" rx="3" fill="#eceff1"/>')
        t(1383 + c * 30, 1572 + r * 22, ch, 11, "#263238", weight=700)
KPC = ["#e53935", "#fb8c00", "#fdd835", "#43a047", "#00acc1", "#1e88e5", "#8e24aa", "#6d4c41"]
for i, (pn, what, r4) in enumerate(KP):
    yy = 1680 + i * 26
    pin(1300, yy); t(1312, yy, f"pin {pn}  ({what})", 10.5, "#fff", "start", 700)
    wire([(960, yy), (1300, yy)], KPC[i])
    pin(960, yy); t(948, yy, r4, 11, "#fff", "end", 700)
    tag(1130, yy, r4, KPC[i])
t(1425, 1900, "A = grid event · B = end · 40# = cut 40%", 10.5, "#cfd8dc")
s.append("</svg>")
OUT.write_text("\n".join(s))
print(f"wrote {OUT}")
