// ── URL DEL WORKER ─────────────────────────────────────────────────────────
const WORKER_URL = 'https://english-translator.howardmed7.workers.dev';

// ── SISTEMA DE SUBTÍTULOS ──────────────────────────────────────────────────
let subtitles = [];
let currentSubIndex = -1;
let isWaitingTranslation = false;

// ── PARSEAR SRT ────────────────────────────────────────────────────────────
function parseSRT(text) {
  const blocks = text.trim().split(/\n\n+/);
  return blocks.map(block => {
    const lines = block.split('\n');
    const times = lines[1].match(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/);
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
  document.getElementById('subtitle-overlay').classList.remove('visible');
}

function showLoading() {
  document.getElementById('loading-overlay').classList.add('active');
}

function hideLoading() {
  document.getElementById('loading-overlay').classList.remove('active');
}

// ── LÓGICA DEL VIDEO ───────────────────────────────────────────────────────
const player = document.getElementById('player');

player.addEventListener('timeupdate', () => {
  if (isWaitingTranslation) return;
  const t = player.currentTime;
  const idx = subtitles.findIndex(s => t >= s.start && t <= s.end);
  if (idx !== -1 && idx !== currentSubIndex) {
    currentSubIndex = idx;
    handleSubtitle(subtitles[idx]);
  }
});

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

// ── CARGAR SRT ─────────────────────────────────────────────────────────────
document.getElementById('srt-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => { subtitles = parseSRT(ev.target.result); };
  reader.readAsText(file);
});

// ── CARGAR VIDEO ───────────────────────────────────────────────────────────
document.getElementById('video-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  player.src = URL.createObjectURL(file);
});