"""
Pre-render every line in lines.json to an audio file, and write audio/manifest.json
so the site plays your custom voice instead of the browser's text-to-speech.

Lines without a rendered file still fall back to browser TTS, so you can
render in batches.

By default this uses Orpheus in Ollama (tools/orpheus.py) with the voice and
preset from config.json -> "orpheus". Run it with the project venv:

     .venv/Scripts/python tools/render_audio.py --limit 5
     .venv/Scripts/python tools/render_audio.py

Or use any other TTS CLI via --cmd. Placeholders: {text} {text_file} {out}
     python tools/render_audio.py --cmd "python C:/tts/infer.py --text-file {text_file} --out {out}"

Orpheus sound tags in lines (<gasp> <laugh> <chuckle> <sigh> <yawn> ...) are
spoken as sounds and hidden from the on-screen text.

Options:
    --ext wav|mp3|ogg   output extension (default mp3; your command must write that format)
    --force             re-render files that already exist
    --only gw2 mtg      only these categories
    --limit 5           render just a few to test
    --reprocess         re-apply presets from cached raw voice (fast, no GPU)
    --force             also regenerate the raw voice with Orpheus

Tip: if your model only writes WAV, render with --ext wav then run with
--convert to transcode to mp3 via ffmpeg (much smaller for the website).
"""
import argparse
import json
import shlex
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUDIO = ROOT / "audio"


RAW = AUDIO / "raw"  # untouched Orpheus output, cached so presets can change without the GPU


def voice_for(cat: str, cfg: dict):
    o = cfg.get("orpheus", {})
    if cat == "vengeance":
        return o.get("evilVoice", "leo"), o.get("evilPreset", "vengeance")
    return o.get("voice", "zoe"), o.get("preset", "cute")


def synthesize(text: str, out_path: Path, line_id: str, cat: str, cfg: dict, regen=False) -> None:
    """Default: Orpheus in Ollama (tools/orpheus.py), voice + preset from config.json "orpheus"."""
    sys.path.insert(0, str(Path(__file__).parent))
    import orpheus
    voice, preset = voice_for(cat, cfg)
    raw = RAW / f"{line_id}.{voice}.wav"
    if regen or not raw.exists():
        orpheus.speak_raw(text, raw, voice)
    orpheus.process(raw, out_path, preset)


def run_cmd(template: str, text: str, out_path: Path) -> None:
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as f:
        f.write(text)
        text_file = f.name
    try:
        cmd = template.format(text=shlex.quote(text), text_file=text_file, out=str(out_path))
        subprocess.run(cmd, shell=True, check=True)
    finally:
        Path(text_file).unlink(missing_ok=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cmd")
    ap.add_argument("--ext", default="mp3")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--match", help="only lines whose text contains this (e.g. \"{name}\" after changing friendName)")
    ap.add_argument("--convert", action="store_true", help="after rendering, ffmpeg wav -> mp3")
    ap.add_argument("--reprocess", action="store_true",
                    help="re-apply the config preset to every line (reuses cached raw voice, no GPU)")
    args = ap.parse_args()

    cfg = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
    lines = json.loads((ROOT / "lines.json").read_text(encoding="utf-8"))["lines"]
    AUDIO.mkdir(exist_ok=True)

    todo = [l for l in lines if not args.only or l["cat"] in args.only]
    if args.match:
        todo = [l for l in todo if args.match in l["text"]]
    if args.limit:
        todo = todo[: args.limit]

    for i, line in enumerate(todo, 1):
        out = AUDIO / f"{line['id']}.{args.ext}"
        if out.exists() and not (args.force or args.reprocess):
            continue
        text = line["text"].replace("{name}", cfg["friendName"]).replace("{robot}", cfg["robotName"])
        print(f"[{i}/{len(todo)}] {line['id']}: {text}", flush=True)
        try:
            if args.cmd:
                run_cmd(args.cmd, text, out)
            else:
                synthesize(text, out, line["id"], line["cat"], cfg, regen=args.force)
        except Exception as e:  # noqa: BLE001
            print(f"   failed: {e}")

    if args.convert:
        if not shutil.which("ffmpeg"):
            sys.exit("ffmpeg not found on PATH")
        for wav in AUDIO.glob("*.wav"):
            mp3 = wav.with_suffix(".mp3")
            if mp3.exists() and not args.force:
                continue
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav),
                            "-ac", "1", "-b:a", "64k", str(mp3)], check=True)
            wav.unlink()

    # manifest: line id -> filename, preferring mp3 > ogg > wav
    manifest = {}
    ids = {l["id"] for l in lines}
    for ext in ("wav", "ogg", "mp3"):
        for f in AUDIO.glob(f"*.{ext}"):
            if f.stem in ids:
                manifest[f.stem] = f.name
    (AUDIO / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    print(f"\nmanifest: {len(manifest)}/{len(lines)} lines have audio")


if __name__ == "__main__":
    main()
