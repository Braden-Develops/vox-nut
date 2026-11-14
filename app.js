(() => {
  "use strict";

  // ---------- state ----------
  const $ = (s) => document.querySelector(s);
  const robot = $("#robot");
  const bubble = $("#bubble");
  const bubbleText = $("#bubbleText");
  const bubbleNote = $("#bubbleNote");
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
  let lastInteract = Date.now();

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
    greeting: "happy", comfort: "sad", joke: "happy", bored: "", compliment: "happy",
    sleepy: "sleepy", goodnight: "sleepy", flustered: "shy", tap: "happy", bit: "happy",
    gw2: "happy", mtg: "happy", repo: "happy", idle: "", daily: "shy", confused: "shy", love: "shy",
    vengeance: "", sorry: "shy", pet: "happy", welcomeback: "happy", hello: "happy", "hello-away": "happy",
  };

  // ---------- particles + fancy eyes ----------
  const fxLayer = $("#fx");
  const CONFETTI = ["#ff6f91", "#ffc94a", "#8ff5d2", "#c8a6ff", "#7cc6ff"];
  function spawn(chars, n = 6, kind = "heart", { spread = 120, rise = -130 } = {}) {
    if (!fxLayer || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (let i = 0; i < n; i++) {
      const p = document.createElement("span");
      p.className = "fx-p " + kind;
      if (kind === "confetti") p.style.setProperty("--c", CONFETTI[i % CONFETTI.length]);
      else p.textContent = chars[Math.floor(Math.random() * chars.length)];
      p.style.setProperty("--x", 50 + (Math.random() - 0.5) * 30 + "%");
      p.style.setProperty("--y", 22 + Math.random() * 18 + "%");
      p.style.setProperty("--dx", (Math.random() - 0.5) * spread + "px");
      p.style.setProperty("--dy", rise * (0.7 + Math.random() * 0.6) + "px");
      p.style.setProperty("--rot", (Math.random() - 0.5) * 120 + "deg");
      p.style.setProperty("--s", 14 + Math.random() * 14 + "px");
      p.style.setProperty("--delay", Math.random() * 0.5 + "s");
      p.addEventListener("animationend", () => p.remove());
      fxLayer.appendChild(p);
    }
  }

  let eyesTimer = null;
  function setEyes(kind, ms = 2500) {
    robot.classList.remove("show-love", "show-star");
    clearTimeout(eyesTimer);
    if (!kind) return;
    robot.classList.add("show-" + kind);
    if (ms) eyesTimer = setTimeout(() => robot.classList.remove("show-" + kind), ms);
  }

  // extra flair per category
  const FX = {
    greeting: () => flash("wave", 1600),
    compliment: () => {
      setEyes("star", 3000); flash("cheer", 1700);
      spawn("✦★✧", 8, "spark", { spread: 200 }); spawn("", 14, "confetti", { spread: 260, rise: -170 });
    },
    love: () => { setEyes("love", 3200); spawn("♥", 9, "heart"); },
    pet: () => { setEyes("love", petting ? 0 : 3000); if (!petting) spawn("♥", 6, "heart"); },
    welcomeback: () => { setEyes("love", 3000); flash("hop", 900); spawn("♥✦", 10, "heart", { spread: 200 }); },
    joke: () => flash("wiggle", 1400),
    flustered: () => spawn("!?", 3, "bang", { spread: 80, rise: -90 }),
    goodnight: () => spawn("z", 3, "zz", { spread: 60, rise: -80 }),
    daily: () => spawn("♥✦", 5, "heart"),
    bit: () => flash("boing", 1200),
    gw2: () => spawn("✦", 4, "spark"),
    mtg: () => spawn("✦", 4, "spark"),
    repo: () => flash("look", 1600),
    sorry: () => spawn("♥", 3, "heart", { spread: 60 }),
    unlock: () => { setEyes("star", 3000); flash("cheer", 1700); spawn("", 16, "confetti", { spread: 280, rise: -180 }); },
    streak: () => { flash("hop", 900); spawn("✦★", 8, "spark", { spread: 200 }); },
    wardrobe: () => { flash("hop", 900); spawn("✦", 6, "spark", { spread: 160 }); },
    remember: () => { flash("boing", 1200); spawn("✦", 3, "spark", { spread: 60 }); },
    event: () => spawn("✦★", 6, "spark", { spread: 180 }),
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
  function say(what, { quiet = false, thought = false, note = "" } = {}) {
    const line = typeof what === "string" ? pick(what) : what;
    if (!line) return;
    lastCat = line.cat;
    const text = fill(line.text);

    stopSpeaking();
    bubble.classList.toggle("thought", thought);
    bubbleNote.textContent = "";
    bubble.classList.add("show");
    setMood(line.mood ?? MOODS[line.cat] ?? "", Math.max(4000, text.length * 70));
    if (!thought) (FX[line.cat] || FX[line.cat.split("-")[0]])?.();
    lastInteract = Date.now();

    // typewriter (resolves when the text is fully shown)
    clearTimeout(typeTimer);
    let i = 0;
    bubbleText.textContent = "";
    const typed = new Promise((done) => {
      const fast = line.cat === "vengeance";
      const step = () => {
        bubbleText.textContent = text.slice(0, ++i);
        if (i < text.length) typeTimer = setTimeout(step, text[i - 1].match(/[.,!?…]/) ? (fast ? 260 : 140) : (fast ? 55 : 26));
        else { if (!speaking()) robot.classList.remove("talking"); bubbleNote.textContent = note; done(); }
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
    await say("sorry");
    S.vengeances = (S.vengeances || 0) + 1;
    store.save();
    if (S.vengeances >= 3 && unlockSecret("horns")) {
      S.announced.push("horns"); store.save();
      await sleep(500);
      say("unlock", { note: "😈 Secret unlocked: Horns" });
    }
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
    ["dance", /\bdance|dancing|boogie|groove/],
    ["pet", /head ?pats?|\bpats?\b|\bpet(s|ting)?\b|scritch|\bhug(s|gies)?\b/],
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
  // tap = boop. press and hold = head pats.
  let holdTimer = null, petting = false, petHearts = null, pressed = false;

  function tap() {
    const now = Date.now();
    taps = taps.filter((t) => now - t < 5000);
    taps.push(now);
    // poke a little: flustered. poke way too much: VENGEANCE.
    if (taps.length >= 14) { taps = []; vengeance(); }
    else if (taps.length === 5) say("flustered");
    else if (taps.length > 5 && taps.length % 3 === 0) say("flustered");
    else if (taps.length < 5 && (taps.length === 1 || !speaking())) say("tap");
  }

  function startPet() {
    petting = true;
    taps = [];
    robot.classList.add("petting");
    say("pet");
    spawn("♥", 3, "heart");
    petHearts = setInterval(() => spawn("♥", 1, "heart", { spread: 90 }), 380);
  }

  function endPress() {
    pressed = false;
    clearTimeout(holdTimer);
    if (!petting) return false;
    petting = false;
    clearInterval(petHearts);
    robot.classList.remove("petting");
    setEyes(null);
    setMood("happy", 1800);
    lastInteract = Date.now();
    return true;
  }

  robot.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    flash("boop", 400);
    lastInteract = Date.now();
    if (vengeful) return;
    pressed = true;
    try { robot.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    holdTimer = setTimeout(startPet, 450);
  });
  robot.addEventListener("pointerup", () => {
    if (!pressed) return;
    if (endPress() || vengeful) return;
    if (lightsOffNow()) { lights(false); say("egg-lightson"); return; }
    tap();
  });
  robot.addEventListener("pointercancel", endPress);
  robot.addEventListener("contextmenu", (e) => e.preventDefault());

  document.querySelectorAll(".chip").forEach((b) =>
    b.addEventListener("click", () => { if (!vengeful) { pending = null; say(b.dataset.cat); } })
  );

  $("#chatForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#chatInput");
    const msg = input.value.trim();
    if (!msg) return;
    input.value = "";
    if (vengeful) return;
    if (asleep) { wake(); return; }
    pending = null;
    const low = msg.toLowerCase();
    if (lightsOffNow() && !/lights? (off|out)/.test(low)) lights(false);
    if (egg(low) || memory(low)) return;
    let cat = understand(msg);
    if (cat === "confused" && isYesNo(low)) cat = "egg-8ball";
    if (cat === "vengeance") vengeance();
    else if (cat === "dance") {
      showThought("Dance mode! Beep boop, beep boop.");
      flash("dance", 3200); setMood("happy", 3200);
      spawn("♪♫", 8, "note", { spread: 180 });
    }
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
      if (document.hidden || vengeful || asleep) return resetIdle();
      const memo = Math.random() < 0.4 && memoryThought();
      if (memo) showThought(memo);
      else say("idle", { quiet: true, thought: true });
    }, 40000 + Math.random() * 40000);
  }

  // a thought bubble with no voice and no line (used by little animations)
  function showThought(text) {
    clearTimeout(typeTimer);
    bubble.classList.add("show", "thought");
    bubbleText.textContent = text;
    bubbleNote.textContent = "";
  }

  // little animations to play when nobody is interacting
  const notes = () => spawn("♪♫", 5, "note", { spread: 140 });
  const IDLE_DAY = [
    ["look", 1600], ["wiggle", 1400], ["flip", 900], ["hop", 900], ["boing", 1200],
    ["hum", 3000, notes], ["stretch", 1800, () => setMood("happy", 1800)],
    ["sneeze", 1600, () => { setMood("sleepy", 850); setTimeout(() => { showThought("Achoo!"); spawn("✦", 4, "spark", { spread: 90, rise: -70 }); }, 900); }],
    ["dance", 3200, () => { setMood("happy", 3200); notes(); }],
    ["glitch", 700], ["hearts", 2200, () => { setEyes("love", 2200); spawn("♥", 6, "heart"); }],
  ];
  const IDLE_NIGHT = [
    ["nod", 2600, () => setMood("sleepy", 2000)], ["yawn", 2200, () => setMood("sleepy", 2200)],
    ["stargaze", 2600, () => spawn("✦", 5, "spark", { spread: 160, rise: -150 })],
    ["look", 1600], ["hum", 3000, notes], ["wiggle", 1400], ["hearts", 2200, () => { setEyes("love", 2200); spawn("♥", 4, "heart"); }],
  ];
  let lastIdleAnim = "";
  (function idleAnimLoop() {
    setTimeout(() => {
      const busy = document.hidden || asleep || vengeful || petting || pressed || speaking() ||
        robot.classList.contains("talking") || Date.now() - lastInteract < 4000;
      if (!busy) {
        const list = period() === "night" ? IDLE_NIGHT : IDLE_DAY;
        let pick;
        do pick = list[Math.floor(Math.random() * list.length)]; while (pick[0] === lastIdleAnim && list.length > 1);
        lastIdleAnim = pick[0];
        flash(pick[0], pick[1]);
        pick[2]?.();
      }
      idleAnimLoop();
    }, 6000 + Math.random() * 9000);
  })();

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

  // =========================================================
  // Saved state. Lives in this browser only (localStorage), so
  // her phone and computer each keep their own. Everything goes
  // through `store` so a sync backend can be swapped in later.
  // =========================================================
  const store = (() => {
    const KEY = "cherry:state";
    let s = {};
    try { s = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { s = {}; }
    s = {
      days: [], streak: 0, best: 0, lastDay: "", secrets: [], announced: [], seenUnlocks: [],
      equipped: {}, vengeances: 0, memory: {}, ...s,
    };
    s.memory = { favorites: {}, likes: [], events: [], ...s.memory };
    return {
      get: () => s,
      save() { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: oh well */ } },
    };
  })();
  const S = store.get();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function dayKey(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function shiftDay(n) { const d = new Date(); d.setDate(d.getDate() + n); return dayKey(d); }

  // ---------- streaks ----------
  const STREAK_MILESTONES = [2, 3, 4, 5, 7, 10, 14, 21, 30, 50, 100];
  function trackVisit() {
    const t = dayKey();
    if (S.lastDay === t) return false;
    S.streak = S.lastDay === shiftDay(-1) ? S.streak + 1 : 1;
    S.best = Math.max(S.best, S.streak);
    S.lastDay = t;
    if (!S.days.includes(t)) S.days.push(t);
    store.save();
    return true;
  }
  function renderStreak() {
    const el = $("#streak");
    el.hidden = S.streak < 2;
    el.textContent = `🔥 ${S.streak}`;
    el.title = `${S.streak}-day streak (best ${S.best})`;
  }

  // ---------- wardrobe ----------
  // days: unlocked after visiting on that many different days. secret: unlocked some other way.
  const WARDROBE = [
    { id: "bow", slot: "head", name: "Bow", ico: "🎀", days: 2 },
    { id: "shades", slot: "face", name: "Shades", ico: "😎", days: 3 },
    { id: "mint", slot: "skin", name: "Mint", color: "#7fe0bd", days: 4 },
    { id: "flowers", slot: "head", name: "Flowers", ico: "🌸", days: 5 },
    { id: "lavender", slot: "skin", name: "Lavender", color: "#c4adf2", days: 6 },
    { id: "party", slot: "head", name: "Party hat", ico: "🥳", days: 7 },
    { id: "headphones", slot: "head", name: "Headphones", ico: "🎧", days: 9 },
    { id: "wizard", slot: "head", name: "Wizard hat", ico: "🧙", days: 10 },
    { id: "sky", slot: "skin", name: "Sky", color: "#8cc8f2", days: 12 },
    { id: "crown", slot: "head", name: "Crown", ico: "👑", days: 14 },
    { id: "heartshades", slot: "face", name: "Heart shades", ico: "😍", days: 17 },
    { id: "peach", slot: "skin", name: "Peach", color: "#ffbe95", days: 20 },
    { id: "gold", slot: "skin", name: "Gold", color: "#f2cf5b", days: 25 },
    { id: "halo", slot: "head", name: "Halo", ico: "😇", days: 30 },
    { id: "horns", slot: "head", name: "Horns", ico: "😈", secret: "Survive VENGEANCE three times." },
    { id: "midnight", slot: "skin", name: "Midnight", color: "#4a4275", secret: "Visit me after midnight." },
    { id: "rainbow", slot: "skin", name: "Rainbow", color: "conic-gradient(#ff5c8a,#ffc94a,#8ff5d2,#7cc6ff,#c8a6ff,#ff5c8a)", secret: "A secret code. Keyboards only." },
  ];
  const ALL_UNLOCKED = params.has("unlockall");
  const isUnlocked = (it) => ALL_UNLOCKED || (it.days ? S.days.length >= it.days : S.secrets.includes(it.id));

  function unlockSecret(id) {
    if (S.secrets.includes(id)) return false;
    S.secrets.push(id);
    store.save();
    refreshWardrobeDot();
    return true;
  }
  function freshUnlocks() {
    const fresh = WARDROBE.filter((it) => isUnlocked(it) && !S.announced.includes(it.id));
    if (fresh.length) { S.announced.push(...fresh.map((i) => i.id)); store.save(); }
    return fresh;
  }

  function applyOutfit() {
    [...robot.classList].forEach((c) => { if (c.startsWith("wear-") || c.startsWith("skin-")) robot.classList.remove(c); });
    for (const slot of ["head", "face", "skin"]) {
      const it = WARDROBE.find((i) => i.id === S.equipped[slot]);
      if (it && isUnlocked(it)) robot.classList.add((slot === "skin" ? "skin-" : "wear-") + it.id);
    }
  }
  function refreshWardrobeDot() {
    $("#wardrobeBtn .dot").hidden = !WARDROBE.some((it) => isUnlocked(it) && !S.seenUnlocks.includes(it.id));
  }

  const wardrobe = $("#wardrobe");
  let outfitChanged = false;
  function renderWardrobe(hint) {
    $("#wardrobeSub").textContent = hint ||
      `${S.days.length} day${S.days.length === 1 ? "" : "s"} visited · streak ${S.streak} · best ${S.best}`;
    for (const grid of wardrobe.querySelectorAll(".grid")) {
      const slot = grid.dataset.slot;
      grid.replaceChildren();
      const none = { id: "", slot, name: slot === "skin" ? "Classic" : "None", ico: "✕", color: slot === "skin" ? "#fff3f6" : null };
      for (const it of [none, ...WARDROBE.filter((i) => i.slot === slot)]) {
        const ok = !it.id || isUnlocked(it);
        const b = document.createElement("button");
        b.type = "button";
        b.className = "item";
        b.classList.toggle("locked", !ok);
        b.classList.toggle("on", (S.equipped[slot] || "") === it.id);
        b.classList.toggle("new", ok && !!it.id && !S.seenUnlocks.includes(it.id));
        const ico = document.createElement("span");
        ico.className = "ico";
        if (ok && it.color) ico.style.background = it.color;
        else ico.textContent = ok ? it.ico : "🔒";
        const label = document.createElement("span");
        label.textContent = ok ? it.name : it.days ? `Day ${it.days}` : "???";
        b.append(ico, label);
        b.addEventListener("click", () => {
          if (!ok) {
            const left = it.days - S.days.length;
            return renderWardrobe(it.days
              ? `Visit me on ${left} more day${left === 1 ? "" : "s"} to unlock that one!`
              : `Secret: ${it.secret}`);
          }
          S.equipped[slot] = it.id;
          store.save();
          outfitChanged = true;
          applyOutfit();
          renderWardrobe();
        });
        grid.append(b);
      }
    }
  }
  $("#wardrobeBtn").addEventListener("click", () => {
    outfitChanged = false;
    renderWardrobe();
    wardrobe.showModal();
  });
  wardrobe.addEventListener("click", (e) => { if (e.target === wardrobe) wardrobe.close(); });
  wardrobe.addEventListener("close", () => {
    S.seenUnlocks = WARDROBE.filter(isUnlocked).map((i) => i.id);
    store.save();
    refreshWardrobeDot();
    if (outfitChanged && !vengeful) say("wardrobe");
  });

  // ---------- memory ----------
  const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const WHEN = "(today|tonight|tomorrow|this (?:morning|afternoon|evening)|(?:on |this |next )?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday))";
  const MEM = {
    recall: /what do you (remember|know)( about me)?|do you remember (me|anything)|your memor(y|ies)/,
    forget: /forget (everything|me|all|it all)|wipe (your|ur) memory|clear (your|ur) memory/,
    event: [
      new RegExp(`\\bi(?: have|'ve got| got| have got) (?:a|an|my|the|this) ([a-z' ]{2,30}?) ${WHEN}`),
      new RegExp(`\\bmy ([a-z' ]{2,30}?) is ${WHEN}`),
    ],
    fav: /\bmy fav(?:ou?rite)? ([a-z ]{2,24}?) (?:is|are) ([^.!?,]{1,40})/,
    like: /\bi (?:really |totally |just )?(?:love|like|adore|enjoy) ([^.!?,]{2,40})/,
  };
  const NOT_A_LIKE = /^(you|u|ya|ur|your|it|that|this|them|him|her|when|how|to|being|the way)\b/;

  function whenToDate(w) {
    const d = new Date();
    if (/tomorrow/.test(w)) d.setDate(d.getDate() + 1);
    const m = w.match(/sunday|monday|tuesday|wednesday|thursday|friday|saturday/);
    if (m) {
      let diff = (WEEKDAYS.indexOf(m[0]) - d.getDay() + 7) % 7;
      if (diff === 0 && !/this/.test(w)) diff = 7; // "on friday" said on a friday means next week
      d.setDate(d.getDate() + diff);
    }
    return dayKey(d);
  }
  const tidy = (t) => t.trim().replace(/\s+(so much|a lot|too|very much|lots)$/, "").replace(/\s+/g, " ");

  // returns true if the message was about memory
  function memory(m) {
    const mem = S.memory;
    if (MEM.recall.test(m)) {
      const facts = [
        ...Object.entries(mem.favorites).map(([k, v]) => `Favorite ${k}: ${v}`),
        ...mem.likes.map((l) => `You love ${l}`),
        ...mem.events.map((e) => `${e.what[0].toUpperCase() + e.what.slice(1)}: ${new Date(e.date + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}`),
      ];
      say(facts.length ? "recall" : "recall-empty", { note: facts.slice(0, 8).join("\n") });
      return true;
    }
    if (MEM.forget.test(m)) {
      S.memory = { favorites: {}, likes: [], events: [] };
      store.save();
      say("forget");
      return true;
    }
    for (const re of MEM.event) {
      const e = m.match(re);
      if (e) {
        const what = tidy(e[1]);
        const date = whenToDate(e[2]);
        mem.events = mem.events.filter((x) => x.what !== what);
        mem.events.push({ what, date, said: [] });
        store.save();
        const when = date === dayKey() ? "today" : date === shiftDay(1) ? "tomorrow" :
          new Date(date + "T12:00").toLocaleDateString([], { weekday: "long" });
        say("remember", { note: `📝 Your ${what} is ${when}. I'll remember.` });
        return true;
      }
    }
    const f = m.match(MEM.fav);
    if (f) {
      mem.favorites[tidy(f[1])] = tidy(f[2]);
      store.save();
      say("remember", { note: `📝 Favorite ${tidy(f[1])}: ${tidy(f[2])}` });
      return true;
    }
    const l = m.match(MEM.like);
    if (l && !NOT_A_LIKE.test(l[1].trim())) {
      const what = tidy(l[1]);
      mem.likes = [what, ...mem.likes.filter((x) => x !== what)].slice(0, 12);
      store.save();
      say("remember", { note: `📝 You love ${what}` });
      return true;
    }
    return false;
  }

  // something Vox Nut remembers, said as a silent idle thought
  function memoryThought() {
    const mem = S.memory, opts = [];
    for (const [k, v] of Object.entries(mem.favorites)) opts.push(`I was just thinking about ${v}. Your favorite ${k}.`);
    for (const l of mem.likes) opts.push(`Fun fact I know: you love ${l}.`, `Thinking about ${l}. Because you like it. So I like it.`);
    for (const e of mem.events) {
      const days = Math.round((new Date(e.date + "T12:00") - new Date(dayKey() + "T12:00")) / 864e5);
      if (days > 1) opts.push(`${days} days until your ${e.what}. You've got this.`);
    }
    return opts.length ? opts[Math.floor(Math.random() * opts.length)] : null;
  }

  // good luck / how did it go, once per day per event
  function eventAnnouncements(q) {
    const t = dayKey();
    const keep = [];
    for (const e of S.memory.events) {
      e.said = e.said || [];
      if (e.date === t && !e.said.includes("today")) {
        e.said.push("today");
        q.push({ cat: "event-today", note: `✨ Your ${e.what} is today!` });
      } else if (e.date === shiftDay(1) && !e.said.includes("tomorrow")) {
        e.said.push("tomorrow");
        q.push({ cat: "event-tomorrow", note: `Your ${e.what} is tomorrow.` });
      } else if (e.date < t) {
        q.push({ cat: "event-after", note: `How was your ${e.what}?` });
        continue; // asked once, then forgotten
      }
      keep.push(e);
    }
    S.memory.events = keep;
    store.save();
  }

  // ---------- hidden commands ----------
  function bodyFlash(cls, ms) {
    document.body.classList.add(cls);
    setTimeout(() => document.body.classList.remove(cls), ms);
  }
  function restyle(cls) {
    robot.classList.remove("hotdog", "hamburger");
    robot.classList.add(cls);
    setTimeout(() => robot.classList.remove(cls), 4000);
  }
  function lights(off) { document.body.classList.toggle("lightsoff", off); }
  const lightsOffNow = () => document.body.classList.contains("lightsoff");
  function heartRain(n = 40) {
    const layer = $("#rain");
    for (let i = 0; i < n; i++) {
      const h = document.createElement("span");
      h.textContent = Math.random() < 0.85 ? "♥" : "✦";
      h.style.left = Math.random() * 100 + "%";
      h.style.setProperty("--s", 14 + Math.random() * 22 + "px");
      h.style.setProperty("--d", 2.4 + Math.random() * 2.2 + "s");
      h.style.setProperty("--delay", Math.random() * 2 + "s");
      h.style.setProperty("--r", (Math.random() - 0.5) * 360 + "deg");
      h.addEventListener("animationend", () => h.remove());
      layer.append(h);
    }
  }
  function replay(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

  const EGGS = [
    [/\broll\b|\bd ?20\b|\bdice\b/, () => {
      const n = 1 + Math.floor(Math.random() * 20);
      say(`egg-d20-${n}`, { note: `🎲 ${n}` });
      if (n === 20) { setEyes("star", 3000); flash("cheer", 1700); spawn("", 18, "confetti", { spread: 300, rise: -190 }); }
      else if (n === 1) { flash("glitch", 700); setMood("sad", 3000); }
      else flash("hop", 900);
    }],
    [/flip a coin|coin ?flip|heads or tails|who goes first|toss a coin/, () => {
      const heads = Math.random() < 0.5;
      flash("flip", 900);
      say(heads ? "egg-coin-heads" : "egg-coin-tails", { note: heads ? "🪙 Heads" : "🪙 Tails" });
    }],
    [/\bdisco\b|\bparty\b/, () => {
      bodyFlash("disco", 6000);
      say("egg-disco");
      flash("dance", 3200);
      spawn("♪♫", 10, "note", { spread: 220 });
      spawn("", 18, "confetti", { spread: 300, rise: -200 });
    }],
    [/lights? (off|out)|turn off the lights?/, () => { lights(true); say("egg-lightsoff"); }],
    [/lights? on|turn on the lights?/, () => { lights(false); say("egg-lightson"); }],
    [/hot ?dog (style|mode)/, () => { restyle("hotdog"); say("egg-hotdog"); }],
    [/hamburger (style|mode)/, () => { restyle("hamburger"); say("egg-hamburger"); }],
    [/\bcheese\b|selfie|take a (picture|photo|pic)/, () => {
      setMood("happy", 3000);
      setTimeout(() => replay($("#shutter"), "flash"), 500);
      say("egg-selfie");
    }],
    [/sky ?scale|\bdragon/, () => {
      replay($("#dragon"), "fly");
      say("egg-skyscale");
      setTimeout(() => flash("look", 1600), 400);
    }],
    [/make it rain|rain(ing)? hearts?|\brain\b/, () => { heartRain(); say("egg-rain"); }],
    [/\bvox ?nut\b|^vox\b/, () => { flash("hop", 900); say("egg-name"); }],
    [/\bsing\b|a song/, () => { flash("hum", 3000); spawn("♪♫", 8, "note", { spread: 160 }); say("egg-sing"); }],
    [/\bspin\b|do a flip|barrel roll/, () => { flash("flip", 900); setTimeout(() => flash("flip", 900), 950); say("egg-spin"); }],
    [/secret|easter egg|\bhints?\b|what can you do|commands/, () => say("egg-secret")],
  ];
  function egg(m) {
    for (const [re, fn] of EGGS) if (re.test(m)) { fn(); return true; }
    return false;
  }
  const isYesNo = (m) => /\?\s*$/.test(m) &&
    /^(should|will|is|am|are|do|does|did|can|could|would|was|were|shall|may|might|has|have|r)\b/.test(m);

  // up up down down left right left right b a  (keyboard only)
  const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
  let konamiAt = 0;
  window.addEventListener("keydown", (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    konamiAt = k === KONAMI[konamiAt] ? konamiAt + 1 : (k === KONAMI[0] ? 1 : 0);
    if (konamiAt === KONAMI.length) {
      konamiAt = 0;
      unlockSecret("rainbow");
      S.equipped.skin = "rainbow";
      store.save();
      applyOutfit();
      bodyFlash("disco", 4000);
      say("unlock", { note: "🌈 Secret unlocked: Rainbow" });
    }
  });

  // ---------- tap to wake: the big excited hello ----------
  // Browsers block sound until the first tap, so Vox Nut starts asleep. Her first tap
  // anywhere wakes it up with a loud, happy "Hi Cherry!!! I missed you!", then any news.
  let pending = null;
  let asleep = false;
  let wakeCat = "hello";

  async function playPending() {
    const q = pending || [];
    pending = null;
    for (const a of q) {
      await sleep(450);
      await say(a.cat, { note: a.note });
    }
  }

  async function wake() {
    if (!asleep) return;
    asleep = false;
    document.body.classList.remove("asleep");
    lastInteract = Date.now();
    setEyes("love", 3500);
    flash("cheer", 1700);
    spawn("♥", 10, "heart", { spread: 240 });
    spawn("", 22, "confetti", { spread: 330, rise: -210 });
    await say(wakeCat);
    await playPending();
  }

  // first touch anywhere (except the top buttons / wardrobe) wakes it, and isn't also treated as a tap
  document.addEventListener("pointerdown", (e) => {
    if (!asleep || e.target.closest(".topbar, dialog")) return;
    e.stopPropagation();
    e.preventDefault();
    document.addEventListener("click", (c) => { c.stopPropagation(); c.preventDefault(); }, { capture: true, once: true });
    wake();
  }, true);

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

    // been away a couple of days? extra happy to see her
    const last = Number(load("lastVisit", "0"));
    const away = last && Date.now() - last > 2 * 864e5;
    save("lastVisit", String(Date.now()));
    document.addEventListener("visibilitychange", () => save("lastVisit", String(Date.now())));

    // streaks, unlocks, outfit
    const newDay = trackVisit();
    if (new Date().getHours() < 4) unlockSecret("midnight");
    applyOutfit();
    renderStreak();
    refreshWardrobeDot();

    // what to say first: events > unlocks > streak > welcome back > hello
    const q = [];
    eventAnnouncements(q);
    const fresh = freshUnlocks();
    if (fresh.length && S.days.length > 1) {
      q.push({ cat: "unlock", note: `Unlocked: ${fresh.map((i) => i.name).join(", ")}` });
    }
    if (newDay && STREAK_MILESTONES.includes(S.streak)) q.push({ cat: `streak-${S.streak}`, note: `🔥 ${S.streak}-day streak` });
    wakeCat = away || params.has("welcome") ? (Math.random() < 0.5 ? "hello-away" : "welcomeback") : "hello";

    // asleep until her first tap (that tap also unlocks sound)
    pending = q;
    asleep = true;
    document.body.classList.add("asleep");
    setMood("sleepy", 0);
    const hint = lines.find((l) => l.cat === "wake-hint");
    setTimeout(() => { if (asleep) showThought(hint ? fill(hint.text) : "Psst. Tap me to wake me up."); }, 400);
  }

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  boot();
})();
