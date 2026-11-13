"""
Render one line in several Orpheus voices x presets and build audition/index.html to compare them.

    python tools/audition.py
    python tools/audition.py --voices zoe mia --presets cute cuter --text "Beep! Hi."
"""
import argparse
import html
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import orpheus  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "audition"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--text", default="Oh! <gasp> Hi bestie. I was hoping you'd come say hi. Tap me for one blush mana.")
    ap.add_argument("--voices", nargs="*", default=["tara", "leah", "jess", "mia", "zoe"])
    ap.add_argument("--presets", nargs="*", default=["raw", "cute", "cuter", "robot"])
    ap.add_argument("--evil-text", default="I. AM. VENGEANCE. <groan> Your blickies cannot save you now.")
    ap.add_argument("--evil-voices", nargs="*", default=["leah"])
    a = ap.parse_args()
    OUT.mkdir(exist_ok=True)

    rows = []

    def do(voice, text, presets):
        print(f"{voice}: generating...", flush=True)
        try:
            samples = orpheus.generate(text, voice)
        except Exception as e:  # noqa: BLE001
            print(f"  failed: {e}")
            return
        raw = OUT / f"_{voice}.wav"
        orpheus.write_wav(samples, raw)
        cells = []
        for p in presets:
            f = OUT / f"{voice}-{p}-{abs(hash(text)) % 10000}.mp3"
            try:
                orpheus.process(raw, f, p, bitrate="96k")
                cells.append((p, f.name))
            except subprocess.CalledProcessError as e:
                print(f"  {p} failed: {e}")
        raw.unlink()
        rows.append((voice, text, cells))

    for v in a.voices:
        do(v, a.text, a.presets)
    for v in a.evil_voices:
        do(v, a.evil_text, ["vengeance", "vengeance-deep", "vengeance-demon"])

    body = []
    for voice, text, cells in rows:
        players = "".join(
            f'<div class="cell"><b>{p}</b><audio controls preload="none" src="{n}"></audio></div>' for p, n in cells)
        body.append(f'<section><h2>{voice}</h2><p>{html.escape(text)}</p><div class="row">{players}</div></section>')
    (OUT / "index.html").write_text(f"""<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Voice audition</title>
<style>
:root{{color-scheme:light dark;--bg:#fff6f8;--ink:#4a3040;--card:#fff}}
@media (prefers-color-scheme:dark){{:root{{--bg:#1b1736;--ink:#f4e8ff;--card:#2b2347}}}}
body{{font-family:system-ui,sans-serif;background:var(--bg);color:var(--ink);max-width:900px;margin:0 auto;padding:16px}}
section{{background:var(--card);border-radius:16px;padding:12px 16px;margin:12px 0}}
h2{{margin:0;text-transform:capitalize}} p{{opacity:.7;margin:4px 0 10px;font-size:14px}}
.row{{display:flex;flex-wrap:wrap;gap:10px}} .cell{{display:flex;flex-direction:column;gap:4px}}
audio{{width:200px;max-width:100%}}
</style><h1>Vox Nut voice audition</h1>{''.join(body)}""", encoding="utf-8")
    print("open audition/index.html")


if __name__ == "__main__":
    main()
