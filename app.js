const WORKER_URL = 'https://english-translator.howardmed7.workers.dev';

let subtitles = [];
let currentSubIndex = -1;
let isWaitingTranslation = false;
let isSyncMode = false;
let detectInterval = null;

const player = document.getElementById('player');

// ── PARSEAR SRT ────────────────────────────────────────────────────────────
function parseSRT(text) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.trim().split(/\n\n+/);
  return blocks.map(block => {
    const lines = block.split('\n');
    const times = lines[1] && lines[1].match(/(\d{2}:\d{2}:\d{2}[,\.]\d{3}) --> (\d{2}:\d{2}:\d{2}[,\.]\d{3})/);
    if (!times) return null;
    return {
      start: timeToSeconds(times[1]),
      end:   timeToSeconds(times[2]),
      text:  lines.slice(2).join(' ').replace(/<[^>]+>/g, '').trim()
    };
  }).filter(Boolean);
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

function renderExplanation(text) {
  document.getElementById('explanation-text').textContent = text || '—';
  document.getElementById('explanation-bar').style.opacity = text ? '1' : '0.4';
}

function showSubtitle(text) {
  const el = document.getElementById('subtitle-overlay');
  el.innerHTML = ''; // Limpieza total antes de mostrar
  el.textContent = text;
  el.classList.add('visible');
}

function hideSubtitle() {
  document.getElementById('subtitle-overlay').classList.remove('visible');
}

function showLoading() { document.getElementById('loading-overlay').classList.add('active'); }
function hideLoading()  { document.getElementById('loading-overlay').classList.remove('active'); }

// ── LÓGICA DE DETECCIÓN (CORREGIDA) ──────────────────────────────────────
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

function stopDetection() { if (detectInterval) clearInterval(detectInterval); }

async function handleSubtitle(sub) {
  isWaitingTranslation = true;
  player.pause();
  showSubtitle(sub.text);
  showLoading();
  try {
    const data = await translateSubtitle(sub.text);
    renderWords(data.words);
    renderTranslations(data.translations);
    renderExplanation(data.explanation);
  } catch (e) {
    renderExplanation('Error al traducir.');
  } finally {
    hideLoading();
    isWaitingTranslation = false;
  }
}

player.addEventListener('play', startDetection);
player.addEventListener('pause', stopDetection);
player.addEventListener('ended', stopDetection);

// ── SEEK Y SINCRONIZACIÓN (ORIGINALES) ────────────────────────────────────
function seekVideo(delta) {
  const newTime = Math.max(0, player.currentTime + delta);
  player.currentTime = newTime;
  currentSubIndex = -1;
  hideSubtitle();
}

document.getElementById('btn-back10').addEventListener('click', () => seekVideo(-10));
document.getElementById('btn-fwd10').addEventListener('click', () => seekVideo(10));

function enterSyncMode() {
  isSyncMode = true; stopDetection(); player.pause();
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
  renderExplanation('Sincronización lista.');
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
document.getElementById('btn-sub-prev').addEventListener('click', () => { currentSubIndex = Math.max(0, currentSubIndex - 1); updateSyncDisplay(); });
document.getElementById('btn-sub-next').addEventListener('click', () => { currentSubIndex = Math.min(subtitles.length - 1, currentSubIndex + 1); updateSyncDisplay(); });

document.getElementById('srt-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => { subtitles = parseSRT(ev.target.result); renderExplanation('SRT cargado.'); };
  reader.readAsText(file);
});

document.getElementById('video-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  player.src = URL.createObjectURL(file);
});