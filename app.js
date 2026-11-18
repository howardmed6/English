const WORKER_URL = 'https://english-translator.howardmed7.workers.dev';

let subtitles = [];
let currentSubIndex = -1;
let isWaitingTranslation = false;
let isSyncMode = false;

const player = document.getElementById('player');

// ── CONTROLES SVG (rAF) ───────────────────────────────────────────────────
const ctrlPlay       = document.getElementById('ctrl-play');
const iconPlay       = document.getElementById('icon-play');
const iconPause      = document.getElementById('icon-pause');
const ctrlCurrent    = document.getElementById('ctrl-current');
const ctrlDuration   = document.getElementById('ctrl-duration');
const ctrlProgress   = document.getElementById('ctrl-progress');
const ctrlFill       = document.getElementById('ctrl-progress-fill');
const ctrlThumb      = document.getElementById('ctrl-progress-thumb');
const ctrlMute       = document.getElementById('ctrl-mute');
const iconVol        = document.getElementById('icon-vol');
const iconMuted      = document.getElementById('icon-muted');
const ctrlFs         = document.getElementById('ctrl-fullscreen');

function formatTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${ss}`;
}

// rAF loop — 60 fps, actualiza progreso y tiempo sin eventos lentos
let rafId = null;
function rafLoop() {
  if (player.duration) {
    const pct = player.currentTime / player.duration * 100;
    ctrlCurrent.textContent = formatTime(player.currentTime);
    ctrlFill.style.width = pct + '%';
    ctrlThumb.style.left  = pct + '%';
  }
  rafId = requestAnimationFrame(rafLoop);
}

// ── HELPERS de icono ──────────────────────────────────────────────────────
function setPlayIcon(playing) {
  iconPlay.style.display  = playing ? 'none'  : 'block';
  iconPause.style.display = playing ? 'block' : 'none';
}

function setMuteIcon(muted) {
  iconVol.style.display   = muted ? 'none'  : 'block';
  iconMuted.style.display = muted ? 'block' : 'none';
}

// ── EVENTOS DEL PLAYER ────────────────────────────────────────────────────
player.addEventListener('loadedmetadata', () => {
  ctrlDuration.textContent = formatTime(player.duration);
});

player.addEventListener('play', () => {
  setPlayIcon(true);
  if (!rafId) rafId = requestAnimationFrame(rafLoop);
});

player.addEventListener('pause', () => {
  setPlayIcon(false);
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
});

player.addEventListener('ended', () => {
  setPlayIcon(false);
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
});

player.addEventListener('volumechange', () => {
  setMuteIcon(player.muted);
});

// ── CLICS EN CONTROLES ───────────────────────────────────────────────────
ctrlPlay.addEventListener('click', () => {
  player.paused ? player.play() : player.pause();
});

// Click en el video → pausa/reanuda
player.addEventListener('click', () => {
  player.paused ? player.play() : player.pause();
});

ctrlMute.addEventListener('click', () => {
  player.muted = !player.muted;
});

ctrlFs.addEventListener('click', () => {
  if (!document.fullscreenElement) player.requestFullscreen();
  else document.exitFullscreen();
});

// ── BARRA DE PROGRESO: click ──────────────────────────────────────────────
ctrlProgress.addEventListener('click', e => {
  if (!player.duration) return;
  const rect = ctrlProgress.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  player.currentTime = pct * player.duration;
  currentSubIndex = -1;
  hideSubtitle();
});

// ── BARRA DE PROGRESO: drag ──────────────────────────────────────────────
let isDragging = false;

ctrlProgress.addEventListener('mousedown', e => {
  if (!player.duration) return;
  isDragging = true;
  seekByEvent(e);
});

document.addEventListener('mousemove', e => {
  if (!isDragging || !player.duration) return;
  seekByEvent(e);
});

document.addEventListener('mouseup', () => { isDragging = false; });

// Touch support
ctrlProgress.addEventListener('touchstart', e => {
  if (!player.duration) return;
  isDragging = true;
  seekByTouch(e);
}, { passive: true });

document.addEventListener('touchmove', e => {
  if (!isDragging || !player.duration) return;
  seekByTouch(e);
}, { passive: true });

document.addEventListener('touchend', () => { isDragging = false; });

function seekByEvent(e) {
  const rect = ctrlProgress.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  player.currentTime = pct * player.duration;
  ctrlFill.style.width = (pct * 100) + '%';
  ctrlThumb.style.left  = (pct * 100) + '%';
}

function seekByTouch(e) {
  const touch = e.touches[0];
  const rect = ctrlProgress.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
  player.currentTime = pct * player.duration;
  ctrlFill.style.width = (pct * 100) + '%';
  ctrlThumb.style.left  = (pct * 100) + '%';
}

// ── PARSEAR SRT ────────────────────────────────────────────────────────────
function parseSRT(text) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.trim().split(/\n\n+/);
  const result = blocks.map(block => {
    const lines = block.split('\n');
    const times = lines[1] && lines[1].match(/(\d{2}:\d{2}:\d{2}[,\.]\d{3}) --> (\d{2}:\d{2}:\d{2}[,\.]\d{3})/);
    if (!times) return null;
    return {
      start: timeToSeconds(times[1]),
      end:   timeToSeconds(times[2]),
      text:  lines.slice(2).join(' ').replace(/<[^>]+>/g, '').trim()
    };
  }).filter(Boolean);
  console.log('SRT parsed:', result.length, 'subtitles. First:', result[0]);
  return result;
}

function timeToSeconds(t) {
  const [h, m, s] = t.replace(',', '.').split(':');
  return parseFloat(h) * 3600 + parseFloat(m) * 60 + parseFloat(s);
}

// ── API ────────────────────────────────────────────────────────────────────
async function translateSubtitle(text) {
  const res = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subtitle: text })
  });
  return await res.json();
}

// ── RENDER ─────────────────────────────────────────────────────────────────
function renderWords(words) {
  document.getElementById('words-list').innerHTML = words.map(w => `
    <div class="word-row">
      <span class="word-en">${w.english}</span>
      <span class="word-sep">:</span>
      <span class="word-es">${w.meanings.slice(0, 6).join(', ')}</span>
    </div>`).join('');
}

function renderTranslations(t) {
  document.getElementById('t-literal').textContent = t.literal || '—';
  document.getElementById('t-natural').textContent = t.natural || '—';
  const a1 = document.getElementById('alt1-row');
  const a2 = document.getElementById('alt2-row');
  if (t.alt1) { document.getElementById('t-alt1').textContent = t.alt1; a1.style.display = 'flex'; }
  else a1.style.display = 'none';
  if (t.alt2) { document.getElementById('t-alt2').textContent = t.alt2; a2.style.display = 'flex'; }
  else a2.style.display = 'none';
}

function renderExplanation(data) {
  const bar = document.getElementById('explanation-bar');
  const el1 = document.getElementById('explanation-text-1');
  const el2 = document.getElementById('explanation-text-2');
  const el3 = document.getElementById('explanation-text-3');
  if (data.classification === 'dificil') {
    const concept = data.grammarConcept ? `[${data.grammarConcept}] ` : '';
    el1.textContent = (concept + (data.explanation1 || '')) || '—';
    el2.textContent = data.explanation2 || '—';
    el3.textContent = data.relatedConcepts || '—';
    bar.style.opacity = '1';
  } else {
    el1.textContent = '—';
    el2.textContent = '—';
    el3.textContent = '—';
    bar.style.opacity = '0.4';
  }
}

const SUBTITLE_COLORS = [
  '#FF6B6B','#FF8E53','#FFC300','#F9F871','#A8E063','#56CCF2','#6FCF97','#BB6BD9',
  '#FF9FF3','#54A0FF','#5F27CD','#00D2D3','#FF9F43','#EE5A24','#C8D6E5','#8395A7',
  '#F368E0','#FF6B81','#FFA502','#ECCC68','#7BED9F','#70A1FF','#5352ED','#FF4757',
  '#2ED573','#1E90FF','#FF6348','#FFA500','#FFD700','#ADFF2F','#00CED1','#DA70D6',
  '#FF69B4','#40E0D0','#EE82EE','#FA8072','#00FA9A','#87CEEB','#DDA0DD','#F0E68C',
  '#90EE90','#FFB6C1','#20B2AA','#87CEFA','#778899','#B0C4DE','#FFDEAD','#9ACD32',
  '#FF7F50','#6495ED','#DC143C','#00FFFF','#00008B','#008B8B','#B8860B','#A9A9A9',
  '#006400','#BDB76B','#8B008B','#556B2F','#FF8C00','#9932CC','#8B0000','#E9967A',
  '#8FBC8F','#483D8B','#2F4F4F','#00CED1','#9400D3','#FF1493','#00BFFF','#696969',
  '#1E90FF','#B22222','#FFFACD','#228B22','#FF00FF','#DCDCDC','#F8F8FF','#FFD700',
  '#DAA520','#808080','#008000','#ADFF2F','#F0FFF0','#FF69B4','#CD5C5C','#4B0082',
  '#FFFFF0','#F0E68C','#E6E6FA','#FFF0F5','#7CFC00','#FFFACD','#ADD8E6','#F08080',
  '#E0FFFF','#FAFAD2','#90EE90','#FFB6C1','#FFE4B5'
];

function randomSubtitleColor() {
  const r = Math.random();
  if (r < 0.005) return '#000000';
  if (r < 0.010) return '#FFFFFF';
  return SUBTITLE_COLORS[Math.floor(Math.random() * SUBTITLE_COLORS.length)];
}

function showSubtitle(text) {
  const el = document.getElementById('subtitle-overlay');
  el.textContent = text;
  el.style.color = randomSubtitleColor();
  el.classList.add('visible');
}

function hideSubtitle() {
  const el = document.getElementById('subtitle-overlay');
  el.textContent = '';
  el.classList.remove('visible');
}

function showLoading() { document.getElementById('loading-overlay').classList.add('active'); }
function hideLoading()  { document.getElementById('loading-overlay').classList.remove('active'); }

// ── DETECCIÓN DE SUBTÍTULOS ────────────────────────────────────────────────
let detectInterval = null;

function startDetection() {
  stopDetection();
  detectInterval = setInterval(() => {
    if (isWaitingTranslation || isSyncMode || player.paused) return;
    const t = player.currentTime;
    const idx = subtitles.findIndex(s => t >= s.start && t <= s.end);
    if (idx !== -1 && idx !== currentSubIndex) {
      currentSubIndex = idx;
      handleSubtitle(subtitles[idx]);
    }
  }, 200);
}

function stopDetection() {
  if (detectInterval) clearInterval(detectInterval);
  detectInterval = null;
}

async function handleSubtitle(sub) {
  isWaitingTranslation = true;
  player.pause();
  showSubtitle(sub.text);
  showLoading();
  try {
    const data = await translateSubtitle(sub.text);
    renderWords(data.words);
    renderTranslations(data.translations);
    renderExplanation(data);
  } catch (e) {
    document.getElementById('explanation-text-1').textContent = 'Error al traducir. Presiona play para continuar.';
  }
  hideLoading();
  isWaitingTranslation = false;
}

player.addEventListener('play',  startDetection);
player.addEventListener('pause', stopDetection);
player.addEventListener('ended', stopDetection);

// ── SEEK ±10s ──────────────────────────────────────────────────────────────
let seekCooldown = false;

function seekVideo(delta) {
  if (seekCooldown) return;
  seekCooldown = true;
  setTimeout(() => seekCooldown = false, 300);
  const newTime = Math.max(0, player.currentTime + delta);
  player.currentTime = newTime;
  currentSubIndex = -1;
  hideSubtitle();
}

document.getElementById('btn-back10').addEventListener('click', () => seekVideo(-10));
document.getElementById('btn-fwd10').addEventListener('click',  () => seekVideo(10));

// ── SINCRONIZACIÓN ─────────────────────────────────────────────────────────
function enterSyncMode() {
  isSyncMode = true;
  stopDetection();
  player.pause();
  document.getElementById('sync-controls').style.display = 'flex';
  document.getElementById('btn-sync').style.display = 'none';
  if (currentSubIndex === -1 && subtitles.length > 0) currentSubIndex = 0;
  updateSyncDisplay();
}

function exitSyncMode() {
  isSyncMode = false;
  document.getElementById('sync-controls').style.display = 'none';
  document.getElementById('btn-sync').style.display = 'flex';
  if (subtitles[currentSubIndex]) player.currentTime = subtitles[currentSubIndex].start;
  document.getElementById('explanation-text-1').textContent = 'Sincronización lista. Presiona play para continuar.';
}

function shiftSubtitle(delta) {
  const idx = Math.max(0, Math.min(subtitles.length - 1, currentSubIndex + delta));
  currentSubIndex = idx;
  updateSyncDisplay();
}

function updateSyncDisplay() {
  const sub = subtitles[currentSubIndex];
  if (!sub) return;
  showSubtitle(sub.text);
  document.getElementById('sync-index').textContent = `Subtítulo ${currentSubIndex + 1} / ${subtitles.length}`;
  document.getElementById('sync-text').textContent = sub.text;
}

document.getElementById('btn-sync').addEventListener('click', enterSyncMode);
document.getElementById('btn-sync-done').addEventListener('click', exitSyncMode);
document.getElementById('btn-sub-prev').addEventListener('click', () => shiftSubtitle(-1));
document.getElementById('btn-sub-next').addEventListener('click', () => shiftSubtitle(1));

// ── CARGAR SRT ─────────────────────────────────────────────────────────────
document.getElementById('srt-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    subtitles = parseSRT(ev.target.result);
    currentSubIndex = -1;
    hideSubtitle();
    document.getElementById('explanation-text-1').textContent = `SRT cargado: ${subtitles.length} subtítulos`;
  };
  reader.readAsText(file);
});

// ── CARGAR VIDEO ───────────────────────────────────────────────────────────
document.getElementById('video-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  player.src = URL.createObjectURL(file);
  currentSubIndex = -1;
  hideSubtitle();
});

// ── TECLADO ────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (isSyncMode) return;
  if (e.repeat) return;
  switch (e.code) {
    case 'Space':
      e.preventDefault();
      player.paused ? player.play() : player.pause();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      seekVideo(-10);
      break;
    case 'ArrowRight':
      e.preventDefault();
      seekVideo(10);
      break;
  }
});
