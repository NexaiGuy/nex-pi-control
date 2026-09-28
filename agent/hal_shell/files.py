"""Bestandsbeheer binnen toegelaten mappen (shell-roots.yml). Geen symlink-ontsnappingen, geen root-bewerkingen."""

from __future__ import annotations

import os
import re
import shutil
import stat
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from hal_common.i18n import L

NAME_RE = re.compile(r"^[^/\x00]{1,255}$")
MAX_TEXT_READ = 2 * 1024 * 1024
MAX_TEXT_WRITE = 5 * 1024 * 1024


class FileError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


@dataclass(frozen=True)
class Root:
    path: Path
    writable: bool
    label: str


def load_roots(config_file: Path, fallback: list[Root] | None = None) -> list[Root]:
    try:
        data = yaml.safe_load(config_file.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError):
        return fallback or []
    roots = []
    for r in data.get("roots") or []:
        if not isinstance(r, dict) or not r.get("path"):
            continue
        p = Path(os.path.realpath(str(r["path"])))
        if not p.is_absolute() or str(p) in ("/", "/proc", "/sys", "/dev"):
            continue
        roots.append(Root(p, str(r.get("mode", "ro")) == "rw", str(r.get("label") or p.name or str(p))[:40]))
    return roots


def _within(path: Path, root: Path) -> bool:
    try:
        return os.path.commonpath([str(path), str(root)]) == str(root)
    except ValueError:
        return False


