(() => {
  'use strict';

  // ---------- Settings ----------
  const TOTAL_SECONDS = 6 * 60;  // overall time limit
  const START_LIVES = 3;
  const HIGHLIGHT_MS = 1000;     // how long each dot stays green
  const GAP_MS = 450;            // pause after the dot before the symmetry question
  const QUESTION_SECONDS = 5;    // time allowed for each symmetry question
  const FEEDBACK_MS = 900;       // how long Correct / Incorrect stays on screen

  // Difficulty: more dots on screen and a longer sequence as the level goes up.
  function levelConfig(level) {
    return {
      dots: Math.min(18 + level, 28),
      seq: Math.min(level + 2, 9),
    };
  }

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const titleEl = $('title');
  const barEl = $('bar');
  const fillEl = $('bar-fill');
  const stage = $('stage');

  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  // Resets the screen: sets the title and progress bar and clears the stage.
  function setScreen(title, progress) {
    titleEl.textContent = title;
    barEl.style.visibility = progress == null ? 'hidden' : 'visible';
    if (progress != null) fillEl.style.width = Math.round(progress * 100) + '%';
    stage.innerHTML = '';
  }

  // ---------- State / helpers ----------
  let S;
  let runId = 0;
  let tick = null;

  const rand = (n) => Math.floor(Math.random() * n);
  const fmt = (s) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '-');

  const sleep = (ms, id) => new Promise((res, rej) =>
    setTimeout(() => (id === runId ? res() : rej(new Error('cancelled'))), ms));

  function sample(total, count) {
    const pool = [...Array(total).keys()];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, count);
  }

  function newState() {
    return {
      level: 1, score: 0, lives: START_LIVES, timeLeft: TOTAL_SECONDS,
      symTotal: 0, symCorrect: 0, recTotal: 0, recCorrect: 0, over: false,
    };
  }

  // ---------- Dot arena ----------
  const dotSize = () => Math.max(34, Math.min(64, window.innerWidth * 0.034));

  // Random, non-overlapping dot positions, stored as fractions of the arena size.
  function makeLayout(count) {
    const probe = h('div', 'arena');
    stage.appendChild(probe);
    const { width: W, height: H } = probe.getBoundingClientRect();
    stage.removeChild(probe);

    const d = dotSize();
    const pad = d * 0.9;
    const minDist = d * 1.35;
    const pts = [];
    let tries = 0;
    while (pts.length < count && tries < 10000) {
      tries++;
      const x = pad + Math.random() * (W - 2 * pad);
      const y = pad + Math.random() * (H - 2 * pad);
      if (pts.every((p) => Math.hypot(p.x - x, p.y - y) >= minDist)) pts.push({ x, y });
    }
    return { pts: pts.map((p) => ({ fx: p.x / W, fy: p.y / H })) };
  }

  function renderArena(layout, opts = {}) {
    const arena = h('div', 'arena' + (opts.clickable ? ' clickable' : ''));
    arena.style.setProperty('--d', dotSize() + 'px');
    layout.pts.forEach((p, i) => {
      const dot = h('button', 'dot');
      dot.type = 'button';
      dot.dataset.i = i;
      dot.style.left = p.fx * 100 + '%';
      dot.style.top = p.fy * 100 + '%';
      if (opts.lit === i) dot.classList.add('lit');
      if (!opts.clickable) dot.tabIndex = -1;
      arena.appendChild(dot);
    });
    stage.appendChild(arena);
    return arena;
  }

  // ---------- Symmetry question ("Rotated but identical?") ----------
  // 1 = big square, 0 = small dot.
  // Every question is built fresh: random figure size, density and rotation.
  const rot90 = (g, n) => {
    const o = new Array(n * n);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) o[r * n + c] = g[(n - 1 - c) * n + r];
    }
    return o;
  };
  const same = (a, b) => a.every((v, i) => v === b[i]);

  function buildQuestion() {
    const n = 4 + rand(3);                          // 4x4, 5x5 or 6x6
    const density = 0.4 + Math.random() * 0.35;     // share of big squares
    const left = Array.from({ length: n * n }, () => (Math.random() < density ? 1 : 0));

    let right = left;
    const turns = 1 + rand(3);                      // rotate by 90, 180 or 270 degrees
    for (let i = 0; i < turns; i++) right = rot90(right, n);

    if (Math.random() < 0.5) return { n, left, right, identical: true };

    // "No" case: change one cell, and make sure it does not match any rotation of the left figure.
    for (let t = 0; t < 60; t++) {
      const cand = right.slice();
      const i = rand(n * n);
      cand[i] = cand[i] ? 0 : 1;
      let r = left;
      let clash = false;
      for (let q = 0; q < 4; q++) {
        if (same(r, cand)) { clash = true; break; }
        r = rot90(r, n);
      }
      if (!clash) return { n, left, right: cand, identical: false };
    }
    return { n, left, right, identical: true };
  }

  function patternEl(g, n) {
    const p = h('div', 'pat');
    p.style.setProperty('--n', n);
    g.forEach((v) => p.appendChild(h('div', v ? 'sq' : 'tiny')));
    return p;
  }

  function askQuestion(id, progress) {
    return new Promise((resolve, reject) => {
      setScreen('Is it Symmetric..?', progress);
      const q = buildQuestion();

      const panel = h('div', 'panel');
      const clock = h('div', 'clock', QUESTION_SECONDS + 's');
      const pats = h('div', 'pats');
      pats.append(patternEl(q.left, q.n), patternEl(q.right, q.n));
      const verdict = h('p', 'verdict', '');        // space is reserved so nothing jumps
      panel.append(clock, h('p', 'q', 'Rotated but identical?'), pats, verdict);

      const answers = h('div', 'answers');
      const buttons = [];
      let settled = false;
      let secondsLeft = QUESTION_SECONDS;
      let timer = null;

      // answer: true (yes), false (no) or null (time ran out)
      const settle = (answer) => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        const ok = answer === q.identical;
        buttons.forEach((b) => { b.disabled = true; });
        verdict.textContent = answer === null ? "Time's up \u2013 Incorrect" : (ok ? 'Correct' : 'Incorrect');
        verdict.className = 'verdict ' + (ok ? 'ok' : 'bad');
        setTimeout(() => {
          if (id !== runId) return reject(new Error('cancelled'));
          resolve(ok);
        }, FEEDBACK_MS);
      };

      ['yes', 'no'].forEach((label) => {
        const b = h('button', 'ans', label);
        b.type = 'button';
        b.onclick = () => settle(label === 'yes');
        buttons.push(b);
        answers.appendChild(b);
      });

      timer = setInterval(() => {
        if (id !== runId) { clearInterval(timer); return reject(new Error('cancelled')); }
        secondsLeft--;
        clock.textContent = secondsLeft + 's';
        clock.classList.toggle('low', secondsLeft <= 2);
        if (secondsLeft <= 0) settle(null);
      }, 1000);

      stage.append(panel, answers);
    });
  }

  // ---------- Recall: click the dots in the order they were highlighted ----------
  function askRecall(layout, targets, id) {
    return new Promise((resolve, reject) => {
      setScreen('Select the highlighted Dot Sequence', 1);
      const arena = renderArena(layout, { clickable: true });
      const picked = [];
      let locked = false;

      arena.addEventListener('click', (e) => {
        const dot = e.target.closest('.dot');
        if (!dot || locked) return;
        const i = Number(dot.dataset.i);
        if (picked.includes(i)) return;       // every pick is final

        // The k-th click is correct only if it is the k-th dot of the sequence.
        const k = picked.length;
        picked.push(i);
        dot.classList.add(i === targets[k] ? 'right' : 'wrong');

        if (picked.length === targets.length) {
          locked = true;
          // ring the dots of the sequence that were never picked
          targets.forEach((t) => {
            if (!picked.includes(t)) arena.children[t].classList.add('missed');
          });
          setTimeout(() => {
            if (id !== runId) return reject(new Error('cancelled'));
            resolve(picked.slice());
          }, 1300);
        }
      });
    });
  }

  // ---------- Messages between levels ----------
  async function showMessage(id, big, small, ms) {
    setScreen('Grid Challenge', null);
    const panel = h('div', 'panel');
    panel.append(h('p', 'q', big));
    if (small) panel.append(h('p', 'sub', small));
    stage.appendChild(panel);
    await sleep(ms, id);
  }

  // ---------- One level ----------
  async function playLevel(id) {
    const cfg = levelConfig(S.level);

    setScreen('Remember the highlighted Dot Sequence', 0);
    const layout = makeLayout(cfg.dots);
    const seqLen = Math.min(cfg.seq, layout.pts.length);
    const targets = sample(layout.pts.length, seqLen);

    const totalSteps = seqLen * 2 + 1;
    let step = 0;
    let symMistakes = 0;

    for (let i = 0; i < seqLen; i++) {
      setScreen('Remember the highlighted Dot Sequence', ++step / totalSteps);
      const arena = renderArena(layout, { lit: targets[i] });
      await sleep(HIGHLIGHT_MS, id);
      arena.children[targets[i]].classList.remove('lit');
      await sleep(GAP_MS, id);

      const ok = await askQuestion(id, ++step / totalSteps);
      S.symTotal++;
      if (ok) S.symCorrect++; else symMistakes++;
    }

    const picked = await askRecall(layout, targets, id);
    const hits = picked.filter((v, k) => v === targets[k]).length;
    S.recTotal += seqLen;
    S.recCorrect += hits;

    return { passed: symMistakes === 0 && hits === seqLen, symMistakes, hits, total: seqLen };
  }

  // ---------- Game flow ----------
  async function runGame() {
    const id = ++runId;
    try {
      while (!S.over) {
        const r = await playLevel(id);
        if (S.over || id !== runId) return;

        if (r.passed) {
          S.score += S.level * 100;
          S.level++;
          await showMessage(id, 'Correct!', 'Level ' + S.level, 1400);
        } else {
          S.lives--;
          const why = [];
          if (r.symMistakes) why.push(r.symMistakes + ' symmetry mistake' + (r.symMistakes > 1 ? 's' : ''));
          if (r.hits < r.total) why.push(r.hits + ' of ' + r.total + ' dots in the right order');
          if (S.lives <= 0) return endGame('Out of lives');
          await showMessage(id, 'Not quite', why.join(' · ') + ' · Lives left: ' + S.lives, 2600);
        }
      }
    } catch (e) {
      if (e.message !== 'cancelled') throw e;
    }
  }

  function startTimer() {
    clearInterval(tick);
    tick = setInterval(() => {
      S.timeLeft--;
      if (S.timeLeft <= 0) endGame("Time's up");
    }, 1000);
  }

  function endGame(title) {
    if (S.over) return;
    S.over = true;
    runId++;
    clearInterval(tick);

    setScreen(title, null);
    const panel = h('div', 'panel');
    const stats = h('div', 'stats');
    [
      ['Level reached', S.level],
      ['Score', S.score],
      ['Symmetry accuracy', pct(S.symCorrect, S.symTotal)],
      ['Dot sequence accuracy', pct(S.recCorrect, S.recTotal)],
      ['Time played', fmt(TOTAL_SECONDS - Math.max(S.timeLeft, 0))],
    ].forEach(([k, v]) => stats.append(h('span', null, k), h('b', null, String(v))));
    panel.appendChild(stats);

    const answers = h('div', 'answers');
    const again = h('button', 'ans', 'play again');
    again.type = 'button';
    again.onclick = startGame;
    answers.appendChild(again);
    stage.append(panel, answers);
  }

  function startGame() {
    S = newState();
    startTimer();
    runGame();
  }

  function showIntro() {
    setScreen('Grid Challenge', null);
    const panel = h('div', 'panel');
    const rules = h('ol', 'rules');
    [
      'Dots are shown on the screen and one of them turns green. Remember its position.',
      'Next you will be asked "Rotated but identical?". Look at the two figures and answer yes or no within 5 seconds. You will see Correct or Incorrect after each answer.',
      'This repeats, with a new dot highlighted each time.',
      'At the end, click the highlighted dots in the same order they appeared. A dot turns green if it is correct and red if it is wrong.',
      'Answer everything correctly to reach the next level. You have 6 minutes and 3 lives.',
    ].forEach((t) => rules.appendChild(h('li', null, t)));
    panel.appendChild(rules);

    const answers = h('div', 'answers');
    const start = h('button', 'ans', 'start');
    start.type = 'button';
    start.onclick = startGame;
    answers.appendChild(start);
    stage.append(panel, answers);
  }

  showIntro();
})();