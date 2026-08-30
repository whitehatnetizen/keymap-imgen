"""Read a connected Vial keyboard's own layout definition over USB.

Vial firmware carries its keyboard definition (the VIA-style JSON with a KLE drawing of
the board) compressed inside the firmware, and the Vial app reads it over the raw HID
interface: usage page 0xFF60, usage 0x61, 32-byte reports. Only read-only commands are
used here, the same ones the app sends on connection:

    FE 00          get keyboard id  -> vial protocol (u32) + uid (u64)
    FE 01          get definition size (u32)
    FE 02 <u32 n>  get 32-byte block n of the LZMA-compressed definition
    01             VIA protocol version (u16 big-endian at bytes 1-2)
    11             layer count (byte 1)
    12 <u16 off> <u8 size>   up to 28 bytes of the keymap buffer from byte 4: keycodes as
                   big-endian u16 at (layer * rows * cols + row * cols + col) * 2

Nothing is written to the keyboard. `hidapi` (python -m pip install hidapi) is optional; without it
this module explains what to install. Turning the definition's drawing into a board, and
the keymap's numbers into keycode names, is vilimg.js's work (boardFromDefinition,
decodeBuffer, namedLayers, shared with the page); keymap-imgen.py calls it through the
browser harness.
"""

import json
import lzma
import struct
from dataclasses import dataclass

USAGE_PAGE = 0xFF60
USAGE = 0x61
MSG_LEN = 32
PREFIX = 0xFE
CMD_ID, CMD_SIZE, CMD_DEF = 0x00, 0x01, 0x02
CMD_VIA_PROTOCOL, CMD_LAYER_COUNT, CMD_KEYMAP_BUFFER = 0x01, 0x11, 0x12
BUFFER_CHUNK = 28      # bytes of keymap per 32-byte report (4 bytes echo the request)

INSTALL_HINT = ("Reading a keyboard over USB needs the hidapi package:\n"
                "    python -m pip install hidapi\n"
                "On Linux also allow access to the device (a udev rule, see README).")

def _hid():
    try:
        import hid
    except ImportError:
        return None
    return hid


def _entry(d):
    return {"path": d["path"], "product": d.get("product_string") or "",
            "manufacturer": d.get("manufacturer_string") or "",
            "vid": d.get("vendor_id"), "pid": d.get("product_id")}


def _answers_vial(path):
    """True when the interface at `path` replies to Vial's id request with a sane protocol number."""
    try:
        dev = VialDevice(path)
    except Exception:
        return False
    try:
        protocol, _ = dev.keyboard_id()
        return 0 < protocol < 1000
    except Exception:
        return False
    finally:
        dev.close()


def list_devices(probe_limit=16):
    """Vial-capable HID interfaces currently connected: list of dicts with path, product, manufacturer.

    Vial's interface is the one with usage page 0xFF60 and usage 0x61. Some hidapi builds
    (older Linux packages) report 0 for both fields on every device; then the interfaces
    that report nothing are asked directly, up to `probe_limit` of them.
    """
    hid = _hid()
    if hid is None:
        raise ImportError(INSTALL_HINT)
    devices = list(hid.enumerate())
    out = [_entry(d) for d in devices if d.get("usage_page") == USAGE_PAGE and d.get("usage") == USAGE]
    if out:
        return out
    unknown = [d for d in devices if not d.get("usage_page") and not d.get("usage")]
    for d in unknown[:probe_limit]:
        if _answers_vial(d["path"]):
            out.append(_entry(d))
    return out


class VialDevice:
    def __init__(self, path):
        hid = _hid()
        if hid is None:
            raise ImportError(INSTALL_HINT)
        self.dev = hid.device()
        self.dev.open_path(path)

    def close(self):
        self.dev.close()

    def send(self, payload, retries=5):
        data = bytes([0]) + payload.ljust(MSG_LEN, b"\x00")   # report id 0 first
        for _ in range(retries):
            self.dev.write(data)
            reply = bytes(self.dev.read(MSG_LEN, 1000))
            if reply:
                return reply
        raise IOError("the keyboard did not answer; unplug and replug it, then try again")

    def keyboard_id(self):
        r = self.send(struct.pack("BB", PREFIX, CMD_ID))
        protocol = struct.unpack("<I", r[0:4])[0]
        uid = struct.unpack("<Q", r[4:12])[0]
        return protocol, uid

    def definition(self):
        r = self.send(struct.pack("BB", PREFIX, CMD_SIZE))
        size = struct.unpack("<I", r[0:4])[0]
        if size == 0 or size > 1_000_000:
            raise IOError(f"unexpected definition size {size}; is this a Vial keyboard?")
        payload = b""
        block = 0
        remaining = size
        while remaining > 0:
            r = self.send(struct.pack("<BBI", PREFIX, CMD_DEF, block))
            payload += r[:remaining] if remaining < MSG_LEN else r
            block += 1
            remaining -= MSG_LEN
        return json.loads(lzma.decompress(payload).decode("utf-8"))

    def via_protocol(self):
        r = self.send(bytes([CMD_VIA_PROTOCOL]))
        return (r[1] << 8) | r[2]

    def layer_count(self):
        r = self.send(bytes([CMD_LAYER_COUNT]))
        return r[1]

    def keymap_buffer(self, size):
        """The first `size` bytes of the keymap buffer, in chunks of up to 28 bytes."""
        data = b""
        offset = 0
        while offset < size:
            n = min(BUFFER_CHUNK, size - offset)
            r = self.send(struct.pack(">BHB", CMD_KEYMAP_BUFFER, offset, n))
            data += r[4:4 + n]
            offset += n
        return data


def read_definition(path):
    dev = VialDevice(path)
    try:
        protocol, uid = dev.keyboard_id()
        defn = dev.definition()
    finally:
        dev.close()
    return protocol, uid, defn


@dataclass
class KeymapRead:
    """A keyboard's keymap as read: its definition and the raw keycode buffer (big-endian u16
    per key, layer by layer, row by row). vilimg.js turns the buffer into keycode names once
    the board's key positions are known (decodeBuffer, then namedLayers)."""
    protocol: int       # Vial protocol version
    uid: int
    definition: dict
    via: int            # VIA protocol version
    layers: int
    rows: int
    cols: int
    raw: bytes


def read_keymap(path):
    """A KeymapRead from a connected keyboard. Encoders are not read."""
    dev = VialDevice(path)
    try:
        protocol, uid = dev.keyboard_id()
        defn = dev.definition()
        via = dev.via_protocol()
        layers = dev.layer_count()
        m = defn.get("matrix") or {}
        rows, cols = int(m.get("rows") or 0), int(m.get("cols") or 0)
        if not (0 < layers <= 32 and 0 < rows <= 64 and 0 < cols <= 64):
            raise IOError(f"unexpected keymap shape: {layers} layers, matrix {rows}x{cols}")
        raw = dev.keymap_buffer(layers * rows * cols * 2)
    finally:
        dev.close()
    return KeymapRead(protocol, uid, defn, via, layers, rows, cols, raw)


def keymap_file(uid, protocol, via, layers):
    """The dict a .vil file holds, for a keymap read over USB (the Vial app writes the same fields)."""
    return {"version": 1, "uid": uid, "layout": layers, "vial_protocol": protocol, "via_protocol": via}
