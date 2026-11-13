(() => {
  "use strict";

  // ---------- state ----------
  const $ = (s) => document.querySelector(s);
  const robot = $("#robot");
  const bubble = $("#bubble");
  const bubbleText = $("#bubbleText");
  const soundBtn = $("#soundBtn");
  const letterBtn = $("#letterBtn");
  const params = new URLSearchParams(location.search);

  let config = { robotName: "Vox Nut", friendName: "bestie", dayStartsHour: 7, nightStartsHour: 20, voice: { pitch: 1.6, rate: 1 } };
  let lines = [];
  let audioMap = {};          // line id -> audio file path (from audio/manifest.json)
  let soundOn = load("soundOn", "1") === "1";
  let bags = {};              // shuffle bags so lines don't repeat too soon
  let typeTimer = null, moodTimer = null, idleTimer = null;
  let currentAudio = null;
  let taps = [];
  let lastCat = null;

  // storage that never throws (private mode etc.)
  function load(k, d) { try { const v = localStorage.getItem("cherry:" + k); return v === null ? d : v; } catch { return d; } }
  function save(k, v) { try { localStorage.setItem("cherry:" + k, v); } catch { /* ignore */ } }

  // ---------- time of day ----------
  function period() {
    const forced = params.get("time");
    if (forced === "day" || forced === "night") return forced;
    const h = new Date().getHours();
    return h >= config.dayStartsHour && h < config.nightStartsHour ? "day" : "night";
  }

  function applyPeriod() {
    const night = period() === "night";
    document.body.classList.toggle("night", night);
    document.querySelector('meta[name="theme-color"]').content = night ? "#1b1736" : "#ffe9ef";
    $("#clock").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  // ---------- picking lines ----------
  const GAME_CATS = ["gw2", "mtg", "repo"];

  function candidates(cat) {
    const p = period();
    let c = lines.filter((l) => l.cat === cat && (l.time === "any" || l.time === p || !l.time));
    if (!c.length) c = lines.filter((l) => l.cat === cat);
    return c;
  }

  function pick(cat) {
    if (cat === "games") cat = GAME_CATS[Math.floor(Math.random() * GAME_CATS.length)];
    if (cat === "sleepy" && period() === "night" && Math.random() < 0.5) cat = "goodnight";
    const pool = candidates(cat);
    if (!pool.length) return null;
    const key = cat + "|" + period();
    if (!bags[key] || !bags[key].length) {
      bags[key] = pool.map((_, i) => i).sort(() => Math.random() - 0.5);
    }
    return pool[bags[key].pop()] || pool[0];
  }

  function fill(text) {
    return text.replaceAll("{name}", config.friendName).replaceAll("{robot}", config.robotName)
      .replace(/\s*<\w+>\s*/g, " ").trim();
  }

  // ---------- mood ----------
  const MOODS = {
    greeting: "happy", comfort: "sad", joke: "happy", bored: "", compliment: "shy",
    sleepy: "sleepy", goodnight: "sleepy", flustered: "shy", tap: "happy", bit: "happy",
    gw2: "happy", mtg: "happy", repo: "happy", idle: "", daily: "shy", confused: "shy", love: "shy",
    vengeance: "", sorry: "shy",
  };
  const MOOD_CLASSES = ["mood-happy", "mood-shy", "mood-sleepy", "mood-sad"];

  function setMood(m, holdMs = 4500) {
    robot.classList.remove(...MOOD_CLASSES);
    if (m) robot.classList.add("mood-" + m);
    clearTimeout(moodTimer);
    if (holdMs) moodTimer = setTimeout(() => setMood(restingMood(), 0), holdMs);
  }
  function restingMood() {
    if (period() !== "night") return "";
    const h = new Date().getHours();
    return h >= 23 || h < 5 ? "sleepy" : "";
  }

  function flash(cls, ms) {
    robot.classList.remove(cls);
    void robot.getBoundingClientRect();
    robot.classList.add(cls);
    setTimeout(() => robot.classList.remove(cls), ms);
  }

  // ---------- talking ----------
  // `what` is a category name, or a specific line object
  function say(what, { quiet = false, thought = false } = {}) {
    const line = typeof what === "string" ? pick(what) : what;
    if (!line) return;
    lastCat = line.cat;
    const text = fill(line.text);

    stopSpeaking();
    bubble.classList.toggle("thought", thought);
    bubble.classList.add("show");
    setMood(line.mood ?? MOODS[line.cat] ?? "", Math.max(4000, text.length * 70));
    if (line.cat === "greeting") flash("wave", 1600);

    // typewriter (resolves when the text is fully shown)
    clearTimeout(typeTimer);
    let i = 0;
    bubbleText.textContent = "";
    const typed = new Promise((done) => {
      const fast = line.cat === "vengeance";
      const step = () => {
        bubbleText.textContent = text.slice(0, ++i);
        if (i < text.length) typeTimer = setTimeout(step, text[i - 1].match(/[.,!?…]/) ? (fast ? 260 : 140) : (fast ? 55 : 26));
        else { if (!speaking()) robot.classList.remove("talking"); done(); }
      };
      robot.classList.add("talking");
      step();
    });

    const spoken = soundOn && !quiet ? speak(line, text) : Promise.resolve();
    resetIdle();
    return Promise.all([typed, spoken]);
  }

  function speaking() {
    return (currentAudio && !currentAudio.paused) || ("speechSynthesis" in window && speechSynthesis.speaking);
  }

  // resolves when the line has finished playing
  function speak(line, text) {
    return new Promise((done) => {
      const end = () => { robot.classList.remove("talking"); done(); };
      const file = audioMap[line.id];
      if (file) {
        currentAudio = new Audio(file);
        robot.classList.add("talking");
        currentAudio.onended = currentAudio.onerror = currentAudio.onpause = end;
        currentAudio.play().catch(end);
        return;
      }
      if (!("speechSynthesis" in window)) return done();
      const evil = line.cat === "vengeance";
      const u = new SpeechSynthesisUtterance(text.replace(/[*~]/g, ""));
      u.pitch = evil ? 0.1 : config.voice?.pitch ?? 1.6;
      u.rate = evil ? 0.7 : (config.voice?.rate ?? 1) * (period() === "night" ? 0.92 : 1);
      const v = chooseVoice();
      if (v) u.voice = v;
      robot.classList.add("talking");
      u.onend = u.onerror = end;
      speechSynthesis.speak(u);
    });
  }

  // ---------- being mean has consequences ----------
  let vengeful = false;
  async function vengeance() {
    if (vengeful) return;
    vengeful = true;
    document.body.classList.add("vengeance");
    robot.classList.add("vengeance");
    await say("vengeance");
    await new Promise((r) => setTimeout(r, 700));
    document.body.classList.remove("vengeance");
    robot.classList.remove("vengeance");
    await new Promise((r) => setTimeout(r, 400));
    vengeful = false;
    say("sorry");
  }

  let cachedVoice;
  function chooseVoice() {
    if (cachedVoice !== undefined) return cachedVoice;
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return null;
    const prefs = ["Samantha", "Aria", "Jenny", "Google US English", "Zira", "Karen", "Moira", "Tessa"];
    cachedVoice =
      prefs.map((p) => voices.find((v) => v.name.includes(p))).find(Boolean) ||
      voices.find((v) => v.lang?.startsWith("en")) || null;
    return cachedVoice;
  }
  if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = () => { cachedVoice = undefined; };

  function stopSpeaking() {
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }

  // ---------- understanding typed messages (keyword matching) ----------
  const INTENTS = [
    ["vengeance", /hate (you|u)\b|shut up|\bstfu\b|f+u+c+k (you|u|off)|screw (you|u)|you suck|\bu suck|(stupid|dumb|ugly|useless|annoying|bad|worst|trash|garbage) (robot|bot|machine)|you('?re| are) (so )?(stupid|dumb|ugly|useless|annoying|trash|garbage|the worst)|\bidiot\b|\bloser\b|go away|unplug|delete (you|yourself)|scrap metal/],
    ["bit", /hot ?dog|hamburger|long ?ways|lengthwise|blick(y|ies|ey)|\bguns?\b|\bstrap(ped)?\b/],
    ["gw2", /guild ?wars|\bgw2?\b|tyria|skyscale|griffon|asura|charr|norn|sylvari|fractal|jumping puzzle|mystic forge|legendary|dailies|wvw|raid|strike/],
    ["mtg", /\bmagic\b|\bmtg\b|commander|\bdeck|mana|planeswalker|mulligan|draft|booster|\bedh\b|sealed|counterspell/],
    ["repo", /\brepo\b|r\.e\.p\.o|extraction|quota|valuables?|\btruck\b|monster/],
    ["comfort", /\bsad\b|upset|cry|crying|lonely|bad day|stress|anxious|anxiety|hurt|depress|awful|rough|\bmiss\b/],
    ["sleepy", /tired|sleepy|exhausted|\bbed\b|sleep|nap|yawn/],
    ["goodnight", /good ?night|\bgn\b|nighty|sweet dreams/],
    ["bored", /bored|nothing to do|boring/],
    ["joke", /joke|funny|laugh|make me smile|\blol\b/],
    ["love", /love you|ily|\bcute\b|adorable|best robot|good (robot|girl|boy|bot)|thank|\bthx\b|\bty\b/],
    ["compliment", /hype|ugly|confiden|insecure|am i (pretty|cool|smart|good)|nervous|\bexam\b|interview/],
    ["greeting", /^(hi|hey|hello|hiya|yo|sup|howdy|good morning|morning|gm)\b|what'?s up|how are you/],
  ];

  function understand(msg) {
    const m = msg.toLowerCase();
    for (const [cat, re] of INTENTS) if (re.test(m)) return cat;
    return "confused";
  }

  // ---------- interactions ----------
  robot.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    flash("boop", 400);
    if (vengeful) return;
    const now = Date.now();
    taps = taps.filter((t) => now - t < 5000);
    taps.push(now);
    // poke a little: flustered. poke way too much: VENGEANCE.
    if (taps.length >= 14) { taps = []; vengeance(); }
    else if (taps.length === 5) say("flustered");
    else if (taps.length > 5 && taps.length % 3 === 0) say("flustered");
    else if (taps.length < 5 && (taps.length === 1 || !speaking())) say("tap");
  });

  document.querySelectorAll(".chip").forEach((b) =>
    b.addEventListener("click", () => { if (!vengeful) say(b.dataset.cat); })
  );

  $("#chatForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#chatInput");
    const msg = input.value.trim();
    if (!msg) return;
    input.value = "";
    if (vengeful) return;
    const cat = understand(msg);
    if (cat === "vengeance") vengeance();
    else say(cat);
  });

  soundBtn.addEventListener("click", () => {
    soundOn = !soundOn;
    save("soundOn", soundOn ? "1" : "0");
    soundBtn.classList.toggle("muted", !soundOn);
    if (!soundOn) stopSpeaking();
  });
  soundBtn.classList.toggle("muted", !soundOn);

  // ---------- daily note ----------
  function today() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
  function dailyLine() {
    const pool = lines.filter((l) => l.cat === "daily");
    if (!pool.length) return null;
    let h = 0;
    for (const ch of today()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return pool[h % pool.length];
  }
  function refreshLetterDot() {
    letterBtn.querySelector(".dot").hidden = load("letterOpened", "") === today();
  }
  letterBtn.addEventListener("click", () => {
    const line = dailyLine();
    if (!line) return;
    save("letterOpened", today());
    refreshLetterDot();
    say(line);
  });

  // ---------- idle life ----------
  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (document.hidden || vengeful) return resetIdle();
      say("idle", { quiet: true, thought: true });
    }, 40000 + Math.random() * 40000);
  }

  (function blinkLoop() {
    setTimeout(() => {
      if (!robot.classList.contains("mood-sleepy")) flash("blink", 200);
      blinkLoop();
    }, 2200 + Math.random() * 3500);
  })();

  // eyes follow the cursor / finger a little
  window.addEventListener("pointermove", (e) => {
    const r = robot.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / window.innerWidth;
    const dy = (e.clientY - (r.top + r.height * 0.4)) / window.innerHeight;
    const eyes = robot.querySelector(".eyes-open");
    eyes.style.setProperty("--lx", (Math.max(-1, Math.min(1, dx * 2)) * 6).toFixed(1) + "px");
    eyes.style.setProperty("--ly", (Math.max(-1, Math.min(1, dy * 2)) * 4).toFixed(1) + "px");
  });

  // ---------- boot ----------
  async function getJSON(url) {
    try { const r = await fetch(url, { cache: "no-cache" }); return r.ok ? await r.json() : null; }
    catch { return null; }
  }

  async function boot() {
    const [cfg, ln, audio] = await Promise.all([
      getJSON("config.json"), getJSON("lines.json"), getJSON("audio/manifest.json"),
    ]);
    if (cfg) config = { ...config, ...cfg };
    lines = ln?.lines || [];
    if (audio) audioMap = Object.fromEntries(Object.entries(audio).map(([id, f]) => [id, "audio/" + f]));

    document.title = config.robotName;
    robot.setAttribute("aria-label", `${config.robotName} the robot. Tap to talk.`);
    $("#chatInput").placeholder = `say something to ${config.robotName}…`;

    applyPeriod();
    setMood(restingMood(), 0);
    refreshLetterDot();
    setInterval(applyPeriod, 30000);

    // first hello is silent: browsers block sound until the first tap
    setTimeout(() => say("greeting", { quiet: true }), 500);
  }

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  boot();
})();
