/* Gem Match 3 - Game Logic */
(function () {
  'use strict';

  const BOARD_SIZE = 8;
  const PACK_SIZE = 88; // total tokens in circulation
  const COLORS = [
    'ruby', 'sapphire', 'emerald', 'topaz', 'amethyst', 'citrine', 'aquamarine', 'rose'
  ];

  const boardEl = document.getElementById('board');
  const scoreEl = document.getElementById('score');
  const chainEl = document.getElementById('chain');
  const levelEl = document.getElementById('level');
  const targetEl = document.getElementById('target');
  const movesEl = document.getElementById('moves');
  const newGameBtn = document.getElementById('newGame');
  // Pack UI
  const packEl = document.getElementById('pack');
  const packCountEl = document.getElementById('packCount');
  const waitingCountEl = document.getElementById('waitingCount');
  const viewAllBtn = document.getElementById('viewAll');
  const viewWaitingBtn = document.getElementById('viewWaiting');
  const togglePackBtn = document.getElementById('togglePack');

  // Build grid background cells for a pleasing board
  function buildGridBackground() {
    const bg = document.createElement('div');
    bg.className = 'grid-bg';
    bg.style.setProperty('--size', BOARD_SIZE);
    for (let i = 0; i < BOARD_SIZE * BOARD_SIZE; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      bg.appendChild(cell);
    }
    boardEl.appendChild(bg);
  }

  // State
  let board = []; // 2D array of gem objects or null
  let score = 0;
  let chainMultiplier = 1;
  let isBusy = false; // block input during animations
  // Pack state
  /** @type {{id:string,color:string,state:'waiting'|'onboard'}[]} */
  let packTokens = [];
  /** @type {string[]} */
  let waitingQueue = [];
  let packViewMode = 'all'; // 'all' | 'waiting'
  // Level state
  let currentLevel = 1;
  let levelTarget = 0;
  let movesRemaining = 0;
  // Hint timer state
  let lastMoveAt = Date.now();
  let hintTimer = null;
  let currentHint = null; // { r1,c1,r2,c2 }

  // Sizing
  const hudEl = document.querySelector('.hud');
  const packSectionEl = document.querySelector('.pack-section');
  const packHudEl = document.querySelector('.pack-hud');
  const tipsEl = document.querySelector('.tips');
  const boardWrapEl = document.querySelector('.board-wrap');

  function computeTileSize() {
    const styles = getComputedStyle(boardEl);
    const gapVar = styles.getPropertyValue('--gap');
    const gap = gapVar ? parseInt(gapVar) || 8 : 8;

    const vv = window.visualViewport;
    const vw = vv ? vv.width : window.innerWidth;
    const vh = vv ? vv.height : window.innerHeight;

    const boardWrapStyles = boardWrapEl ? getComputedStyle(boardWrapEl) : null;
    const padV = boardWrapStyles ? (parseInt(boardWrapStyles.paddingTop) + parseInt(boardWrapStyles.paddingBottom)) : 32;
    const padH = boardWrapStyles ? (parseInt(boardWrapStyles.paddingLeft) + parseInt(boardWrapStyles.paddingRight)) : 32;

    const hudH = hudEl ? hudEl.getBoundingClientRect().height : 0;
    const packH = packHudEl ? packHudEl.getBoundingClientRect().height : 0; // only header; content may be collapsed
    const tipsH = tipsEl ? tipsEl.getBoundingClientRect().height : 0;

    const fudge = vw < 520 ? 18 : 10; // ensure visibility of last row on phones
    // Use 96% of available to avoid rounding clipping for the last row/col on some Android devices
    const availableHeight = Math.max(180, (vh - hudH - packH - tipsH - padV - fudge) * 0.96);
    const availableWidth = Math.max(200, (vw - padH - 8) * 0.96);

    const maxPixels = Math.min(availableWidth, availableHeight);
    // Use floor for width and height separately and take the smaller tile to ensure full fit
    const tilespaceW = Math.floor((availableWidth - (BOARD_SIZE - 1) * gap) / BOARD_SIZE);
    const tilespaceH = Math.floor((availableHeight - (BOARD_SIZE - 1) * gap) / BOARD_SIZE);
    const tile = Math.min(tilespaceW, tilespaceH);
    // Safety floor/ceiling
    return Math.max(36, Math.min(92, tile));
  }

  function applyBoardSize() {
    const tile = computeTileSize();
    boardEl.style.setProperty('--tile', tile + 'px');
    boardEl.style.setProperty('--size', BOARD_SIZE);
  }

  window.addEventListener('resize', () => {
    applyBoardSize();
    // Reposition all gems after resize
    forEachGemElement((el, gem) => positionGemElement(el, gem.row, gem.col));
  });

  // React to visual viewport changes (mobile address bar show/hide)
  if (window.visualViewport) {
    let vvTimer = null;
    window.visualViewport.addEventListener('resize', () => {
      if (vvTimer) clearTimeout(vvTimer);
      vvTimer = setTimeout(() => {
        applyBoardSize();
        forEachGemElement((el, gem) => positionGemElement(el, gem.row, gem.col));
      }, 50);
    });
  }

  function makeGemFromToken(token, row, col) {
    return { id: token.id, color: token.color, row, col };
  }

  function inBounds(r, c) {
    return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
  }

  function neighbors(r, c) {
    return [ [r-1,c], [r+1,c], [r,c-1], [r,c+1] ].filter(([rr,cc]) => inBounds(rr,cc));
  }

  function randomColor(excludeColor = null) {
    let color;
    do {
      color = COLORS[Math.floor(Math.random() * COLORS.length)];
    } while (excludeColor && color === excludeColor);
    return color;
  }

  function createGemElement(gem) {
    const el = document.createElement('div');
    el.className = `gem color-${gem.color}`;
    el.setAttribute('role', 'gridcell');
    el.dataset.id = gem.id;
    el.dataset.row = String(gem.row);
    el.dataset.col = String(gem.col);

    const inner = document.createElement('div');
    inner.className = 'inner';
    el.appendChild(inner);

    addPointerHandlers(el);
    positionGemElement(el, gem.row, gem.col, { immediate: true });
    return el;
  }

  function getGemElementById(id) {
    return boardEl.querySelector(`.gem[data-id="${id}"]`);
  }

  // Find the corresponding gem in the logical board by element id.
  function findGemById(id) {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const gem = board[r][c];
        if (gem && gem.id === id) return gem;
      }
    }
    return null;
  }

  function forEachGemElement(cb) {
    const nodes = boardEl.querySelectorAll('.gem');
    nodes.forEach(node => {
      const gem = findGemById(node.dataset.id);
      if (gem) cb(node, gem);
    });
  }

  function clearHint() {
    if (currentHint) {
      const a = board[currentHint.r1][currentHint.c1];
      const b = board[currentHint.r2][currentHint.c2];
      if (a) getGemElementById(a.id)?.classList.remove('hint');
      if (b) getGemElementById(b.id)?.classList.remove('hint');
    }
    currentHint = null;
  }

  function setHint(r1,c1,r2,c2) {
    clearHint();
    currentHint = { r1,c1,r2,c2 };
    const a = board[r1][c1];
    const b = board[r2][c2];
    if (a) getGemElementById(a.id)?.classList.add('hint');
    if (b) getGemElementById(b.id)?.classList.add('hint');
  }

  function restartHintTimer(clearExistingHint = true) {
    lastMoveAt = Date.now();
    if (hintTimer) clearTimeout(hintTimer);
    if (clearExistingHint) clearHint();
    hintTimer = setTimeout(async () => {
      if (isBusy) { restartHintTimer(clearExistingHint); return; }
      // find and show a hint
      const hint = findAnyAvailableMove();
      if (hint) setHint(hint.r1, hint.c1, hint.r2, hint.c2);
      // restart so pulse keeps going every 30s if idle; do not clear the hint we just set
      restartHintTimer(false);
    }, 30000);
  }

  function positionGemElement(el, row, col, opts = {}) {
    const tile = parseInt(getComputedStyle(boardEl).getPropertyValue('--tile')) || 72;
    const gap = 8; // keep in sync with CSS --gap
    const x = col * (tile + gap);
    const y = row * (tile + gap);
    if (opts.immediate) {
      const prev = el.style.transition;
      el.style.transition = 'none';
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      // force reflow then restore transition
      void el.offsetHeight; // eslint-disable-line no-unused-expressions
      el.style.transition = prev || '';
    } else {
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
    el.dataset.row = String(row);
    el.dataset.col = String(col);
  }

  // Initialize pack and board without starting matches
  function initBoard() {
    board = new Array(BOARD_SIZE).fill(null).map(() => new Array(BOARD_SIZE).fill(null));
    boardEl.innerHTML = '';
    buildGridBackground();
    initPackTokens();
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const token = dequeueForInit(r, c);
        if (!token) continue;
        const gem = makeGemFromToken(token, r, c);
        board[r][c] = gem;
        const el = createGemElement(gem);
        boardEl.appendChild(el);
      }
    }
    score = 0;
    chainMultiplier = 1;
    updateHUD();
    updatePackHUD();
    renderPack();
  }

  function updateHUD() {
    scoreEl.textContent = String(score);
    chainEl.textContent = `x${chainMultiplier}`;
    if (levelEl) levelEl.textContent = String(currentLevel);
    if (targetEl) targetEl.textContent = String(levelTarget);
    if (movesEl) movesEl.textContent = String(movesRemaining);
  }

  function updatePackHUD() {
    if (packCountEl) packCountEl.textContent = String(packTokens.length);
    if (waitingCountEl) waitingCountEl.textContent = String(waitingQueue.length);
  }

  function renderPack() {
    if (!packEl) return;
    packEl.innerHTML = '';
    const showWaitingOnly = packViewMode === 'waiting';
    const waitingSet = new Set(waitingQueue);
    const tokensToShow = showWaitingOnly ? packTokens.filter(t => waitingSet.has(t.id)) : packTokens;
    for (const t of tokensToShow) {
      const chip = document.createElement('div');
      chip.className = `chip dot color-${t.color} ${waitingSet.has(t.id) ? 'waiting' : 'onboard'}`;
      chip.title = t.color;
      packEl.appendChild(chip);
    }
  }

  function createsMatchAt(color, r, c) {
    // check horizontal
    const left1 = c > 1 && board[r][c-1] && board[r][c-2] && board[r][c-1].color === color && board[r][c-2].color === color;
    const leftRight = c > 0 && c < BOARD_SIZE-1 && board[r][c-1] && board[r][c+1] && board[r][c-1].color === color && board[r][c+1].color === color;
    const right1 = c < BOARD_SIZE-2 && board[r][c+1] && board[r][c+2] && board[r][c+1].color === color && board[r][c+2].color === color;
    // check vertical
    const up1 = r > 1 && board[r-1][c] && board[r-2][c] && board[r-1][c].color === color && board[r-2][c].color === color;
    const upDown = r > 0 && r < BOARD_SIZE-1 && board[r-1][c] && board[r+1][c] && board[r-1][c].color === color && board[r+1][c].color === color;
    const down1 = r < BOARD_SIZE-2 && board[r+1][c] && board[r+2][c] && board[r+1][c].color === color && board[r+2][c].color === color;
    return left1 || leftRight || right1 || up1 || upDown || down1;
  }

  function initPackTokens() {
    packTokens = [];
    waitingQueue = [];
    const perColor = Math.floor(PACK_SIZE / COLORS.length);
    let remainder = PACK_SIZE - perColor * COLORS.length;
    for (const color of COLORS) {
      const count = perColor + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
      for (let i = 0; i < count; i++) {
        const token = { id: `tok_${color}_${i}_${Math.random().toString(36).slice(2)}`, color, state: 'waiting' };
        packTokens.push(token);
        waitingQueue.push(token.id);
      }
    }
    // shuffle queue
    for (let i = waitingQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [waitingQueue[i], waitingQueue[j]] = [waitingQueue[j], waitingQueue[i]];
    }
  }

  function getTokenById(id) { return packTokens.find(t => t.id === id) || null; }

  function dequeueToken() {
    const id = waitingQueue.shift();
    if (!id) return null;
    const token = getTokenById(id);
    if (token) token.state = 'onboard';
    updatePackHUD();
    return token || null;
  }

  function enqueueToken(id) {
    const token = getTokenById(id);
    if (!token) return;
    token.state = 'waiting';
    waitingQueue.push(id);
    updatePackHUD();
  }

  function dequeueForInit(r, c) {
    if (waitingQueue.length === 0) return null;
    const len = waitingQueue.length;
    for (let i = 0; i < len; i++) {
      const candidateId = waitingQueue[0];
      const token = getTokenById(candidateId);
      if (!createsMatchAt(token.color, r, c)) {
        return dequeueToken();
      }
      waitingQueue.push(waitingQueue.shift());
    }
    return dequeueToken();
  }
  function swapInBoard(r1, c1, r2, c2) {
    const a = board[r1][c1];
    const b = board[r2][c2];
    board[r1][c1] = b; b.row = r1; b.col = c1;
    board[r2][c2] = a; a.row = r2; a.col = c2;
  }

  function animateSwap(gemA, gemB, revertIfNoMatch = true) {
    return new Promise(resolve => {
      const elA = getGemElementById(gemA.id);
      const elB = getGemElementById(gemB.id);
      positionGemElement(elA, gemA.row, gemA.col);
      positionGemElement(elB, gemB.row, gemB.col);
      const onDone = () => {
        elA.removeEventListener('transitionend', onDone);
        resolve();
      };
      elA.addEventListener('transitionend', onDone);
    });
  }

  function findMatches() {
    const matched = new Set();
    // Horizontal
    for (let r = 0; r < BOARD_SIZE; r++) {
      let streak = 1;
      for (let c = 1; c <= BOARD_SIZE; c++) {
        const prev = c - 1 < BOARD_SIZE ? board[r][c - 1] : null;
        const curr = c < BOARD_SIZE ? board[r][c] : null;
        if (curr && prev && curr.color === prev.color) {
          streak++;
        } else {
          if (streak >= 3) {
            for (let k = 0; k < streak; k++) matched.add(`${r},${c - 1 - k}`);
          }
          streak = 1;
        }
      }
    }
    // Vertical
    for (let c = 0; c < BOARD_SIZE; c++) {
      let streak = 1;
      for (let r = 1; r <= BOARD_SIZE; r++) {
        const prev = r - 1 < BOARD_SIZE ? board[r - 1][c] : null;
        const curr = r < BOARD_SIZE ? board[r][c] : null;
        if (curr && prev && curr.color === prev.color) {
          streak++;
        } else {
          if (streak >= 3) {
            for (let k = 0; k < streak; k++) matched.add(`${r - 1 - k},${c}`);
          }
          streak = 1;
        }
      }
    }
    return matched;
  }

  function animateMatches(matchedSet) {
    return new Promise(resolve => {
      let remaining = 0;
      matchedSet.forEach(key => {
        const [r, c] = key.split(',').map(Number);
        const gem = board[r][c];
        if (!gem) return;
        const el = getGemElementById(gem.id);
        if (!el) return;
        // Particle burst
        spawnBurstAtGem(el, gem.color);
        remaining++;
        el.classList.add('matched');
        el.addEventListener('transitionend', function handler() {
          el.removeEventListener('transitionend', handler);
          el.remove();
          remaining--;
          if (remaining === 0) resolve();
        });
      });
      if (remaining === 0) resolve();
    });
  }

  function spawnBurstAtGem(gemEl, colorName) {
    const rect = gemEl.getBoundingClientRect();
    const parentRect = boardEl.getBoundingClientRect();
    const originX = rect.left - parentRect.left + rect.width / 2;
    const originY = rect.top - parentRect.top + rect.height / 2;

    const burst = document.createElement('div');
    burst.className = 'gm-burst';
    burst.style.transform = `translate3d(${originX}px, ${originY}px, 0)`;
    // Choose a color based on gem color class
    const colorMap = {
      ruby: '#ff2c45', sapphire: '#3a7bff', emerald: '#34e27a', topaz: '#ff9d1a',
      amethyst: '#bb6bff', citrine: '#ffd000', aquamarine: '#21e4ff', rose: '#ff5ac8'
    };
    const baseColor = colorMap[colorName] || '#ffffff';

    const particles = 14;
    for (let i = 0; i < particles; i++) {
      const p = document.createElement('div');
      p.className = 'gm-particle';
      p.style.color = baseColor;
      const angle = (Math.PI * 2 * i) / particles + Math.random() * 0.5;
      const radius = 24 + Math.random() * 28;
      const dx = Math.cos(angle) * radius;
      const dy = Math.sin(angle) * radius;
      p.style.setProperty('--dx', dx + 'px');
      p.style.setProperty('--dy', dy + 'px');
      p.style.setProperty('--dur', 420 + Math.floor(Math.random() * 240) + 'ms');
      burst.appendChild(p);
    }
    boardEl.appendChild(burst);
    // cleanup after animation
    setTimeout(() => burst.remove(), 900);
  }

  function clearMatchesAndScore(matchedSet) {
    // Update score with multiplier
    const base = 10;
    score += matchedSet.size * base * chainMultiplier;
    matchedSet.forEach(key => {
      const [r, c] = key.split(',').map(Number);
      const gem = board[r][c];
      if (gem) enqueueToken(gem.id);
      board[r][c] = null;
    });
    updateHUD();
    renderPack();
  }

  function applyGravityAndFill() {
    // Move existing gems down
    for (let c = 0; c < BOARD_SIZE; c++) {
      let writeRow = BOARD_SIZE - 1;
      for (let r = BOARD_SIZE - 1; r >= 0; r--) {
        if (board[r][c] !== null) {
          if (writeRow !== r) {
            const gem = board[r][c];
            board[writeRow][c] = gem; gem.row = writeRow; gem.col = c;
            board[r][c] = null;
          }
          writeRow--;
        }
      }
      // Fill remaining with new gems from top (from waitingQueue)
      for (let r = writeRow; r >= 0; r--) {
        const token = dequeueToken();
        if (!token) continue;
        const gem = makeGemFromToken(token, r, c);
        board[r][c] = gem;
        const el = createGemElement(gem);
        // Start above the board for a falling effect
        positionGemElement(el, -1 - (writeRow - r), c, { immediate: true });
        boardEl.appendChild(el);
      }
    }

    // Animate all gems to their new row positions
    return new Promise(resolve => {
      let remaining = 0;
      forEachGemElement((el, gem) => {
        const prevRow = Number(el.dataset.row);
        const prevCol = Number(el.dataset.col);
        const isMoving = prevRow !== gem.row || prevCol !== gem.col;
        if (!isMoving) return; // only wait for moving/new gems

        remaining++;
        const handler = (ev) => {
          if (ev.propertyName !== 'transform') return;
          el.removeEventListener('transitionend', handler);
          remaining--;
          if (remaining === 0) { renderPack(); resolve(); }
        };
        el.addEventListener('transitionend', handler);

        // temporarily increase fall duration if there is an inline transition to tweak
        const prev = el.style.transition;
        if (prev) {
          el.style.transition = prev.replace(/transform\s[^,]+/, `transform var(--duration-fall) var(--ease)`);
        }
        positionGemElement(el, gem.row, gem.col);
        // restore transition after one frame
        if (prev) setTimeout(() => { el.style.transition = prev; }, 0);
      });
      if (remaining === 0) { renderPack(); resolve(); }
    });
  }

  async function resolveBoard() {
    // Keep resolving until no more matches
    let anyMatch = false;
    chainMultiplier = 1;
    while (true) {
      const matches = findMatches();
      if (matches.size === 0) break;
      anyMatch = true;
      await animateMatches(matches);
      clearMatchesAndScore(matches);
      chainMultiplier++;
      await applyGravityAndFill();
      await delay(40);
    }
    chainMultiplier = 1;
    updateHUD();
    return anyMatch;
  }

  function delay(ms) { return new Promise(res => setTimeout(res, ms)); }

  // Check if any swap would produce a match
  function hasAvailableMove() {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (!board[r][c]) continue;
        // right
        if (c + 1 < BOARD_SIZE && board[r][c+1]) {
          swapInBoard(r,c, r,c+1);
          const any = findMatches().size > 0;
          swapInBoard(r,c+1, r,c);
          if (any) return true;
        }
        // down
        if (r + 1 < BOARD_SIZE && board[r+1][c]) {
          swapInBoard(r,c, r+1,c);
          const any = findMatches().size > 0;
          swapInBoard(r+1,c, r,c);
          if (any) return true;
        }
      }
    }
    return false;
  }

  function findAnyAvailableMove() {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (!board[r][c]) continue;
        if (c + 1 < BOARD_SIZE && board[r][c+1]) {
          swapInBoard(r,c, r,c+1);
          const any = findMatches();
          swapInBoard(r,c+1, r,c);
          if (any.size > 0) return { r1: r, c1: c, r2: r, c2: c+1 };
        }
        if (r + 1 < BOARD_SIZE && board[r+1][c]) {
          swapInBoard(r,c, r+1,c);
          const any = findMatches();
          swapInBoard(r+1,c, r,c);
          if (any.size > 0) return { r1: r, c1: c, r2: r+1, c2: c };
        }
      }
    }
    return null;
  }

  async function explodeAllAndRefill() {
    // Animate all gems exploding without scoring
    const all = new Set();
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c]) all.add(`${r},${c}`);
      }
    }
    await animateMatches(all);
    // Enqueue all tokens and clear board
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const gem = board[r][c];
        if (gem) enqueueToken(gem.id);
        board[r][c] = null;
      }
    }
    renderPack();
    await applyGravityAndFill();
    await resolveBoard();
  }

  async function checkAndReshuffleIfStuck() {
    if (hasAvailableMove()) return;
    isBusy = true;
    // try up to 5 reshuffles to ensure a playable board
    for (let attempt = 0; attempt < 5; attempt++) {
      await explodeAllAndRefill();
      if (hasAvailableMove()) break;
    }
    isBusy = false;
  }

  // Levels
  function computeLevelConfig(level) {
    const baseTarget = 300;
    const target = Math.round(baseTarget + Math.pow(Math.max(0, level - 1), 1.25) * 220);
    const moves = Math.max(8, 26 - Math.floor((level - 1) * 1.5));
    return { target, moves };
  }

  async function startLevel(level) {
    currentLevel = level;
    const cfg = computeLevelConfig(level);
    levelTarget = cfg.target;
    movesRemaining = cfg.moves;
    score = 0;
    chainMultiplier = 1;
    isBusy = true;
    initBoard();
    updateHUD();
    restartHintTimer();
    isBusy = false;
  }

  function showToast(message) {
    const t = document.createElement('div');
    t.className = 'gm-toast';
    t.textContent = message;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); t.addEventListener('transitionend', () => t.remove(), { once: true }); }, 1200);
  }

  function onLevelComplete() {
    showToast(`Level ${currentLevel} complete!`);
    setTimeout(() => startLevel(currentLevel + 1), 900);
  }

  function onLevelFailed() {
    showToast(`Level ${currentLevel} failed`);
    setTimeout(() => startLevel(currentLevel), 900);
  }

  function trySwap(r1, c1, r2, c2) {
    if (!inBounds(r1,c1) || !inBounds(r2,c2)) return;
    if (isBusy) return;
    if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) return; // only adjacent

    isBusy = true;
    const gemA = board[r1][c1];
    const gemB = board[r2][c2];

    swapInBoard(r1,c1,r2,c2);
    const elA = getGemElementById(gemA.id);
    const elB = getGemElementById(gemB.id);
    positionGemElement(elA, gemA.row, gemA.col);
    positionGemElement(elB, gemB.row, gemB.col);

    // After swap animation, check for matches
    const afterSwap = () => {
      // Small timeout to ensure transition finished
      setTimeout(async () => {
        const matches = findMatches();
        if (matches.size === 0) {
          // Revert swap
          swapInBoard(r2,c2,r1,c1);
          positionGemElement(elA, gemA.row, gemA.col);
          positionGemElement(elB, gemB.row, gemB.col);
          // wait for revert animation
          await waitForTransition(elA);
          isBusy = false;
        } else {
          // Resolve matches and cascades
          await animateMatches(matches);
          clearMatchesAndScore(matches);
          chainMultiplier = 2;
          await applyGravityAndFill();
          await resolveBoard();
          await checkAndReshuffleIfStuck();
          restartHintTimer();
          // decrement a move only on successful swap
          movesRemaining = Math.max(0, movesRemaining - 1);
          updateHUD();
          // check level progression/failure
          if (score >= levelTarget) {
            onLevelComplete();
          } else if (movesRemaining === 0) {
            onLevelFailed();
          }
          isBusy = false;
        }
      }, 30);
    };

    waitForTransition(elA).then(afterSwap);
  }

  function waitForTransition(el) {
    return new Promise(resolve => {
      const handler = (ev) => {
        if (ev.propertyName !== 'transform') return;
        el.removeEventListener('transitionend', handler);
        resolve();
      };
      el.addEventListener('transitionend', handler);
    });
  }

  // Pointer interactions (drag to swap)
  let dragState = null; // { startX, startY, originRow, originCol, el }

  function addPointerHandlers(el) {
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('click', onClickSelect);
  }

  function onPointerDown(e) {
    if (isBusy) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const row = Number(el.dataset.row);
    const col = Number(el.dataset.col);
    dragState = {
      startX: e.clientX,
      startY: e.clientY,
      originRow: row,
      originCol: col,
      el,
      hasSwapped: false
    };
    el.classList.add('dragging');
    el.style.setProperty('--x', '0px');
    el.style.setProperty('--y', '0px');

    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    restartHintTimer();
  }

  function onPointerMove(e) {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    const tile = parseInt(getComputedStyle(boardEl).getPropertyValue('--tile')) || 72;

    dragState.el.style.setProperty('--x', dx + 'px');
    dragState.el.style.setProperty('--y', dy + 'px');

    if (dragState.hasSwapped) return;

    const threshold = tile * 0.35;
    let target = null;
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx > threshold) target = [dragState.originRow, dragState.originCol + 1];
      else if (dx < -threshold) target = [dragState.originRow, dragState.originCol - 1];
    } else {
      if (dy > threshold) target = [dragState.originRow + 1, dragState.originCol];
      else if (dy < -threshold) target = [dragState.originRow - 1, dragState.originCol];
    }
    if (target && inBounds(target[0], target[1])) {
      dragState.hasSwapped = true;
      dragState.el.classList.remove('dragging');
      trySwap(dragState.originRow, dragState.originCol, target[0], target[1]);
      cleanupDragListeners(dragState.el);
      dragState = null;
    }
  }

  function onPointerUp() {
    if (!dragState) return;
    dragState.el.classList.remove('dragging');
    dragState.el.style.removeProperty('--x');
    dragState.el.style.removeProperty('--y');
    cleanupDragListeners(dragState.el);
    dragState = null;
  }

  function cleanupDragListeners(el) {
    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('pointerup', onPointerUp);
    el.removeEventListener('pointercancel', onPointerUp);
  }

  // Click-to-select fallback (mobile tap or desktop)
  let selected = null; // { row, col }
  function onClickSelect(e) {
    if (isBusy) return;
    const el = e.currentTarget;
    const row = Number(el.dataset.row);
    const col = Number(el.dataset.col);
    if (!selected) {
      selected = { row, col };
      el.classList.add('selected');
    } else {
      const prevEl = getGemElementById(board[selected.row][selected.col].id);
      prevEl.classList.remove('selected');
      const dr = Math.abs(row - selected.row);
      const dc = Math.abs(col - selected.col);
      if (dr + dc === 1) {
        trySwap(selected.row, selected.col, row, col);
      }
      selected = null;
    }
  }

  // New game
  newGameBtn.addEventListener('click', () => {
    if (isBusy) return;
    startLevel(1);
  });

  // Pack view toggles
  if (viewAllBtn && viewWaitingBtn) {
    viewAllBtn.addEventListener('click', () => {
      if (packViewMode === 'all') return;
      packViewMode = 'all';
      viewAllBtn.setAttribute('aria-pressed', 'true');
      viewWaitingBtn.setAttribute('aria-pressed', 'false');
      renderPack();
    });
    viewWaitingBtn.addEventListener('click', () => {
      if (packViewMode === 'waiting') return;
      packViewMode = 'waiting';
      viewAllBtn.setAttribute('aria-pressed', 'false');
      viewWaitingBtn.setAttribute('aria-pressed', 'true');
      renderPack();
    });
  }

  if (togglePackBtn) {
    togglePackBtn.addEventListener('click', () => {
      const section = document.querySelector('.pack-section');
      const isCollapsed = section.classList.toggle('collapsed');
      togglePackBtn.setAttribute('aria-expanded', String(!isCollapsed));
      togglePackBtn.textContent = isCollapsed ? 'Show Pack' : 'Hide Pack';
    });
  }

  // Startup
  applyBoardSize();
  startLevel(1);
})();
