// ── URL DEL WORKER ─────────────────────────────────────────────────────────
const WORKER_URL = 'https://english-translator.howardmed7.workers.dev';

// ── ESTADO ─────────────────────────────────────────────────────────────────
let subtitles = [];
let currentSubIndex = -1;
let isWaitingTranslation = false;
let isSyncMode = false;
let trackBlobUrl = null;

const player = document.getElementById('player');

// ── CONVERTIR SRT A VTT ────────────────────────────────────────────────────
function srtToVtt(srt) {
  const normalized = srt.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const vtt = 'WEBVTT\n\n' + normalized
    .trim()
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return vtt;
}

// ── PARSEAR SRT (para nuestro array de subtítulos) ─────────────────────────
function parseSRT(text) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.trim().split(/\n\n+/);
  return blocks.map(block => {
    const lines = block.split('\n');
    const times = lines[1] && lines[1].match(/(\d{2}:\d{2}:\d{2}[,\.]\d{3}) --> (\d{2}:\d{2}:\d{2}[,\.]\d{3})/);
    if (!times) return null;
    return {
      start: timeToSeconds(times[1]),
      end: timeToSeconds(times[2]),
      text: lines.slice(2).join(' ').replace(/<[^>]+>/g, '').trim()
    };
  }).filter(Boolean);
}

function timeToSeconds(t) {
  const [h, m, s] = t.replace(',', '.').split(':');
  return parseFloat(h) * 3600 + parseFloat(m) * 60 + parseFloat(s);
}

// ── CARGAR TRACK VTT EN EL VIDEO ───────────────────────────────────────────
function loadTrack(srtText) {
  // Limpiar track anterior
  const oldTrack = player.querySelector('track');
  if (oldTrack) oldTrack.remove();
  if (trackBlobUrl) URL.revokeObjectURL(trackBlobUrl);

  const vtt = srtToVtt(srtText);
  const blob = new Blob([vtt], { type: 'text/vtt' });
  trackBlobUrl = URL.createObjectURL(blob);

  const track = document.createElement('track');
  track.kind = 'subtitles';
  track.srclang = 'en';
  track.src = trackBlobUrl;
  track.default = true;
  player.appendChild(track);

  // Esperar a que cargue y activar
  track.addEventListener('load', () => {
    player.textTracks[0].mode = 'hidden'; // ocultamos los nativos, usamos los nuestros
    attachCueListener();
  });
}

// ── ESCUCHAR CUES DEL TRACK ────────────────────────────────────────────────
function attachCueListener() {
  const textTrack = player.textTracks[0];
  if (!textTrack) return;

  textTrack.addEventListener('cuechange', () => {
    if (isWaitingTranslation || isSyncMode) return;

    const activeCues = textTrack.activeCues;
    if (!activeCues || activeCues.length === 0) {
      hideSubtitle();
      return;
    }

    const cueText = activeCues[0].text.replace(/<[^>]+>/g, '').trim();

    // Buscar el índice en nuestro array
    const idx = subtitles.findIndex(s => s.text === cueText);
    if (idx !== -1 && idx !== currentSubIndex) {
      currentSubIndex = idx;
      handleSubtitle(subtitles[idx]);
    }
  });
}

// ── LLAMAR AL WORKER ───────────────────────────────────────────────────────
async function translateSubtitle(text) {
  const res = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subtitle: text })
  });
  return await res.json();
}

// ── RENDERIZAR ─────────────────────────────────────────────────────────────
function renderWords(words) {
  const list = document.getElementById('words-list');
  list.innerHTML = words.map(w => `
    <div class="word-row">
      <span class="word-en">${w.english}</span>
      <span class="word-sep">:</span>
      <span class="word-es">${w.meanings.slice(0, 6).join(', ')}</span>
    </div>
  `).join('');
}

function renderTranslations(t) {
  document.getElementById('t-literal').textContent = t.literal || '—';
  document.getElementById('t-natural').textContent = t.natural || '—';
  const alt1Row = document.getElementById('alt1-row');
  const alt2Row = document.getElementById('alt2-row');
  if (t.alt1) { document.getElementById('t-alt1').textContent = t.alt1; alt1Row.style.display = 'flex'; }
  else alt1Row.style.display = 'none';
  if (t.alt2) { document.getElementById('t-alt2').textContent = t.alt2; alt2Row.style.display = 'flex'; }
  else alt2Row.style.display = 'none';
}

function renderExplanation(text) {
  document.getElementById('explanation-text').textContent = text || '—';
  document.getElementById('explanation-bar').style.opacity = text ? '1' : '0.4';
}

function showSubtitle(text) {
  const el = document.getElementById('subtitle-overlay');
  el.textContent = text;
  el.classList.add('visible');
}

function hideSubtitle() {
  const el = document.getElementById('subtitle-overlay');
  el.textContent = '';
  el.classList.remove('visible');
}

function showLoading() {
  document.getElementById('loading-overlay').classList.add('active');
}

function hideLoading() {
  document.getElementById('loading-overlay').classList.remove('active');
}

// ── MANEJAR SUBTÍTULO ──────────────────────────────────────────────────────
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
    renderExplanation('Error al traducir. Presiona play para continuar.');
  }
  hideLoading();
  isWaitingTranslation = false;
}

// ── BOTONES ±10 SEGUNDOS ───────────────────────────────────────────────────
function seekVideo(delta) {
  player.currentTime = Math.max(0, player.currentTime + delta);
}

document.getElementById('btn-back10').addEventListener('click', () => seekVideo(-10));
document.getElementById('btn-fwd10').addEventListener('click', () => seekVideo(10));

// ── MODO SINCRONIZACIÓN ────────────────────────────────────────────────────
function enterSyncMode() {
  isSyncMode = true;
  player.pause();
  document.getElementById('sync-controls').style.display = 'flex';
  document.getElementById('btn-sync').style.display = 'none';
  updateSyncDisplay();
}

function exitSyncMode() {
  isSyncMode = false;
  document.getElementById('sync-controls').style.display = 'none';
  document.getElementById('btn-sync').style.display = 'flex';
  if (subtitles[currentSubIndex]) {
    player.currentTime = subtitles[currentSubIndex].start;
  }
  renderExplanation('Sincronización lista. Presiona play para continuar.');
}

function shiftSubtitle(delta) {
  const newIndex = currentSubIndex + delta;
  if (newIndex >= 0 && newIndex < subtitles.length) {
    currentSubIndex = newIndex;
    updateSyncDisplay();
  }
}

function updateSyncDisplay() {
  const sub = subtitles[currentSubIndex];
  if (sub) {
    showSubtitle(sub.text);
    document.getElementById('sync-index').textContent = `Subtítulo ${currentSubIndex + 1} / ${subtitles.length}`;
    document.getElementById('sync-text').textContent = sub.text;
  }
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
    const srtText = ev.target.result;
    subtitles = parseSRT(srtText);
    currentSubIndex = -1;
    hideSubtitle();
    loadTrack(srtText);
    renderExplanation(`SRT cargado: ${subtitles.length} subtítulos`);
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

// ── ATAJOS DE TECLADO ─────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (isSyncMode) return;
  switch(e.code) {
    case 'Space':
      e.preventDefault();
      if (player.paused) player.play();
      else player.pause();
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