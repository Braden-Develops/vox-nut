"""
Append hand-written lines to lines.json.

Input: a text file with one line per row:   category|time|text
(time is day / night / any). Blank lines and lines starting with # are skipped.
Duplicates (ignoring punctuation and case) are skipped. IDs are assigned automatically.

    python tools/add_lines.py my_new_lines.txt
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def norm(t):
    return re.sub(r"[^a-z0-9 ]", "", t.lower())


def main(src):
    path = ROOT / "lines.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    lines = data["lines"]
    seen = {norm(l["text"]) for l in lines}
    nxt = {}
    for l in lines:
        key, n = l["id"].rsplit("-", 1)
        nxt[key] = max(nxt.get(key, 0), int(n))

    added = 0
    for raw in Path(src).read_text(encoding="utf-8").splitlines():
        raw = raw.strip()
        if not raw or raw.startswith("#"):
            continue
        cat, time, text = (x.strip() for x in raw.split("|", 2))
        if time not in ("day", "night", "any"):
            sys.exit(f"bad time '{time}' in: {raw}")
        if norm(text) in seen:
            continue
        seen.add(norm(text))
        key = f"{cat}-{time}"
        nxt[key] = nxt.get(key, 0) + 1
        lines.append({"id": f"{key}-{nxt[key]:03d}", "cat": cat, "time": time, "text": text})
        added += 1

    path.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"added {added}, total {len(lines)}")
    print(sorted(Counter(l["cat"] for l in lines).items(), key=lambda x: -x[1])[:12])


if __name__ == "__main__":
    main(sys.argv[1])
