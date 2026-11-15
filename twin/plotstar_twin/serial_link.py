"""USB serial link to the ESP32, with auto-detect and auto-reconnect."""
from __future__ import annotations

import threading
import time
from typing import Callable, Optional

USB_HINTS = ("usbserial", "slab_usbtouart", "wchusbserial", "cp210", "ch340", "ch910",
             "ttyusb", "ttyacm", "usbmodem", "silicon labs", "uart")


def find_port() -> Optional[str]:
    from serial.tools import list_ports

    ports = list(list_ports.comports())
    for p in ports:
        text = f"{p.device} {p.description} {p.manufacturer or ''}".lower()
        if any(h in text for h in USB_HINTS) and "bluetooth" not in text:
            return p.device
    return None


class SerialLink:
    def __init__(self, port: str = "auto", baud: int = 115200,
                 on_line: Optional[Callable[[str], None]] = None):
        self.port_arg, self.baud, self.on_line = port, baud, on_line
        self.port: Optional[str] = None
        self.hello: Optional[str] = None
        self._ser = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="serial", daemon=True)

    @property
    def connected(self) -> bool:
        return self._ser is not None

    def start(self) -> "SerialLink":
        self._thread.start()
        return self

    def _open(self) -> bool:
        import serial

        port = find_port() if self.port_arg == "auto" else self.port_arg
        if not port:
            self._warn("no ESP32 found on USB (check the cable is a data cable); retrying every 2 s")
            return False
        try:
            ser = serial.Serial(port, self.baud, timeout=0.2)
        except (serial.SerialException, OSError) as exc:
            reason = "does not exist" if "No such file" in str(exc) else str(exc)
            self._warn(f"cannot open {port}: {reason}; retrying every 2 s "
                       f"(is the board/fake-esp32 running on that port? is Serial Monitor open?)")
            return False
        with self._lock:
            self._ser, self.port = ser, port
        self._warned = None
        print(f"[serial] connected to ESP32 on {port}")
        return True

    def _warn(self, msg: str) -> None:
        if getattr(self, "_warned", None) != msg:  # say it once, not every retry
            self._warned = msg
            print(f"[serial] WARNING: {msg}")

    def _run(self) -> None:
        buf = b""
        while not self._stop.is_set():
            if self._ser is None and not self._open():
                self._stop.wait(2.0)
                continue
            try:
                chunk = self._ser.read(256)
            except Exception:
                print("[serial] ESP32 disconnected; retrying")
                self._close()
                continue
            buf += chunk
            while b"\n" in buf:
                raw, buf = buf.split(b"\n", 1)
                line = raw.decode(errors="replace").strip()
                if line.startswith("HELLO"):
                    self.hello = line
                    print(f"[serial] {line}")
                elif line.startswith(("TEST", "ZERO", "PONG")):
                    print(f"[serial] {line}")
                if line and self.on_line:
                    self.on_line(line)

    def write(self, data: bytes) -> bool:
        with self._lock:
            if self._ser is None:
                return False
            try:
                self._ser.write(data)
                return True
            except Exception:
                pass
        self._close()
        return False

    def _close(self) -> None:
        with self._lock:
            if self._ser is not None:
                try:
                    self._ser.close()
                except Exception:
                    pass
            self._ser = None

    def stop(self) -> None:
        self._stop.set()
        self._close()


class NullLink:
    """No hardware attached (software-only development)."""

    connected = False
    port = None
    hello = None

    def start(self):
        return self

    def write(self, data: bytes) -> bool:
        return False

    def stop(self) -> None:
        pass
