const WORKER_URL = 'https://english-translator.howardmed7.workers.dev';

let subtitles = [];
let currentSubIndex = -1;
let isWaitingTranslation = false;
let isSyncMode = false;

const player = document.getElementById('player');

// ── PARSEAR SRT ────────────────────────────────────────────────────────────
function parseSRT(text) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.trim().split(/\n\s*\n/);

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

function renderExplanation(text) {
  document.getElementById('explanation-text').textContent = text || '—';
  document.getElementById('explanation-bar').style.opacity = text ? '1' : '0.4';
}

function showSubtitle(text) {
  const el = document.getElementById('subtitle-overlay');
  el.innerHTML = ''; // limpia el texto anterior para evitar apilamiento
  el.textContent = text;
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
    } else if (idx === -1 && currentSubIndex !== -1) {
      // FIX: antes esto no hacía nada y el subtítulo se quedaba
      // pegado en pantalla hasta que empezaba el siguiente.
      hideSubtitle();
      currentSubIndex = -1;
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
    renderExplanation(data.explanation);
  } catch (e) {
    renderExplanation('Error al traducir. Presiona play para continuar.');
  }
  hideLoading();
  isWaitingTranslation = false;
}

player.addEventListener('play',  startDetection);
player.addEventListener('pause', stopDetection);
player.addEventListener('ended', stopDetection);

// ── SEEK ±10s ──────────────────────────────────────────────────────────────
// NOTA: si el salto real termina siendo mayor a 10s de forma consistente,
// el problema es el video (keyframes espaciados / GOP largo), no esta función.
// Re-codifica el archivo con: ffmpeg -i in.mp4 -c:v libx264 -preset ultrafast
// -crf 28 -g 25 -keyint_min 25 -sc_threshold 0 -c:a copy out.mp4
let seekCooldown = false;

function seekVideo(delta) {
  if (seekCooldown) return;
  seekCooldown = true;
  setTimeout(() => seekCooldown = false, 300);

  const target = Math.max(0, Math.min(player.duration || Infinity, player.currentTime + delta));
  player.currentTime = target;
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
  renderExplanation('Sincronización lista. Presiona play para continuar.');
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

// ── TECLADO ────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (isSyncMode) return;
  if (e.repeat) return; // ignorar tecla mantenida
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