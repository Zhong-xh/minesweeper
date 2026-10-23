(function () {
  'use strict';

  const DIFFICULTIES = {
    beginner:     { rows: 9,  cols: 9,  mines: 10, cellSize: 42 },
    intermediate: { rows: 16, cols: 16, mines: 40, cellSize: 30 },
    expert:       { rows: 16, cols: 30, mines: 99, cellSize: 26 }
  };

  const boardEl     = document.getElementById('board');
  const mineCountEl = document.getElementById('mine-count');
  const timerEl     = document.getElementById('timer');
  const messageEl   = document.getElementById('message');
  const restartBtn  = document.getElementById('restart');
  const diffBtns    = document.querySelectorAll('.difficulty button');

  let currentLevel = 'beginner';
  let rows = 0, cols = 0, mineTotal = 0;
  let board = [];
  let cells = [];
  let firstClick = true;
  let gameState = 'ready';
  let flagsPlaced = 0;
  let revealedCount = 0;
  let seconds = 0;
  let timerId = null;

  const wrapEl = boardEl.parentElement;

  let pressTimer = null;
  let lastLongPress = 0;
  let suppressClickUntil = 0;
  let touchStartX = 0;
  let touchStartY = 0;
  let lastX = 0;
  let lastY = 0;
  let singleTouchMoved = false;
  let longPressCell = null;
  let activeTouches = new Map();
  let pinchStartDist = 1;
  let pinchStartScale = 1;
  let scale = 1;
  let tx = 0;
  let ty = 0;

  function pickCellSize(cfg) {
    const gap = cfg.cols >= 20 ? 2 : 3;
    const mobile = window.innerWidth <= 480;
    const paddingTotal = mobile ? 44 : 88;
    const available = Math.max(160, window.innerWidth - paddingTotal);
    const fit = Math.floor((available - (cfg.cols - 1) * gap) / cfg.cols);
    return { size: Math.max(6, Math.min(cfg.cellSize, fit)), gap: gap };
  }

  function applyTransform() {
    boardEl.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
  }

  function clampPan() {
    const bw = boardEl.offsetWidth;
    const bh = boardEl.offsetHeight;
    const minX = bw * (1 - scale);
    const minY = bh * (1 - scale);
    if (tx > 0) tx = 0;
    if (tx < minX) tx = minX;
    if (ty > 0) ty = 0;
    if (ty < minY) ty = minY;
    if (scale <= 1.001) {
      tx = 0;
      ty = 0;
    }
    applyTransform();
  }

  function forEachNeighbor(r, c, fn) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) fn(nr, nc);
      }
    }
  }

  function initGame(level) {
    const cfg = DIFFICULTIES[level];
    currentLevel = level;
    rows = cfg.rows;
    cols = cfg.cols;
    mineTotal = cfg.mines;

    stopTimer();
    seconds = 0;
    firstClick = true;
    gameState = 'ready';
    flagsPlaced = 0;
    revealedCount = 0;
    updateTimer();
    updateMineCounter();

    board = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        row.push({ mine: false, revealed: false, flagged: false, adjacent: 0 });
      }
      board.push(row);
    }

    const picked = pickCellSize(cfg);
    boardEl.innerHTML = '';
    boardEl.style.setProperty('--cell-size', picked.size + 'px');
    boardEl.style.gridTemplateColumns = 'repeat(' + cols + ', ' + picked.size + 'px)';
    boardEl.style.gap = picked.gap + 'px';
    scale = 1;
    tx = 0;
    ty = 0;
    applyTransform();

    cells = [];
    for (let r = 0; r < rows; r++) {
      const rowEls = [];
      for (let c = 0; c < cols; c++) {
        const el = document.createElement('div');
        el.className = 'cell';
        el.dataset.r = r;
        el.dataset.c = c;
        el.addEventListener('click', onLeftClick);
        el.addEventListener('contextmenu', onRightClick);
        boardEl.appendChild(el);
        rowEls.push(el);
      }
      cells.push(rowEls);
    }

    messageEl.textContent = '';
    messageEl.className = 'message';
    restartBtn.textContent = '🔄 重新开始';
  }

  function placeMines(safeR, safeC) {
    const candidates = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (Math.abs(r - safeR) <= 1 && Math.abs(c - safeC) <= 1) continue;
        candidates.push([r, c]);
      }
    }
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = candidates[i];
      candidates[i] = candidates[j];
      candidates[j] = tmp;
    }
    for (let i = 0; i < mineTotal && i < candidates.length; i++) {
      const pos = candidates[i];
      board[pos[0]][pos[1]].mine = true;
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c].mine) continue;
        let count = 0;
        forEachNeighbor(r, c, function (nr, nc) {
          if (board[nr][nc].mine) count++;
        });
        board[r][c].adjacent = count;
      }
    }
  }
  function onLeftClick(e) {
    if (gameState === 'won' || gameState === 'lost') return;
    if (Date.now() - lastLongPress < 500) return;
    if (Date.now() < suppressClickUntil) return;
    reveal(Number(e.currentTarget.dataset.r), Number(e.currentTarget.dataset.c));
  }

  function getCellFromEvent(e) {
    const target = e.target;
    if (!target || typeof target.closest !== 'function') return null;
    return target.closest('.cell');
  }

  function onWrapTouchStart(e) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      activeTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
    }

    if (activeTouches.size === 1) {
      const t = e.changedTouches[0];
      touchStartX = t.clientX;
      touchStartY = t.clientY;
      lastX = t.clientX;
      lastY = t.clientY;
      singleTouchMoved = false;
      longPressCell = getCellFromEvent(e);

      clearTimeout(pressTimer);
      if (longPressCell && !longPressCell.classList.contains('revealed')) {
        pressTimer = setTimeout(function () {
          lastLongPress = Date.now();
          suppressClickUntil = Date.now() + 450;
          toggleFlag(Number(longPressCell.dataset.r), Number(longPressCell.dataset.c));
          if (navigator.vibrate) {
            try { navigator.vibrate(25); } catch (err) {}
          }
        }, 420);
      }
    } else if (activeTouches.size === 2) {
      clearTimeout(pressTimer);
      longPressCell = null;
      singleTouchMoved = true;
      const pts = Array.from(activeTouches.values());
      const gx = pts[0].x - pts[1].x;
      const gy = pts[0].y - pts[1].y;
      pinchStartDist = Math.sqrt(gx * gx + gy * gy) || 1;
      pinchStartScale = scale;
      suppressClickUntil = Date.now() + 450;
    }
  }

  function onWrapTouchMove(e) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (activeTouches.has(t.identifier)) {
        activeTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
    }

    if (activeTouches.size >= 2) {
      e.preventDefault();
      clearTimeout(pressTimer);
      longPressCell = null;
      singleTouchMoved = true;

      const pts = Array.from(activeTouches.values());
      const gx = pts[0].x - pts[1].x;
      const gy = pts[0].y - pts[1].y;
      const dist = Math.sqrt(gx * gx + gy * gy) || 1;

      let nextScale = pinchStartScale * (dist / pinchStartDist);
      if (nextScale < 1) nextScale = 1;
      if (nextScale > 3) nextScale = 3;

      const rect = wrapEl.getBoundingClientRect();
      const midX = (pts[0].x + pts[1].x) / 2 - rect.left;
      const midY = (pts[0].y + pts[1].y) / 2 - rect.top;
      const ratio = nextScale / scale;

      tx = midX - (midX - tx) * ratio;
      ty = midY - (midY - ty) * ratio;
      scale = nextScale;

      clampPan();
      suppressClickUntil = Date.now() + 450;
      return;
    }

    const t = e.touches[0];
    if (!t) return;

    if (!singleTouchMoved) {
      const dx = t.clientX - touchStartX;
      const dy = t.clientY - touchStartY;
      if (dx * dx + dy * dy > 225) {
        singleTouchMoved = true;
        clearTimeout(pressTimer);
        longPressCell = null;
        lastX = t.clientX;
        lastY = t.clientY;
      }
    } else if (scale > 1) {
      e.preventDefault();
      tx += t.clientX - lastX;
      ty += t.clientY - lastY;
      lastX = t.clientX;
      lastY = t.clientY;
      clampPan();
      suppressClickUntil = Date.now() + 450;
    }
  }

  function onWrapTouchEnd(e) {
    clearTimeout(pressTimer);
    longPressCell = null;
    for (let i = 0; i < e.changedTouches.length; i++) {
      activeTouches.delete(e.changedTouches[i].identifier);
    }
    if (activeTouches.size === 0) {
      singleTouchMoved = false;
    } else if (activeTouches.size === 1 && e.touches.length === 1) {
      lastX = e.touches[0].clientX;
      lastY = e.touches[0].clientY;
    }
  }

  function reveal(r, c) {
    const cell = board[r][c];
    if (cell.revealed || cell.flagged) return;

    if (firstClick) {
      firstClick = false;
      gameState = 'playing';
      placeMines(r, c);
      startTimer();
    }

    if (cell.mine) {
      loseGame(r, c);
      return;
    }

    floodReveal(r, c);
    checkWin();
  }

  function floodReveal(r, c) {
    const stack = [[r, c]];
    while (stack.length) {
      const pos = stack.pop();
      const cr = pos[0], cc = pos[1];
      const cell = board[cr][cc];
      if (cell.revealed || cell.flagged || cell.mine) continue;
      cell.revealed = true;
      revealedCount++;
      paintRevealed(cr, cc);
      if (cell.adjacent === 0) {
        forEachNeighbor(cr, cc, function (nr, nc) {
          const nb = board[nr][nc];
          if (!nb.revealed && !nb.flagged && !nb.mine) stack.push([nr, nc]);
        });
      }
    }
  }

  function paintRevealed(r, c) {
    const cell = board[r][c];
    const el = cells[r][c];
    el.classList.add('revealed');
    if (cell.adjacent > 0) {
      el.textContent = cell.adjacent;
      el.classList.add('n' + cell.adjacent);
    }
  }

  function onRightClick(e) {
    e.preventDefault();
    if (gameState === 'won' || gameState === 'lost') return;
    if (Date.now() - lastLongPress < 1000) return;
    const r = Number(e.currentTarget.dataset.r);
    const c = Number(e.currentTarget.dataset.c);
    const cell = board[r][c];
    if (cell.revealed) return;
    cell.flagged = !cell.flagged;
    flagsPlaced += cell.flagged ? 1 : -1;
    const el = cells[r][c];
    el.classList.toggle('flagged', cell.flagged);
    el.textContent = cell.flagged ? '🚩' : '';
    updateMineCounter();
  }

  function loseGame(hitR, hitC) {
    gameState = 'lost';
    stopTimer();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = board[r][c];
        const el = cells[r][c];
        if (cell.mine && !cell.flagged) {
          el.classList.add('revealed', 'mine');
          el.textContent = '💣';
        } else if (!cell.mine && cell.flagged) {
          el.classList.add('revealed', 'wrong');
          el.textContent = '❌';
        }
      }
    }
    const hitEl = cells[hitR][hitC];
    hitEl.classList.add('exploded');
    hitEl.textContent = '💥';
    messageEl.textContent = '💥 踩到雷了，游戏结束';
    messageEl.className = 'message lost';
    restartBtn.textContent = '🔄 再试一次';
  }

  function checkWin() {
    if (revealedCount !== rows * cols - mineTotal) return;

    gameState = 'won';
    stopTimer();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = board[r][c];
        if (cell.mine && !cell.flagged) {
          cell.flagged = true;
          const el = cells[r][c];
          el.classList.add('flagged');
          el.textContent = '🚩';
        }
      }
    }
    flagsPlaced = mineTotal;
    updateMineCounter();
    messageEl.textContent = '🎉 扫雷成功！用时 ' + seconds + ' 秒';
    messageEl.className = 'message won';
    restartBtn.textContent = '🔄 再来一局';
  }

  function startTimer() {
    stopTimer();
    timerId = setInterval(function () {
      seconds++;
      updateTimer();
    }, 1000);
  }

  function stopTimer() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function updateTimer() {
    timerEl.textContent = String(seconds).padStart(3, '0');
  }

  function updateMineCounter() {
    mineCountEl.textContent = mineTotal - flagsPlaced;
  }

  restartBtn.addEventListener('click', function () {
    initGame(currentLevel);
  });

  diffBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      diffBtns.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      initGame(btn.dataset.level);
    });
  });

  wrapEl.addEventListener('touchstart', onWrapTouchStart, { passive: false });
  wrapEl.addEventListener('touchmove', onWrapTouchMove, { passive: false });
  wrapEl.addEventListener('touchend', onWrapTouchEnd);
  wrapEl.addEventListener('touchcancel', onWrapTouchEnd);

  initGame('beginner');
})();
