"""
Orpheus TTS (running in Ollama) -> SNAC decoder -> cute robot voice.

Same pipeline as gogmagog's voice.js, in Python. Needs: numpy, onnxruntime, ffmpeg on PATH.

    python tools/orpheus.py "Hi! <gasp> I missed you." out.mp3 --voice zoe --preset cute

Presets (ffmpeg post-processing):
    raw        Orpheus as-is
    cute       pitched up with a little sparkle
    cuter      pitched higher, slightly smaller-sounding
    robot      cute + a light metallic shimmer
    vengeance  pitched way down, echoing, crunchy. I AM VENGEANCE.
"""
import argparse
import json
import os
import re
import subprocess
import tempfile
import urllib.request
import wave
from pathlib import Path

import numpy as np

OLLAMA = os.environ.get("ORPHEUS_URL", "http://localhost:11434")
MODEL = os.environ.get("ORPHEUS_MODEL", "hf.co/lex-au/Orpheus-3b-FT-Q8_0.gguf")
SNAC = os.environ.get("SNAC_MODEL", r"C:/Users/Braden/Tools/orpheus/snac_decoder.onnx")
RATE = 24000
TAGS = ["laugh", "chuckle", "sigh", "cough", "sniffle", "groan", "yawn", "gasp"]

# pitch: rubberband pitch ratio; formant: keep formants (natural) vs shift them (smaller-sounding)
PRESETS = {
    "raw": "",
    "cute": "rubberband=pitch=1.18:formant=preserved,aexciter=amount=1.5:drive=4,volume=1.1",
    "cuter": "rubberband=pitch=1.3:formant=shifted,aexciter=amount=1.5:drive=4",
    "robot": "rubberband=pitch=1.2:formant=preserved,aecho=0.8:0.6:6|11:0.3|0.2,aexciter=amount=2:drive=5",
    # robot-1/2/3: Leah-tuned, increasingly robotic. Metallic comb (flanger + tiny echoes),
    # then a buzzy amplitude "ring" modulation, then a little bit-crush.
    "robot-1": "rubberband=pitch=1.12:formant=preserved,"
               "flanger=delay=0:depth=1.5:regen=45:speed=0.25:width=60,"
               "aecho=0.8:0.5:4|7:0.25|0.15,aexciter=amount=2:drive=5",
    "robot-2": "rubberband=pitch=1.15:formant=preserved,"
               "flanger=delay=0:depth=2:regen=60:speed=0.3:width=70,"
               "aecho=0.8:0.55:3|6|9:0.3|0.2|0.12,"
               "aeval=val(0)*(0.72+0.28*sin(2*PI*70*t)):c=same,"
               "acrusher=bits=12:mix=0.12,aexciter=amount=2:drive=6",
    "robot-3": "rubberband=pitch=1.15:formant=preserved,"
               "flanger=delay=0:depth=3:regen=75:speed=0.4:width=80,"
               "aecho=0.8:0.6:3|5|8:0.35|0.25|0.15,"
               "aeval=val(0)*(0.55+0.45*sin(2*PI*85*t)):c=same,"
               "acrusher=bits=10:mix=0.22,highpass=f=180,aexciter=amount=2.5:drive=7",
    "vengeance": "rubberband=pitch=0.6:formant=shifted,rubberband=tempo=0.88,"
                 "acrusher=bits=10:mix=0.25,aecho=0.8:0.85:120|260:0.45|0.3,"
                 "bass=g=8,volume=2.2,alimiter=limit=0.9",
    # deeper for a higher (female) voice, plus the robot buzz so it's still clearly her
    "vengeance-deep": "rubberband=pitch=0.5:formant=shifted,rubberband=tempo=0.85,"
                      "aeval=val(0)*(0.6+0.4*sin(2*PI*45*t)):c=same,"
                      "acrusher=bits=9:mix=0.3,aecho=0.8:0.85:120|260:0.45|0.3,"
                      "bass=g=10,volume=2.4,alimiter=limit=0.9",
    "vengeance-demon": "asplit[a][b];[a]rubberband=pitch=0.5:formant=shifted[lo];"
                       "[b]rubberband=pitch=0.35:formant=shifted,volume=0.8[sub];"
                       "[lo][sub]amix=inputs=2:normalize=0,rubberband=tempo=0.85,"
                       "acrusher=bits=9:mix=0.3,aecho=0.8:0.88:140|300:0.5|0.35,"
                       "bass=g=10,volume=2,alimiter=limit=0.9",
}

