"""Put a Tello EDU on a normal Wi-Fi network ("station mode"), then find it.

By default the Tello runs its own Wi-Fi hotspot, so the laptop running the
bridge loses internet while connected to it. A Tello EDU can instead join an
existing 2.4 GHz WPA2-Personal network (a phone hotspot or travel router), so
the laptop, the drone, the ESP32 and the internet all share one network.

1. Join the drone's TELLO-XXXXXX Wi-Fi, then run:
       python bridge/tello_wifi.py MyRouterSSID
   You are prompted for the password. The drone reboots onto that network.
2. Put the laptop back on MyRouterSSID and find the drone's new IP:
       python bridge/tello_wifi.py --find
3. Start the bridge with it:
       python bridge/server.py --tello-ip <ip>

One-shot on macOS (switches the Mac's Wi-Fi for you, then back):
    python bridge/tello_wifi.py MyRouterSSID --tello-ssid TELLO-ABC123 --switch-wifi
The password comes from --password-file, $HOTSPOT_PASSWORD, or a prompt.

To return the drone to hotspot mode, hold its power button for about 5 s
until the lights flash (factory Wi-Fi reset).

Limits: SSID and password cannot contain spaces. Enterprise networks with a
login (eduroam, venue captive portals) will not work. Networks with client
isolation block the laptop from reaching the drone; use your own hotspot.
"""

import argparse
import getpass
import ipaddress
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

TELLO_IP = "192.168.10.1"
TELLO_PORT = 8889


def send(sock, ip, cmd):
    sock.sendto(cmd.encode(), (ip, TELLO_PORT))


def join(ssid: str, password: str) -> int:
    if " " in ssid or " " in password:
        print("The Tello cannot use an SSID or password containing spaces.")
        print("iPhone hotspot: rename the phone in Settings > General > About > Name "
              "(e.g. SiteStarHotspot) and pick a password without spaces.")
        return 1
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.settimeout(5)
        try:
            send(sock, TELLO_IP, "command")
            reply = sock.recv(1024).decode(errors="replace").strip()
            if reply != "ok":
                print(f"Drone answered '{reply}' to 'command'; is this a Tello EDU?")
                return 1
            send(sock, TELLO_IP, f"ap {ssid} {password}")
            reply = sock.recv(1024).decode(errors="replace").strip()
        except socket.timeout:
            print(f"No reply from {TELLO_IP}. Is this laptop on the drone's TELLO-XXXXXX Wi-Fi?")
            return 1
    print(f"Drone replied: {reply}")
    print(f"It will reboot onto '{ssid}'. Reconnect this laptop to '{ssid}', then run:")
    print("    python bridge/tello_wifi.py --find")
    return 0


def local_subnet() -> ipaddress.IPv4Network:
    # Connecting a UDP socket sends nothing; it only picks the outgoing interface.
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
    return ipaddress.ip_network(f"{ip}/24", strict=False)


def find(subnet: str | None) -> int:
    net = ipaddress.ip_network(subnet, strict=False) if subnet else local_subnet()
    if net.num_addresses > 1024:
        print(f"{net} is too large to scan; pass a /24 with --subnet.")
        return 1
    print(f"Looking for Tello drones on {net}…")
    found = []
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        # Talk from port 8889, the same port the bridge (djitellopy) uses. The Tello
        # can lock onto the first address:port that sends 'command', and a random
        # port here would make it ignore the bridge until it reboots.
        try:
            sock.bind(("", TELLO_PORT))
        except OSError:
            print(f"Port {TELLO_PORT} is busy; stop bridge/server.py before scanning.")
            return 1
        for host in net.hosts():
            try:
                send(sock, str(host), "command")
            except OSError:
                # e.g. the real subnet is smaller than /24 (iPhone hotspots are /28)
                # and this address is its broadcast address
                pass
        sock.settimeout(0.3)
        deadline = time.time() + 3
        while time.time() < deadline:
            try:
                data, (ip, _) = sock.recvfrom(1024)
            except socket.timeout:
                continue
            if data.decode(errors="replace").strip() == "ok" and ip not in found:
                found.append(ip)
                print(f"  Tello at {ip}  →  python bridge/server.py --tello-ip {ip}")
    if not found:
        print("None found. Check the drone finished rebooting, the laptop is on the same "
              "network, and the network has no client isolation.")
        return 1
    return 0