class FileService:
    def __init__(self, roots: list[Root]) -> None:
        self.roots = roots

    def list_roots(self) -> list[dict[str, Any]]:
        return [{"path": str(r.path), "label": r.label, "writable": r.writable, "exists": r.path.is_dir()} for r in self.roots]

    def _root_for(self, real: Path) -> Root:
        best = None
        for r in self.roots:
            if _within(real, r.path) and (best is None or len(str(r.path)) > len(str(best.path))):
                best = r
        if best is None:
            raise FileError(403, "forbidden", "Pad valt buiten de toegelaten mappen")
        return best

    def resolve(self, raw: str, must_exist: bool = True) -> tuple[Path, Root]:
        if not raw or "\x00" in raw or not raw.startswith("/"):
            raise FileError(422, "invalid_input", "Geef een absoluut pad")
        if must_exist:
            real = Path(os.path.realpath(raw))
            if not real.exists():
                raise FileError(404, "not_found", "Bestand of map bestaat niet")
        else:
            p = Path(raw)
            parent = Path(os.path.realpath(str(p.parent)))
            if not NAME_RE.match(p.name) or p.name in (".", ".."):
                raise FileError(422, "invalid_input", "Ongeldige naam")
            real = parent / p.name
            if real.is_symlink():
                raise FileError(403, "forbidden", "Symlinks worden niet overschreven")
        return real, self._root_for(real)

    def _writable(self, root: Root, real: Path) -> None:
        if not root.writable:
            raise FileError(403, "read_only", L(f"{root.label} is alleen-lezen", f"{root.label} is read-only"))
        if real == root.path:
            raise FileError(403, "forbidden", "De hoofdmap zelf kan je niet wijzigen")

    @staticmethod
    def _entry(p: Path) -> dict[str, Any]:
        try:
            st = p.lstat()
        except OSError:
            return {"name": p.name, "path": str(p), "type": "unknown"}
        kind = "dir" if stat.S_ISDIR(st.st_mode) else "link" if stat.S_ISLNK(st.st_mode) else "file"
        return {
            "name": p.name, "path": str(p), "type": kind, "size": st.st_size if kind == "file" else None,
            "modified": int(st.st_mtime), "mode": stat.filemode(st.st_mode), "hidden": p.name.startswith("."),
        }

    def list(self, raw: str) -> dict[str, Any]:
        real, root = self.resolve(raw)
        if not real.is_dir():
            raise FileError(400, "bad_request", "Geen map")
        try:
            items = [self._entry(c) for c in real.iterdir()]
        except PermissionError:
            raise FileError(403, "forbidden", "Geen leesrechten op deze map")
        items.sort(key=lambda e: (e["type"] != "dir", e["name"].lower()))
        parent = str(real.parent) if real != root.path else None
        return {"path": str(real), "root": str(root.path), "writable": root.writable, "parent": parent, "entries": items[:5000]}

    def read_text(self, raw: str) -> dict[str, Any]:
        real, root = self.resolve(raw)
        if not real.is_file():
            raise FileError(400, "bad_request", "Geen bestand")
        st = real.stat()
        with open(real, "rb") as f:
            data = f.read(MAX_TEXT_READ + 1)
        truncated = len(data) > MAX_TEXT_READ
        data = data[:MAX_TEXT_READ]
        if b"\x00" in data[:8192]:
            return {"path": str(real), "binary": True, "size": st.st_size, "modified": int(st.st_mtime)}
        return {"path": str(real), "binary": False, "content": data.decode("utf-8", "replace"), "truncated": truncated,
                "size": st.st_size, "modified": st.st_mtime_ns // 1000, "writable": root.writable and not truncated}

    def download_path(self, raw: str) -> Path:
        real, _ = self.resolve(raw)
        if not real.is_file():
            raise FileError(400, "bad_request", "Geen bestand")
        return real

    def write_text(self, raw: str, content: str, expected_mtime_ns: int | None) -> dict[str, Any]:
        exists = os.path.lexists(raw)
        real, root = self.resolve(raw, must_exist=exists)
        self._writable(root, real)
        encoded = content.encode("utf-8")
        if len(encoded) > MAX_TEXT_WRITE:
            raise FileError(413, "too_large", "Tekstbestand te groot (max 5 MB)")
        if exists:
            if not real.is_file():
                raise FileError(400, "bad_request", "Geen gewoon bestand")
            if expected_mtime_ns is not None and real.stat().st_mtime_ns // 1000 != expected_mtime_ns:
                raise FileError(409, "conflict", "Bestand is intussen gewijzigd, laad het opnieuw")
            mode = stat.S_IMODE(real.stat().st_mode)
        else:
            mode = 0o644
        tmp = real.with_name(f".{real.name}.hal-tmp")
        with open(tmp, "wb") as f:
            f.write(encoded)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, mode)
        os.replace(tmp, real)
        return {"path": str(real), "size": len(encoded), "modified": real.stat().st_mtime_ns // 1000}

    def upload_target(self, directory: str, filename: str) -> Path:
        dreal, root = self.resolve(directory)
        if not dreal.is_dir():
            raise FileError(400, "bad_request", "Doel is geen map")
        name = os.path.basename(filename or "")
        if not NAME_RE.match(name) or name in (".", ".."):
            raise FileError(422, "invalid_input", "Ongeldige bestandsnaam")
        target = dreal / name
        self._writable(root, target)
        if target.exists():
            raise FileError(409, "conflict", "Er bestaat al een bestand met die naam")
        return target

    def mkdir(self, raw: str) -> dict[str, Any]:
        real, root = self.resolve(raw, must_exist=False)
        self._writable(root, real)
        try:
            real.mkdir(mode=0o755)
        except FileExistsError:
            raise FileError(409, "conflict", "Bestaat al")
        return self._entry(real)

    def rename(self, raw: str, new_name: str) -> dict[str, Any]:
        real, root = self.resolve(raw)
        self._writable(root, real)
        if not NAME_RE.match(new_name) or new_name in (".", "..") or "/" in new_name:
            raise FileError(422, "invalid_input", "Ongeldige naam")
        target = real.parent / new_name
        if target.exists():
            raise FileError(409, "conflict", "Er bestaat al iets met die naam")
        real.rename(target)
        return self._entry(target)

    def delete(self, raw: str, recursive: bool) -> dict[str, Any]:
        # lexists + geen realpath voor het laatste deel: een symlink zelf verwijderen, nooit het doel
        if not raw.startswith("/") or not os.path.lexists(raw):
            raise FileError(404, "not_found", "Bestaat niet")
        p = Path(raw)
        parent = Path(os.path.realpath(str(p.parent)))
        real = parent / p.name
        root = self._root_for(real)
        self._writable(root, real)
        if real.is_symlink() or real.is_file():
            real.unlink()
        elif real.is_dir():
            if recursive:
                shutil.rmtree(real)
            else:
                try:
                    real.rmdir()
                except OSError:
                    raise FileError(409, "conflict", "Map is niet leeg")
        return {"deleted": str(real)}
