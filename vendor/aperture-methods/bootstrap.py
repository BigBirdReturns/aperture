"""Optional user-invoked environment setup. Never installs a driver or launches a model."""
import argparse
import importlib.util
import importlib.metadata
import os
import subprocess
import sys
import venv
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("--hf", action="store_true", help="Add Transformers/Accelerate using an already installed PyTorch build")
a = p.parse_args()
root = Path(__file__).resolve().parent
if a.hf and importlib.util.find_spec("torch") is None:
    raise SystemExit("Install a suitable PyTorch build in your chosen Python environment first. No GPU driver or CUDA package is installed by this bootstrap.")
env = root / ".venv"
if env.exists():
    raise SystemExit(".venv already exists; it was left unchanged. Use its Python with the requirements file explicitly.")
venv.EnvBuilder(with_pip=True, system_site_packages=True).create(env)
python = env / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
requirements = root / ("requirements-hf.txt" if a.hf else "requirements-base.txt")
command = [str(python), "-m", "pip", "install", "-r", str(requirements)]
if a.hf:
    constraints = env / "preserve-torch.constraints.txt"
    constraints.write_text("torch==" + importlib.metadata.version("torch") + "\n")
    command += ["--constraint", str(constraints)]
subprocess.run(command, check=True)
print("Environment prepared. Use run.cmd on Windows or ./run.sh on Linux/macOS.")
