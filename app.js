(() => {
  "use strict";

  const QUESTIONS = Array.isArray(window.ENGLISH_QUESTIONS) ? window.ENGLISH_QUESTIONS : [];
  const LETTERS = ["A", "B", "C", "D"];
  const QUESTION_IDS = new Set(QUESTIONS.map((question) => question.id));
  const STORAGE = {
    wrong: "capEnglishFighter113_wrong_v1",
    best: "capEnglishFighter113_best_v1",
    prefs: "capEnglishFighter113_prefs_v1"
  };

  const FIGHTERS = [
    {
      id: "wordsmith", name: "字彙騎士", title: "WORD KNIGHT", icon: "🗡️",
      color: "#a98bff", glow: "rgba(169,139,255,.45)",
      passive: "字根連擊｜連續答對第2題起，每次攻擊傷害＋3。",
      special: "VOCAB SLASH｜造成18點直接傷害。"
    },
    {
      id: "grammar", name: "文法法師", title: "GRAMMAR MAGE", icon: "🔮",
      color: "#50dcff", glow: "rgba(80,220,255,.42)",
      passive: "文法護盾｜每場第一次答錯不扣血。",
      special: "TENSE RESET｜恢復20點生命。"
    },
    {
      id: "reader", name: "閱讀遊俠", title: "READING RANGER", icon: "📖",
      color: "#63f5a5", glow: "rgba(99,245,165,.42)",
      passive: "線索回復｜每次答對額外恢復3點生命。",
      special: "CONTEXT BURST｜造成14點傷害並恢復8點生命。"
    }
  ];

  const $ = (id) => document.getElementById(id);
  const screens = [$("splashScreen"), $("setupScreen"), $("battleScreen"), $("resultScreen")];
  const state = {
    fighterId: "wordsmith", deck: [], index: 0, playerHp: 100, bossHp: 100, bossMax: 100,
    streak: 0, maxStreak: 0, energy: 0, correct: 0, attempted: 0,
    answerLocked: false, timer: 75, timerId: null, finishTimeoutId: null, grammarShieldUsed: false,
    sound: true, reducedMotion: false, highContrast: false, retryMode: false
  };

  function safeParse(value, fallback) {
    try { return JSON.parse(value) ?? fallback; } catch { return fallback; }
  }

  function getWrongIds() {
    const value = safeParse(localStorage.getItem(STORAGE.wrong), []);
    return new Set(Array.isArray(value) ? value.filter((id) => typeof id === "string" && QUESTION_IDS.has(id)) : []);
  }

  function saveWrongIds(set) {
    localStorage.setItem(STORAGE.wrong, JSON.stringify([...set]));
    updateWrongButtons();
  }

  function shuffle(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function currentFighter() {
    return FIGHTERS.find((fighter) => fighter.id === state.fighterId) || FIGHTERS[0];
  }

  function showScreen(screen) {
    screens.forEach((item) => { item.hidden = item !== screen; });
    window.scrollTo({ top: 0, behavior: state.reducedMotion ? "auto" : "smooth" });
  }

  function playTone(kind = "select") {
    if (!state.sound) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const settings = {
        select: [330, 0.05], correct: [660, 0.12], wrong: [120, 0.16], special: [880, 0.22]
      }[kind] || [330, 0.05];
      oscillator.frequency.setValueAtTime(settings[0], context.currentTime);
      if (kind === "correct" || kind === "special") {
        oscillator.frequency.exponentialRampToValueAtTime(settings[0] * 1.6, context.currentTime + settings[1]);
      }
      gain.gain.setValueAtTime(0.045, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + settings[1]);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + settings[1]);
      oscillator.addEventListener("ended", () => context.close());
    } catch {
      // Audio is optional; browsers may deny it outside a user gesture.
    }
  }

  function renderFighters() {
    const grid = $("fighterGrid");
    grid.replaceChildren();
    FIGHTERS.forEach((fighter) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "fighter-option";
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(state.fighterId === fighter.id));
      button.style.setProperty("--fighter-color", fighter.color);
      button.style.setProperty("--fighter-glow", fighter.glow);
      button.dataset.fighterId = fighter.id;
      const selectedTag = document.createElement("span");
      selectedTag.className = "selected-tag";
      selectedTag.textContent = "已選擇";
      const visual = document.createElement("span");
      visual.className = "fighter-visual";
      visual.setAttribute("aria-hidden", "true");
      visual.textContent = fighter.icon;
      const copy = document.createElement("span");
      copy.className = "fighter-copy";
      const title = document.createElement("span");
      title.textContent = fighter.title;
      const name = document.createElement("h2");
      name.textContent = fighter.name;
      const passive = document.createElement("p");
      const passiveLabel = document.createElement("strong");
      passiveLabel.textContent = "被動";
      passive.append(passiveLabel, `　${fighter.passive}`);
      const special = document.createElement("p");
      const specialLabel = document.createElement("strong");
      specialLabel.textContent = "大招";
      special.append(specialLabel, `　${fighter.special}`);
      copy.append(title, name, passive, special);
      button.append(selectedTag, visual, copy);
      button.addEventListener("click", () => {
        state.fighterId = fighter.id;
        renderFighters();
        playTone("select");
      });
      grid.append(button);
    });
  }

  function updateWrongButtons() {
    const count = getWrongIds().size;
    $("wrongCount").textContent = String(count);
    $("retryWrongButton").disabled = count === 0;
    $("resultWrongButton").disabled = count === 0;
  }

  function cancelPendingFinish() {
    if (state.finishTimeoutId !== null) window.clearTimeout(state.finishTimeoutId);
    state.finishTimeoutId = null;
  }

  function showSetup() {
    stopTimer();
    cancelPendingFinish();
    state.answerLocked = true;
    $("feedbackPanel").hidden = true;
    if ($("lightbox").open) $("lightbox").close();
    renderFighters();
    updateWrongButtons();
    showScreen($("setupScreen"));
  }

  function startBattle(retryWrong = false) {
    cancelPendingFinish();
    let pool = QUESTIONS;
    if (retryWrong) {
      const wrong = getWrongIds();
      pool = QUESTIONS.filter((question) => wrong.has(question.id));
      if (!pool.length) {
        showSetup();
        return;
      }
    }
    state.deck = retryWrong ? shuffle(pool) : shuffle(pool).slice(0, Math.min(12, pool.length));
    state.index = 0;
    state.playerHp = 100;
    state.bossMax = Math.max(72, state.deck.length * 12);
    state.bossHp = state.bossMax;
    state.streak = 0;
    state.maxStreak = 0;
    state.energy = 0;
    state.correct = 0;
    state.attempted = 0;
    state.answerLocked = false;
    state.grammarShieldUsed = false;
    state.retryMode = retryWrong;
    const fighter = currentFighter();
    $("playerPortrait").textContent = fighter.icon;
    $("arenaPlayer").textContent = fighter.icon;
    $("playerName").textContent = fighter.name;
    showScreen($("battleScreen"));
    updateHud();
    renderQuestion();
    playTone("select");
  }

  function updateHud() {
    const playerPercent = Math.max(0, state.playerHp);
    const bossPercent = Math.max(0, (state.bossHp / state.bossMax) * 100);
    $("playerHpBar").style.width = `${playerPercent}%`;
    $("bossHpBar").style.width = `${bossPercent}%`;
    $("playerHpText").textContent = `${Math.max(0, state.playerHp)} / 100`;
    $("bossHpText").textContent = `${Math.max(0, state.bossHp)} / ${state.bossMax}`;
    $("streakLabel").textContent = `COMBO ${state.streak}`;
    $("energyBar").style.width = `${state.energy}%`;
    $("energyText").textContent = `${state.energy}%`;
    const ready = state.energy >= 100;
    $("specialButton").disabled = !ready || state.answerLocked;
    $("specialButton").textContent = ready ? `⚡ ${specialName()}` : "⚡ 大招尚未充滿";
  }

  function specialName() {
    return { wordsmith: "VOCAB SLASH", grammar: "TENSE RESET", reader: "CONTEXT BURST" }[state.fighterId];
  }

  function makeImageButton(src, label, isContext = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "image-button";
    button.setAttribute("aria-label", `放大${label}`);
    if (isContext) {
      const contextLabel = document.createElement("span");
      contextLabel.className = "context-label";
      contextLabel.textContent = "共用題組資料";
      button.append(contextLabel);
    }
    const image = document.createElement("img");
    image.src = src;
    image.alt = label;
    image.loading = "eager";
    image.decoding = "async";
    image.addEventListener("error", () => {
      button.disabled = true;
      button.textContent = `題圖載入失敗：${src}`;
    });
    button.append(image);
    button.addEventListener("click", () => openLightbox(src, label));
    return button;
  }

  function renderQuestion() {
    stopTimer();
    if (state.index >= state.deck.length || state.playerHp <= 0 || state.bossHp <= 0) {
      finishBattle();
      return;
    }
    state.answerLocked = false;
    const question = state.deck[state.index];
    $("roundNumber").textContent = String(state.index + 1);
    $("roundTotal").textContent = `/${state.deck.length}`;
    $("unitChip").textContent = question.unit;
    $("questionNumber").textContent = `113會考第${question.number}題`;
    $("difficultyChip").textContent = question.difficulty;
    $("feedbackPanel").hidden = true;

    const media = $("questionMedia");
    media.replaceChildren();
    question.contextImages.forEach((src, index) => {
      media.append(makeImageButton(src, `第${question.number}題共用資料${index + 1}`, true));
    });
    question.images.forEach((src, index) => {
      media.append(makeImageButton(src, `113年會考英語閱讀第${question.number}題題圖${index + 1}`));
    });

    const answers = $("answerGrid");
    answers.replaceChildren();
    LETTERS.forEach((letter, answerIndex) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "answer-button";
      button.dataset.answerIndex = String(answerIndex);
      button.setAttribute("aria-label", `選擇${letter}選項`);
      const answerText = document.createElement("span");
      answerText.textContent = letter;
      button.append(answerText);
      button.addEventListener("click", () => submitAnswer(answerIndex));
      answers.append(button);
    });
    updateHud();
    startTimer();
  }

  function startTimer() {
    state.timer = 75;
    updateTimer();
    state.timerId = window.setInterval(() => {
      state.timer -= 1;
      updateTimer();
      if (state.timer <= 0) submitAnswer(-1);
    }, 1000);
  }

  function stopTimer() {
    if (state.timerId) window.clearInterval(state.timerId);
    state.timerId = null;
  }

  function updateTimer() {
    $("timerText").textContent = String(Math.max(0, state.timer));
    $("timerBar").style.width = `${Math.max(0, state.timer / 75 * 100)}%`;
    $("timerBar").style.background = state.timer <= 10 ? "var(--danger)" : "var(--warning)";
  }

  function animateCombat(attacker, damage, label) {
    const player = $("arenaPlayer");
    const boss = $("arenaBoss");
    player.classList.remove("attack", "hit");
    boss.classList.remove("attack", "hit");
    void player.offsetWidth;
    if (attacker === "player") {
      player.classList.add("attack");
      boss.classList.add("hit");
    } else {
      boss.classList.add("attack");
      player.classList.add("hit");
    }
    const impact = $("impactText");
    impact.textContent = damage > 0 ? `${label} -${damage}` : label;
    impact.classList.remove("show");
    void impact.offsetWidth;
    impact.classList.add("show");
  }

  function submitAnswer(selectedIndex) {
    if (state.answerLocked) return;
    state.answerLocked = true;
    stopTimer();
    state.attempted += 1;
    const question = state.deck[state.index];
    const correct = selectedIndex === question.answer;
    const wrongIds = getWrongIds();
    let damage = 0;
    let verdict = "";

    if (correct) {
      state.correct += 1;
      state.streak += 1;
      state.maxStreak = Math.max(state.maxStreak, state.streak);
      damage = 10;
      if (state.fighterId === "wordsmith" && state.streak >= 2) damage += 3;
      if (state.fighterId === "reader") state.playerHp = Math.min(100, state.playerHp + 3);
      state.bossHp = Math.max(0, state.bossHp - damage);
      state.energy = Math.min(100, state.energy + 25);
      wrongIds.delete(question.id);
      verdict = selectedIndex < 0 ? "TIME UP" : "正確命中！";
      playTone("correct");
      animateCombat("player", damage, state.streak >= 2 ? `${state.streak} COMBO` : "HIT");
    } else {
      state.streak = 0;
      state.energy = Math.min(100, state.energy + 15);
      wrongIds.add(question.id);
      const shielded = state.fighterId === "grammar" && !state.grammarShieldUsed;
      if (shielded) {
        state.grammarShieldUsed = true;
        verdict = "文法護盾！";
        animateCombat("boss", 0, "BLOCK");
      } else {
        damage = 12;
        state.playerHp = Math.max(0, state.playerHp - damage);
        verdict = selectedIndex < 0 ? "時間到！" : "遭到反擊！";
        animateCombat("boss", damage, "COUNTER");
      }
      playTone("wrong");
    }
    saveWrongIds(wrongIds);

    const buttons = [...$("answerGrid").querySelectorAll("button")];
    buttons.forEach((button, index) => {
      button.disabled = true;
      if (index === question.answer) button.classList.add("correct");
      if (index === selectedIndex && !correct) button.classList.add("wrong");
    });
    $("feedbackVerdict").textContent = correct ? "✓" : "✕";
    $("feedbackVerdict").style.color = correct ? "var(--bio)" : "var(--danger)";
    $("feedbackTitle").textContent = `${verdict}　正解 ${LETTERS[question.answer]}`;
    $("feedbackExplanation").textContent = question.explanation;
    $("feedbackTrap").textContent = question.trap;
    $("nextButton").textContent = (state.index + 1 >= state.deck.length || state.playerHp <= 0 || state.bossHp <= 0) ? "查看戰果 ▶" : "下一回合 ▶";
    $("feedbackPanel").hidden = false;
    updateHud();
    $("feedbackPanel").scrollIntoView({ behavior: state.reducedMotion ? "auto" : "smooth", block: "nearest" });
  }

  function nextQuestion() {
    if ($("battleScreen").hidden || !state.answerLocked) return;
    state.index += 1;
    renderQuestion();
  }

  function useSpecial() {
    if (state.energy < 100 || state.answerLocked) return;
    state.energy = 0;
    let message = specialName();
    if (state.fighterId === "wordsmith") {
      state.bossHp = Math.max(0, state.bossHp - 18);
      animateCombat("player", 18, "DOMINANT");
    } else if (state.fighterId === "grammar") {
      const healed = Math.min(20, 100 - state.playerHp);
      state.playerHp += healed;
      animateCombat("player", 0, `HEAL +${healed}`);
    } else {
      state.bossHp = Math.max(0, state.bossHp - 14);
      const healed = Math.min(8, 100 - state.playerHp);
      state.playerHp += healed;
      animateCombat("player", 14, `CHAIN +${healed}`);
    }
    playTone("special");
    updateHud();
    $("specialButton").textContent = `已施放：${message}`;
    if (state.bossHp <= 0) {
      state.answerLocked = true;
      stopTimer();
      updateHud();
      state.finishTimeoutId = window.setTimeout(() => {
        state.finishTimeoutId = null;
        if (!$("battleScreen").hidden) finishBattle();
      }, state.reducedMotion ? 0 : 500);
    }
  }

  function finishBattle() {
    stopTimer();
    cancelPendingFinish();
    const attempted = Math.max(1, state.attempted);
    const accuracy = Math.round(state.correct / attempted * 100);
    const previousBest = Number(localStorage.getItem(STORAGE.best)) || 0;
    const best = Math.max(previousBest, accuracy);
    localStorage.setItem(STORAGE.best, String(best));
    const grade = accuracy >= 90 ? "S" : accuracy >= 80 ? "A" : accuracy >= 70 ? "B" : accuracy >= 60 ? "C" : "D";
    const won = state.bossHp <= 0 || (state.playerHp > 0 && accuracy >= 70);
    $("resultGrade").textContent = grade;
    $("resultTitle").textContent = won ? "挑戰成功！" : "再修煉一場！";
    $("resultMessage").textContent = won
      ? "你已把單字、文法與閱讀線索轉成攻擊力。別忘了用錯題重練完成補強。"
      : "語意黑洞還沒倒下，但每一道錯題都已存進訓練清單。";
    $("correctStat").textContent = `${state.correct}/${state.attempted}`;
    $("accuracyStat").textContent = `${accuracy}%`;
    $("comboStat").textContent = String(state.maxStreak);
    $("bestStat").textContent = `${best}%`;
    updateWrongButtons();
    showScreen($("resultScreen"));
  }

  function openLightbox(src, alt) {
    $("lightboxImage").src = src;
    $("lightboxImage").alt = alt;
    $("lightbox").showModal();
  }

  function renderPrefs() {
    document.body.classList.toggle("reduce-motion", state.reducedMotion);
    document.body.classList.toggle("high-contrast", state.highContrast);
    $("soundButton").setAttribute("aria-pressed", String(state.sound));
    $("soundButton").textContent = state.sound ? "🔊" : "🔇";
    $("motionButton").setAttribute("aria-pressed", String(state.reducedMotion));
    $("contrastButton").setAttribute("aria-pressed", String(state.highContrast));
  }

  function applyPrefs() {
    const prefs = safeParse(localStorage.getItem(STORAGE.prefs), {});
    state.sound = prefs.sound !== false;
    state.reducedMotion = prefs.reducedMotion === true || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    state.highContrast = prefs.highContrast === true;
    renderPrefs();
  }

  function savePrefs() {
    localStorage.setItem(STORAGE.prefs, JSON.stringify({
      sound: state.sound, reducedMotion: state.reducedMotion, highContrast: state.highContrast
    }));
  }

  $("pressStart").addEventListener("click", showSetup);
  $("homeButton").addEventListener("click", showSetup);
  $("startBattleButton").addEventListener("click", () => startBattle(false));
  $("retryWrongButton").addEventListener("click", () => startBattle(true));
  $("resultWrongButton").addEventListener("click", () => startBattle(true));
  $("playAgainButton").addEventListener("click", showSetup);
  $("nextButton").addEventListener("click", nextQuestion);
  $("specialButton").addEventListener("click", useSpecial);
  $("lightboxClose").addEventListener("click", () => $("lightbox").close());
  $("lightbox").addEventListener("click", (event) => {
    if (event.target === $("lightbox")) $("lightbox").close();
  });
  $("soundButton").addEventListener("click", () => {
    state.sound = !state.sound; renderPrefs(); savePrefs(); if (state.sound) playTone("select");
  });
  $("motionButton").addEventListener("click", () => {
    state.reducedMotion = !state.reducedMotion; renderPrefs(); savePrefs();
  });
  $("contrastButton").addEventListener("click", () => {
    state.highContrast = !state.highContrast; renderPrefs(); savePrefs();
  });
  document.addEventListener("keydown", (event) => {
    if ($("battleScreen").hidden || $("lightbox").open) return;
    if (!state.answerLocked) {
      const index = LETTERS.indexOf(event.key.toUpperCase());
      if (index >= 0) submitAnswer(index);
    } else if (!$("feedbackPanel").hidden && event.key === "Enter") {
      nextQuestion();
    }
  });

  applyPrefs();
  renderFighters();
  updateWrongButtons();
  if (!QUESTIONS.length) {
    $("pressStart").disabled = true;
    $("pressStart").textContent = "題庫載入失敗";
  }
})();
