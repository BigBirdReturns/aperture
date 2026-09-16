"""Benign command-profiler example. Both variants must produce identical bytes."""
import sys
if sys.argv[1] == "formula":
    value = 9999 * 10000 // 2
elif sys.argv[1] == "loop":
    value = sum(range(10000))
else:
    raise SystemExit("unknown variant")
sys.stdout.buffer.write((str(value) + "\n").encode("ascii"))
