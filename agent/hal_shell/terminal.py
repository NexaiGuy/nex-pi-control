"""PTY-sessies voor de terminal. Elke ingetypte regel gaat naar de audit log, behalve verborgen invoer
(wachtwoordprompts: als de terminal echo uitzet, loggen we enkel '[verborgen invoer]')."""

from __future__ import annotations

import asyncio
import codecs
import fcntl
import os
import pty
import re
import signal
import struct
import termios
from collections.abc import Awaitable, Callable

ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b.")


def clean_line(raw: str) -> str:
    out: list[str] = []
    for ch in ANSI_RE.sub("", raw):
        if ch in ("\x7f", "\b"):
            if out:
                out.pop()
        elif ch == "\x15":  # Ctrl-U
            out.clear()
        elif ch >= " " or ch == "\t":
            out.append(ch)
    return "".join(out)[:1000]


class PtySession:
    def __init__(self, cols: int, rows: int, audit: Callable[[str, str], None], shell: str = "/bin/bash") -> None:
        self.audit = audit
        self.decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        self._line = ""
        pid, fd = pty.fork()
        if pid == 0:  # kindproces
            home = os.path.expanduser("~")
            try:
                os.chdir(home)
            except OSError:
                pass
            env = {
                "TERM": "xterm-256color", "COLORTERM": "truecolor", "HOME": home, "LANG": "C.UTF-8",
                "USER": os.environ.get("USER", ""), "LOGNAME": os.environ.get("USER", ""), "SHELL": shell,
                "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "HAL_SHELL": "1",
            }
            os.execve(shell, [shell, "-l"], env)
        self.pid, self.fd = pid, fd
        self.resize(cols, rows)
        os.set_blocking(fd, False)

    def resize(self, cols: int, rows: int) -> None:
        cols = max(10, min(cols, 500))
        rows = max(5, min(rows, 200))
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

    def echo_enabled(self) -> bool:
        try:
            return bool(termios.tcgetattr(self.fd)[3] & termios.ECHO)
        except termios.error:
            return True

    def write(self, data: str) -> None:
        hidden = not self.echo_enabled()
        for ch in data:
            if ch in ("\r", "\n"):
                line = clean_line(self._line)
                if hidden:
                    self.audit("terminal:input", "[verborgen invoer]")
                elif line.strip():
                    self.audit("terminal:input", line)
                self._line = ""
            elif ch == "\x03":
                self._line = ""
            else:
                self._line += ch
                if len(self._line) > 4000:
                    self._line = self._line[-4000:]
        os.write(self.fd, data.encode("utf-8"))

    async def pump(self, send: Callable[[str], Awaitable[None]]) -> None:
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[bytes | None] = asyncio.Queue()

        def readable() -> None:
            try:
                chunk = os.read(self.fd, 65536)
            except BlockingIOError:
                return
            except OSError:
                chunk = b""
            if not chunk:
                loop.remove_reader(self.fd)
                queue.put_nowait(None)
            else:
                queue.put_nowait(chunk)

        loop.add_reader(self.fd, readable)
        try:
            while True:
                chunk = await queue.get()
                if chunk is None:
                    break
                # kleine chunks bundelen zodat de websocket niet overspoeld wordt
                while not queue.empty() and len(chunk) < 65536:
                    nxt = queue.get_nowait()
                    if nxt is None:
                        queue.put_nowait(None)
                        break
                    chunk += nxt
                text = self.decoder.decode(chunk)
                if text:
                    await send(text)
        finally:
            try:
                loop.remove_reader(self.fd)
            except Exception:
                pass

    def close(self) -> None:
        for sig in (signal.SIGHUP, signal.SIGTERM, signal.SIGKILL):
            try:
                os.killpg(os.getpgid(self.pid), sig)
            except (ProcessLookupError, PermissionError):
                break
            try:
                pid, _ = os.waitpid(self.pid, os.WNOHANG)
                if pid:
                    break
            except ChildProcessError:
                break
        try:
            os.close(self.fd)
        except OSError:
            pass
        try:
            os.waitpid(self.pid, os.WNOHANG)
        except ChildProcessError:
            pass
