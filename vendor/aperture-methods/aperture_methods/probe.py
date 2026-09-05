from __future__ import annotations

import csv
import ctypes
import importlib.metadata
import os
import platform
import shutil
import subprocess
from pathlib import Path
from typing import Any

from .common import now


def memory() -> dict[str, Any]:
    try:
        if os.name == "nt":
            class Status(ctypes.Structure):
                _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong)] + [
                    (name, ctypes.c_ulonglong) for name in
                    ["total", "available", "page_total", "page_available", "virtual_total", "virtual_available", "extended"]]
            status = Status()
            status.length = ctypes.sizeof(status)
            if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                raise OSError("GlobalMemoryStatusEx failed")
            return {"total_bytes": status.total, "available_bytes": min(status.available, status.page_available),
                    "source": "GlobalMemoryStatusEx", "scope": "system_free_and_commit_headroom"}
        if Path("/proc/meminfo").exists():
            values = {s.split(":")[0]: int(s.split()[1]) * 1024 for s in Path("/proc/meminfo").read_text().splitlines()}
            total, available = values["MemTotal"], values.get("MemAvailable", values["MemFree"])
            # cgroup v2 limit is a tighter capacity bound than host RAM in containers.
            cg = Path("/sys/fs/cgroup")
            scope = "host"
            try:
                limit = (cg / "memory.max").read_text().strip()
                used = int((cg / "memory.current").read_text())
                if limit != "max":
                    total, available = min(total, int(limit)), min(available, max(0, int(limit) - used))
                    scope = "host_and_cgroup_v2_root"
            except (OSError, ValueError):
                pass
            return {"total_bytes": total, "available_bytes": available, "source": "/proc/meminfo", "scope": scope}
        import psutil
        m = psutil.virtual_memory()
        return {"total_bytes": m.total, "available_bytes": m.available, "source": "psutil", "scope": "system"}
    except (OSError, ValueError, ImportError, KeyError):
        return {"total_bytes": None, "available_bytes": None, "source": "unavailable"}


def nvidia() -> dict[str, Any]:
    exe = shutil.which("nvidia-smi")
    if not exe:
        return {"status": "NOT_DISCOVERED", "devices": [], "reason": "nvidia-smi is not on PATH; this does not prove there is no GPU."}
    fields = ["index", "uuid", "name", "memory.total", "memory.free", "driver_version", "pci.bus_id"]
    try:
        result = subprocess.run([exe, "--query-gpu=" + ",".join(fields), "--format=csv,noheader,nounits"],
                                capture_output=True, text=True, timeout=8, shell=False)
        if result.returncode:
            return {"status": "QUERY_FAILED", "devices": []}
        devices = []
        for row in csv.reader(result.stdout.splitlines(), skipinitialspace=True):
            if len(row) != len(fields):
                continue
            data = dict(zip(fields, (x.strip() for x in row)))
            data["index"] = int(data["index"])
            for src, dest in [("memory.total", "total_bytes"), ("memory.free", "free_bytes")]:
                text = data.pop(src)
                data[dest] = int(float(text) * 1024**2) if text.replace(".", "", 1).isdigit() else None
            data["capacity_basis"] = "DRIVER_REPORTED_NOT_ALLOCATION_TESTED"
            data["requires_external_capacity_qualification"] = "CMP" in data["name"].upper()
            devices.append(data)
        return {"status": "OBSERVED", "devices": devices}
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return {"status": "QUERY_FAILED", "devices": []}


def cpu_identity() -> dict[str, Any]:
    """Read existing OS identity records; this does not benchmark the processor."""
    result: dict[str, Any] = {"name": None, "instruction_flags": None, "source": "unavailable"}
    try:
        if Path("/proc/cpuinfo").exists():
            fields = {}
            with Path("/proc/cpuinfo").open() as f:
                for line in f:
                    if not line.strip():
                        break
                    if ":" in line:
                        k, v = line.split(":", 1)
                        fields[k.strip()] = v.strip()
            result = {"name": fields.get("model name", fields.get("Processor")),
                      "instruction_flags": fields.get("flags", fields.get("Features", "")).split(),
                      "source": "/proc/cpuinfo_first_processor"}
        elif os.name == "nt":
            import winreg
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0") as key:
                result = {"name": winreg.QueryValueEx(key, "ProcessorNameString")[0].strip(),
                          "instruction_flags": None, "source": "Windows_hardware_registry"}
    except (OSError, ImportError, ValueError):
        pass
    return result


def probe(storage: Path) -> dict[str, Any]:
    storage = storage.expanduser().resolve()
    existing = storage
    while not existing.exists() and existing != existing.parent:
        existing = existing.parent
    usage = shutil.disk_usage(existing)
    versions = {}
    for module in ["torch", "transformers", "accelerate", "safetensors", "huggingface-hub", "psutil"]:
        try:
            versions[module] = importlib.metadata.version(module)
        except importlib.metadata.PackageNotFoundError:
            versions[module] = None
    return {"format": "aperture-machine-observation/1", "observed_at": now(),
            "system": {"os": platform.system(), "release": platform.release(), "architecture": platform.machine(),
                       "logical_cpus": os.cpu_count(), "python": platform.python_version(), "cpu": cpu_identity()},
            "ram": memory(), "nvidia": nvidia(), "packages": versions,
            "storage": {"path": str(storage), "filesystem_total_bytes": usage.total, "filesystem_free_bytes": usage.free},
            "measurements_not_taken": ["memory bandwidth", "PCIe throughput", "network bandwidth", "HBM stability", "model performance"],
            "privacy": "No hostname, username, prompts, credentials, browser data, or file inventory collected."}
