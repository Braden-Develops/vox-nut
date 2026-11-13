# Cherry 🍒🤖

A tiny cute robot that lives on a static website. She's shy and sweet during the day, cozy at night, and talks using pre-written voicelines.

## Run it locally

```bash
python -m http.server 8737
```

Then open http://localhost:8737. Add `?time=night` or `?time=day` to the URL to preview each mode.

## Customize

- `config.json` has the robot name, her name (`friendName`), when night starts, and the voice pitch.
- `lines.json` holds every voiceline. `{name}` and `{robot}` get filled in automatically. Hand-edit freely.
- `tools/persona.md` describes the personality and inside jokes. It's fed to the LLM.

## Grow the line pool with a local LLM

Any OpenAI-compatible server works (Ollama, LM Studio, llama.cpp...):

```bash
python tools/generate_lines.py --model llama3.1:8b --dry-run
python tools/generate_lines.py --model llama3.1:8b --per 15
python tools/generate_lines.py --base-url http://localhost:1234/v1 --model local --only gw2 mtg repo
```

Then read through `lines.json` and delete the duds.

## Custom voice

Until audio is rendered, the site uses the browser's built-in text-to-speech with a raised pitch. To use a real voice model:

```bash
python tools/render_audio.py --limit 3 --cmd "python path/to/your_tts.py --text-file {text_file} --out {out}"
python tools/render_audio.py --cmd "..."
```

That writes `audio/<line-id>.mp3` plus `audio/manifest.json`, and the site picks them up automatically. Any line without audio still falls back to browser text-to-speech.

## Deploy to GitHub Pages

Push this folder to a repo, then go to Settings → Pages → Deploy from branch → `main` / root. On her phone, open the link and choose "Add to Home Screen" so it opens like an app.

## How she works

- Tap Cherry and she reacts. Tap her five times fast and she gets flustered.
- The chips and the text box pick a category. Typed messages are matched by keywords, so "blicky", "skyscale" and "mulligan" all work.
- The envelope opens one note per day.
- If nobody touches her for a while, she says little thoughts to herself (silently).
