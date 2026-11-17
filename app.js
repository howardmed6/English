const WORKER_URL = 'https://english-translator.howardmed7.workers.dev';

let subtitles = [];
let currentSubIndex = -1;
let isWaitingTranslation = false;
let isSyncMode = false;

const player = document.getElementById('player');

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
  const el  = document.getElementById('explanation-text');

  // Construir texto de explicación a partir de los campos del worker nuevo
  let parts = [];
  if (data.classification === 'dificil') {
    if (data.grammarConcept) parts.push(`[${data.grammarConcept}]`);
    if (data.explanation1)   parts.push(data.explanation1);
    if (data.explanation2)   parts.push(data.explanation2);
    if (data.relatedConcepts) parts.push(data.relatedConcepts);
  }

  const text = parts.join(' — ') || null;
  el.textContent = text || '—';
  bar.style.opacity = text ? '1' : '0.4';
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
  if (r < 0.005) return '#000000'; // 0.5% negro
  if (r < 0.010) return '#FFFFFF'; // 0.5% blanco
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
    document.getElementById('explanation-text').textContent = 'Error al traducir. Presiona play para continuar.';
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
  document.getElementById('explanation-text').textContent = 'Sincronización lista. Presiona play para continuar.';
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
    document.getElementById('explanation-text').textContent = `SRT cargado: ${subtitles.length} subtítulos`;
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
