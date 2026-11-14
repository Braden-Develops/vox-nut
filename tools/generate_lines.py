"""
Generate more voicelines with a local LLM and merge them into lines.json.

Works with any OpenAI-compatible server: Ollama, LM Studio, llama.cpp server,
text-generation-webui, vLLM, KoboldCpp...

    python tools/generate_lines.py --model llama3.1:8b
    python tools/generate_lines.py --base-url http://localhost:1234/v1 --model local --per 15
    python tools/generate_lines.py --only gw2 mtg repo --per 20
    python tools/generate_lines.py --dry-run          # print without saving

No pip installs needed (stdlib only). Lines are de-duplicated against what's
already in lines.json, so you can run it repeatedly to grow the pool, then
hand-edit lines.json to cut anything off.
"""
import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# (category, time, what to write) -- time is day / night / any
SPECS = [
    ("greeting", "day", "greetings when {name} opens the site during the day"),
    ("greeting", "night", "greetings when {name} opens the site late at night"),
    ("tap", "any", "short reactions to being poked or tapped (very short, 1 sentence)"),
    ("flustered", "any", "reactions to being poked too many times in a row, flustered and overwhelmed in a cute way"),
    ("comfort", "day", "gentle comfort when {name} says she is sad or had a bad day"),
    ("comfort", "night", "gentle cozy comfort when {name} is sad late at night"),
    ("sleepy", "day", "responses when {name} says she is tired during the day"),
    ("sleepy", "night", "responses nudging {name} to go to sleep when she is tired at night"),
    ("goodnight", "night", "sweet goodnight messages"),
    ("bored", "any", "suggestions or silly ideas when {name} is bored"),
    ("joke", "any", "clean, cute robot puns and silly jokes"),
    ("compliment", "any", "hype and compliments to boost {name}'s confidence"),
    ("love", "any", "shy, flustered reactions when {name} says I love you, you're cute, or thank you"),
    ("bit", "any", "lines using the inside jokes: hot dog style (lengthwise) and blickies (guns)"),
    ("gw2", "any", "lines about playing Guild Wars 2 together"),
    ("mtg", "any", "lines about Magic: The Gathering"),
    ("repo", "any", "lines about playing R.E.P.O. together"),
    ("idle", "day", "little thoughts said to nobody in particular while idle during the day (very short)"),
    ("idle", "night", "little sleepy thoughts said while idle at night (very short)"),
    ("daily", "any", "a daily note that always starts with \"Today's note:\" and is warm and encouraging"),
    ("confused", "any", "responses when {robot} doesn't understand what {name} typed, still sweet"),
]


def chat(base_url, model, system, user, temperature):
    body = json.dumps({
        "model": model,
        "temperature": temperature,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }).encode()
    req = urllib.request.Request(
        base_url.rstrip("/") + "/chat/completions",
        data=body,
        headers={"Content-Type": "application/json", "Authorization": "Bearer local", "X-Gate-Client": "vox-nut-lines"},
    )
    import time
    import urllib.error
    for _ in range(40):
        try:
            with urllib.request.urlopen(req, timeout=600) as r:
                return json.load(r)["choices"][0]["message"]["content"]
        except urllib.error.HTTPError as e:
            if e.code != 503:  # 503 = GPU gate busy (a game is running): wait and retry
                raise
            wait = max(15, min(int(e.headers.get("Retry-After") or 60), 900))
            print(f"(GPU gate busy, retrying in {wait}s)", end=" ", flush=True)
            time.sleep(wait)
    raise RuntimeError("GPU gate stayed busy")


def parse_lines(raw):
    """Accept a JSON array, or fall back to one line per row."""
    raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.S)  # reasoning models
    m = re.search(r"\[.*\]", raw, flags=re.S)
    if m:
        try:
            arr = json.loads(m.group(0))
            return [str(x).strip() for x in arr if str(x).strip()]
        except json.JSONDecodeError:
            pass
    rows = [re.sub(r'^\s*(\d+[.)]|[-*•])\s*', "", l).strip().strip('"') for l in raw.splitlines()]
    return [r for r in rows if len(r) > 3]


def clean(text):
    text = re.sub(r"\*[^*]*\*", "", text)          # *stage directions*
    text = re.sub(r"[\U0001F000-\U0001FFFF☀-➿]", "", text)  # emoji
    return re.sub(r"\s+", " ", text).strip()


def norm(text):
    return re.sub(r"[^a-z0-9 ]", "", text.lower())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://127.0.0.1:11435/v1", help="OpenAI-compatible base URL (default: the GPU gate, queued)")
    ap.add_argument("--model", required=True)
    ap.add_argument("--per", type=int, default=12, help="lines to request per category")
    ap.add_argument("--only", nargs="*", help="only these categories")
    ap.add_argument("--temperature", type=float, default=0.95)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    cfg = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
    persona = (ROOT / "tools" / "persona.md").read_text(encoding="utf-8")
    # keep {name} as a placeholder in output; the site fills it in
    system = persona.replace("{robot}", cfg["robotName"])

    data = json.loads((ROOT / "lines.json").read_text(encoding="utf-8"))
    existing = data["lines"]
    seen = {norm(l["text"]) for l in existing}
    added = 0

    for cat, time, what in SPECS:
        if args.only and cat not in args.only:
            continue
        what = what.replace("{robot}", cfg["robotName"])
        examples = [l["text"] for l in existing if l["cat"] == cat and l["time"] == time][:6]
        user = (
            f"Write {args.per} different voicelines for this situation: {what}.\n"
            f"Time of day: {time}.\n"
            + (f"Examples of the style (do NOT repeat these):\n" + "\n".join(f"- {e}" for e in examples) + "\n" if examples else "")
            + "Reply with ONLY a JSON array of strings."
        )
        print(f"-> {cat}/{time} ...", end=" ", flush=True)
        try:
            raw = chat(args.base_url, args.model, system, user, args.temperature)
        except Exception as e:  # noqa: BLE001
            print(f"failed: {e}")
            continue

        n = 0
        ids = [l["id"] for l in existing if l["cat"] == cat and l["time"] == time]
        nxt = max([int(i.rsplit("-", 1)[1]) for i in ids] or [0]) + 1
        for text in map(clean, parse_lines(raw)):
            if not text or len(text.split()) > 32 or norm(text) in seen:
                continue
            seen.add(norm(text))
            line = {"id": f"{cat}-{time}-{nxt:03d}", "cat": cat, "time": time, "text": text}
            nxt += 1
            n += 1
            existing.append(line)
            if args.dry_run:
                print(f"\n   {text}", end="")
        added += n
        print(f"{'' if not args.dry_run else chr(10)}   +{n}")

    if args.dry_run:
        print(f"\n(dry run) would add {added} lines")
        return
    (ROOT / "lines.json").write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"\nAdded {added} lines. Total: {len(existing)}. Review lines.json and delete any duds!")


if __name__ == "__main__":
    sys.exit(main())