_snac = None


def orpheus_codes(response: str):
    codes = []
    for m in re.finditer(r"<custom_token_(\d+)>", response):
        cid = int(m.group(1)) - 10 - ((len(codes) % 7) * 4096)
        if 0 <= cid < 4096:
            codes.append(cid)
    c0, c1, c2 = [], [], []
    for j in range(0, len(codes) - 6, 7):
        f = codes[j:j + 7]
        c0.append(f[0])
        c1 += [f[1], f[4]]
        c2 += [f[2], f[3], f[5], f[6]]
    return c0, c1, c2


def generate(text: str, voice: str = "zoe", model: str = MODEL, temperature: float = 0.6) -> np.ndarray:
    """Return float32 mono samples at 24 kHz."""
    global _snac
    body = json.dumps({
        "model": model, "raw": True, "stream": False, "keep_alive": "30m",
        "prompt": f"<custom_token_3><|begin_of_text|>{voice}: {text}<|eot_id|><custom_token_4><custom_token_5><custom_token_1>",
        "options": {"temperature": temperature, "top_p": 0.9, "repeat_penalty": 1.1,
                    "num_predict": 4000, "num_ctx": 8192, "stop": ["<custom_token_2>"]},
    }).encode()
    req = urllib.request.Request(OLLAMA.rstrip("/") + "/api/generate", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        d = json.load(r)
    if d.get("error"):
        raise RuntimeError(d["error"])
    c0, c1, c2 = orpheus_codes(d.get("response", ""))
    if len(c0) < 3:
        raise RuntimeError("Orpheus answered without speech")

    import onnxruntime as ort
    _snac = _snac or ort.InferenceSession(SNAC)
    t = lambda a: np.array([a], dtype=np.int64)  # noqa: E731
    out = _snac.run(None, {"audio_codes.0": t(c0), "audio_codes.1": t(c1), "audio_codes.2": t(c2)})
    return np.asarray(out[0], dtype=np.float32).reshape(-1)


def write_wav(samples: np.ndarray, path: Path, rate: int = RATE):
    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())


def speak_raw(text: str, raw_path: Path, voice="zoe", model=MODEL, retries=2):
    """Generate with Orpheus and save the untouched voice as a WAV (the slow, GPU part)."""
    last = None
    for _ in range(retries + 1):
        try:
            samples = generate(text, voice, model)
            # guard against runaway generations (Orpheus sometimes babbles on)
            words = max(1, len(re.sub(r"<\w+>", "", text).split()))
            if len(samples) / RATE > 2.5 + words * 0.75:
                raise RuntimeError("too long, retrying")
            break
        except Exception as e:  # noqa: BLE001
            last = e
    else:
        raise RuntimeError(f"failed after retries: {last}")
    Path(raw_path).parent.mkdir(parents=True, exist_ok=True)
    write_wav(samples, Path(raw_path))


def process(raw_path: Path, out: Path, preset="cute", bitrate="64k"):
    """Apply a preset to a raw WAV (fast, ffmpeg only)."""
    out = Path(out)
    af = PRESETS[preset]
    # trim leading/trailing silence, then the voice preset, then normalize loudness
    chain = "silenceremove=start_periods=1:start_threshold=-45dB,areverse," \
            "silenceremove=start_periods=1:start_threshold=-45dB,areverse"
    chain += ("," + af if af else "") + ",loudnorm=I=-16:TP=-1.5"
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw_path), "-filter_complex", chain, "-ac", "1"]
    if out.suffix == ".mp3":
        cmd += ["-b:a", bitrate]
    subprocess.run(cmd + [str(out)], check=True)


def render(text: str, out: Path, voice="zoe", preset="cute", model=MODEL):
    """Speak `text` into `out` (.mp3/.ogg/.wav) with a post-processing preset."""
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "raw.wav"
        speak_raw(text, raw, voice, model)
        process(raw, out, preset)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("text")
    ap.add_argument("out")
    ap.add_argument("--voice", default="zoe")
    ap.add_argument("--preset", default="cute", choices=PRESETS)
    ap.add_argument("--model", default=MODEL)
    a = ap.parse_args()
    render(a.text, Path(a.out), a.voice, a.preset, a.model)
    print("wrote", a.out)