def wifi_device() -> str:
    out = subprocess.run(["networksetup", "-listallhardwareports"],
                         capture_output=True, text=True, check=True).stdout.splitlines()
    for i, line in enumerate(out):
        if line.strip() == "Hardware Port: Wi-Fi":
            return out[i + 1].split(":", 1)[1].strip()
    raise RuntimeError("no Wi-Fi interface found")


def current_ip(dev: str) -> str:
    return subprocess.run(["ipconfig", "getifaddr", dev], capture_output=True, text=True).stdout.strip()


def join_mac_wifi(dev: str, ssid: str, password: str | None, want_prefix: str | None, timeout=40) -> bool:
    """Point the Mac's Wi-Fi at ssid and wait for an address (optionally with a given prefix)."""
    cmd = ["networksetup", "-setairportnetwork", dev, ssid] + ([password] if password else [])
    out = subprocess.run(cmd, capture_output=True, text=True)
    msg = (out.stdout + out.stderr).strip()
    if msg:
        print(f"  networksetup: {msg}")
    deadline = time.time() + timeout
    while time.time() < deadline:
        ip = current_ip(dev)
        if ip and (want_prefix is None or ip.startswith(want_prefix)) and \
                (want_prefix is not None or not ip.startswith("192.168.10.")):
            print(f"  Mac on '{ssid}' as {ip}")
            return True
        time.sleep(1)
    print(f"  Mac did not get an address on '{ssid}' within {timeout}s")
    return False


def switch_and_join(ssid: str, password: str, tello_ssid: str) -> int:
    """Mac: join drone -> send 'ap' -> rejoin hotspot -> find the drone. Always ends on the hotspot."""
    dev = wifi_device()
    rc = 1
    try:
        print(f"1/3 Joining the drone's Wi-Fi '{tello_ssid}'…")
        if not join_mac_wifi(dev, tello_ssid, None, "192.168.10."):
            return 1
        time.sleep(1)
        print(f"2/3 Sending '{ssid}' to the drone…")
        rc = join(ssid, password)
    finally:
        print(f"3/3 Returning the Mac to '{ssid}'…")
        back = join_mac_wifi(dev, ssid, password, None)
    if rc != 0 or not back:
        return 1
    print("Waiting for the drone to reboot onto the hotspot…")
    for attempt in range(6):
        time.sleep(10)
        if find(None) == 0:
            return 0
        print(f"  not yet (attempt {attempt + 1}/6)")
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Tello EDU station-mode helper")
    parser.add_argument("ssid", nargs="?", help="router or hotspot to join (2.4 GHz, WPA2-Personal)")
    parser.add_argument("--find", action="store_true", help="scan the local network for the drone")
    parser.add_argument("--subnet", help="network to scan, e.g. 172.20.10.0/24 (default: this laptop's /24)")
    parser.add_argument("--switch-wifi", action="store_true",
                        help="macOS: switch this Mac to the drone's Wi-Fi and back automatically")
    parser.add_argument("--tello-ssid", help="the drone's own network name, e.g. TELLO-ABC123")
    parser.add_argument("--password-file", help="file containing the hotspot password (first line)")
    args = parser.parse_args()

    if args.find:
        return find(args.subnet)
    if not args.ssid:
        parser.print_help()
        return 1
    if args.password_file:
        password = Path(args.password_file).expanduser().read_text().splitlines()[0].strip()
    else:
        password = os.environ.get("HOTSPOT_PASSWORD") or getpass.getpass(f"Password for '{args.ssid}': ")
    if args.switch_wifi:
        if not args.tello_ssid:
            parser.error("--switch-wifi needs --tello-ssid TELLO-XXXXXX")
        return switch_and_join(args.ssid, password, args.tello_ssid)
    return join(args.ssid, password)


if __name__ == "__main__":
    sys.exit(main())
