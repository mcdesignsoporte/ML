
    const state = {
      images: [],
      stops: [],
      startPoint: null,
      screenStream: null,
      recorder: null,
      recordingUrl: '',
      autoCaptureTimer: null,
    };

    const $ = (id) => document.getElementById(id);
    const statusEl = $('status');
    const progressWrap = $('progressWrap');
    const progressLabel = $('progressLabel');
    const progressBar = $('progressBar');
    const screenVideo = $('screenVideo');
    let ocrLoaderPromise = null;

    function uid() {
      return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }

    function setOcrButtonsDisabled(disabled) {
      ['btnRunOcr', 'btnDetectScreen', 'btnCaptureFrame'].forEach((id) => {
        const el = $(id);
        if (el) el.disabled = !!disabled;
      });
    }

    function loadScriptOnce(src) {
      return new Promise((resolve, reject) => {
        const existing = Array.from(document.querySelectorAll('script')).find((s) => s.src === src);
        if (existing) {
          if (window.Tesseract) {
            resolve(window.Tesseract);
            return;
          }
          existing.addEventListener('load', () => resolve(window.Tesseract), { once: true });
          existing.addEventListener('error', () => reject(new Error(`No se pudo cargar ${src}`)), { once: true });
          return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve(window.Tesseract);
        script.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
        document.head.appendChild(script);
      });
    }

    async function ensureTesseractLoaded() {
      if (window.Tesseract) return window.Tesseract;
      if (ocrLoaderPromise) return ocrLoaderPromise;

      const sources = [
        './vendor/tesseract.min.js',
        'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
        'https://unpkg.com/tesseract.js@5/dist/tesseract.min.js',
      ];

      ocrLoaderPromise = (async () => {
        let lastError = null;
        for (const src of sources) {
          try {
            await loadScriptOnce(src);
            if (window.Tesseract) return window.Tesseract;
          } catch (error) {
            lastError = error;
          }
        }
        const localHint = location.protocol === 'file:'
          ? ' Abre la app desde GitHub Pages o con un servidor local para que el OCR cargue mejor.'
          : '';
        throw new Error(`No se pudo cargar el motor OCR.${localHint}${lastError ? ' ' + lastError.message : ''}`);
      })();

      try {
        return await ocrLoaderPromise;
      } finally {
        if (!window.Tesseract) ocrLoaderPromise = null;
      }
    }

    const normalize = (value) =>
      (value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

    const cleanAddress = (text) =>
      (text || '')
        .replace(/[|]+/g, ' ')
        .replace(/[•·]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/,+/g, ',')
        .trim();

    
const STREET_HINTS = [
  'calle', 'av', 'avenida', 'blvd', 'boulevard', 'privada', 'prol', 'prolongacion',
  'circuito', 'camino', 'carretera', 'fracc', 'fraccionamiento', 'col', 'colonia',
  'eje', 'torre', 'cerrada', 'andador', 'retorno', 'mision', 'san ', 'villa ',
  'lote', 'manzana', 'int', 'interior', 'ext', 'numero', 'no', 'cp', 'c.p', 'slp',
  'san luis potosi', 'mexico'
];

const LOCALITY_HINTS = [
  'san luis potosi', 's.l.p', 'slp', 'pozos', 'villa de pozos', 'mision del palmar',
  'los silos', 'fraccionamiento', 'residencial', 'colonia', 'villas', 'privadas'
];

const IGNORE_PATTERNS = [
  /\bmercado libre\b/i,
  /\bestoy llegando\b/i,
  /\bentrega\b/i,
  /\betiqueta\b/i,
  /\bhorario comercial\b/i,
  /\bpedido\b/i,
  /\bcliente\b/i,
  /\btelefono\b/i,
  /\bobservaciones\b/i,
  /\bnotas\b/i,
  /\bzona\b/i,
  /\bcobro\b/i,
  /\bpaquete\b/i,
  /\bunidad\b/i,
  /\bhs\b/i,
  /\b\d{1,2}:\d{2}\b/,
];

function hasStreetHint(text) {
  return STREET_HINTS.some((hint) => text.includes(hint));
}

function hasHouseNumber(text) {
  return /\b\d+[a-zA-Z-]*\b|\b[a-zA-Z-]*\d+[a-zA-Z-]*\b/.test(text);
}

function hasZipCode(text) {
  return /(^|\D)\d{5}(\D|$)/.test(text);
}

function hasLocalityHint(text) {
  return LOCALITY_HINTS.some((hint) => text.includes(hint));
}

function looksLikeLocalityOnly(text) {
  return hasLocalityHint(text) && !hasStreetHint(text) && !hasHouseNumber(text);
}

function isNoiseLine(text) {
  if (!text || text.length < 6) return true;
  if (IGNORE_PATTERNS.some((pattern) => pattern.test(text))) return true;
  if (/^[\[\](){}.,\-–—_:;]+$/.test(text)) return true;
  if (/^\d+[.)-]?\s*$/.test(text)) return true;
  return false;
}

function isGenericFragment(text) {
  const norm = normalize(text);
  const words = norm.split(' ').filter(Boolean);
  if (/^(casa|domicilio|frente|atras|atrás|junto)\b/.test(norm) && !hasStreetHint(norm) && !hasZipCode(norm)) return true;
  if (words.length <= 2 && !hasStreetHint(norm) && !hasZipCode(norm)) return true;
  return false;
}

function addressScore(value) {
  const text = normalize(value);
  let score = 0;
  if (hasStreetHint(text)) score += 2;
  if (hasHouseNumber(text)) score += 2;
  if (hasZipCode(text)) score += 2;
  if (hasLocalityHint(text)) score += 1;
  if ((text.match(/,/g) || []).length >= 1) score += 1;
  if (/\b[a-zA-Záéíóúñ]{4,}\s+\d+[a-zA-Z-]*\b/i.test(value)) score += 1;
  if (/\b(calle|avenida|av\.?|prol\.?|privada|eje|torre)\b/i.test(value)) score += 1;
  if (isGenericFragment(text)) score -= 3;
  if (isNoiseLine(text)) score -= 4;
  return score;
}


function likelyAddress(line) {
  return addressScore(line) >= 3;
}

function extractAddressCandidates(raw) {
  const lines = (raw || '')
    .split(/\n+/)
    .map((line) => cleanAddress(line))
    .filter(Boolean)
    .filter((line) => !isNoiseLine(normalize(line)));

  const candidates = [];

  for (let i = 0; i < lines.length; i += 1) {
    const current = lines[i];
    const currentNorm = normalize(current);
    const next = lines[i + 1] || '';
    const nextNorm = normalize(next);

    if (isNoiseLine(currentNorm)) continue;

    let candidate = current;
    const currentPartial = (
      (hasStreetHint(currentNorm) && !hasHouseNumber(currentNorm) && !hasZipCode(currentNorm)) ||
      /[,\-]$/.test(current) ||
      (current.length < 24 && hasStreetHint(currentNorm)) ||
      (hasHouseNumber(currentNorm) && !hasLocalityHint(currentNorm) && next && looksLikeLocalityOnly(nextNorm))
    );

    if (currentPartial && next && !isNoiseLine(nextNorm)) {
      if (looksLikeLocalityOnly(nextNorm) || (hasZipCode(nextNorm) && !hasStreetHint(nextNorm))) {
        candidate = cleanAddress(`${current}, ${next}`);
        i += 1;
      }
    }

    if (!likelyAddress(candidate)) {
      if (hasHouseNumber(currentNorm) && currentNorm.split(' ').length >= 3 && !isGenericFragment(currentNorm)) {
        candidate = current;
      } else {
        continue;
      }
    }

    if (isGenericFragment(normalize(candidate)) && !hasZipCode(normalize(candidate)) && !hasStreetHint(normalize(candidate))) {
      continue;
    }

    candidates.push(candidate);
  }

  const unique = [];
  const seen = new Set();
  for (const item of candidates) {
    const key = normalize(item);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }
  return unique.slice(0, 500);
}

function mergeAddresses(addresses, source = 'ocr') {
      const seen = new Set(state.stops.map((s) => normalize(s.address)));
      let added = 0;
      addresses.forEach((address) => {
        const cleaned = cleanAddress(address);
        const key = normalize(cleaned);
        if (!cleaned || seen.has(key)) return;
        seen.add(key);
        state.stops.push({
          id: uid(),
          address: cleaned,
          source,
          lat: null,
          lng: null,
          normalizedLabel: '',
          geocodeStatus: 'pendiente',
        });
        added += 1;
      });
      syncManualTextFromStops();
      renderStops();
      renderRouteBlocks();
      return added;
    }

    function syncManualTextFromStops() {
      $('manualText').value = state.stops.map((s) => s.address).join('\n');
    }

    function updateStats() {
      const resolved = state.stops.filter((s) => s.lat && s.lng).length;
      $('statStops').textContent = state.stops.length;
      $('statResolved').textContent = resolved;
      $('statUnresolved').textContent = state.stops.length - resolved;
      $('statBlocks').textContent = buildRouteBatches().length;
      $('routeSummary').textContent = state.stops.length
        ? (state.stops.length - resolved > 0
            ? `Hay ${state.stops.length - resolved} direcciones pendientes de ubicar. Corrígelas antes de salir.`
            : 'Todas las direcciones tienen coordenadas. Ya puedes abrir la ruta por bloques.')
        : 'Todavía no hay suficientes direcciones procesadas.';
    }

    function renderPreviews() {
      const grid = $('previewGrid');
      grid.innerHTML = '';
      state.images.forEach((image) => {
        const div = document.createElement('div');
        div.className = 'preview';
        div.innerHTML = `
          <img src="${image.url}" alt="${image.name}" />
          <div class="meta">
            <div>
              <div class="small"><strong>${image.name}</strong></div>
              <div class="small muted">${image.source}</div>
            </div>
            <button class="btn-danger small" data-remove-image="${image.id}">Quitar</button>
          </div>
        `;
        grid.appendChild(div);
      });

      grid.querySelectorAll('[data-remove-image]').forEach((btn) => {
        btn.onclick = () => {
          const id = btn.getAttribute('data-remove-image');
          const image = state.images.find((x) => x.id === id);
          if (image && image.url.startsWith('blob:')) URL.revokeObjectURL(image.url);
          state.images = state.images.filter((x) => x.id !== id);
          renderPreviews();
        };
      });
    }

    function renderStops() {
      const list = $('stopsList');
      list.innerHTML = '';
      state.stops.forEach((stop, index) => {
        const div = document.createElement('div');
        div.className = 'stop';
        div.innerHTML = `
          <div class="stop-head">
            <div class="index">${index + 1}</div>
            <div>
              <input data-stop-input="${stop.id}" value="${escapeHtml(stop.address)}" />
              <div class="row" style="margin-top:8px;">
                <span class="badge">${stop.source}</span>
                <span class="badge">${stop.geocodeStatus === 'ok' ? 'ubicada' : stop.geocodeStatus}</span>
                ${stop.normalizedLabel ? `<span class="badge">${escapeHtml(stop.normalizedLabel)}</span>` : ''}
              </div>
            </div>
            <div class="row">
              <button class="btn-secondary small" data-up="${stop.id}">↑</button>
              <button class="btn-secondary small" data-down="${stop.id}">↓</button>
              <button class="btn-danger small" data-delete="${stop.id}">✕</button>
            </div>
          </div>
        `;
        list.appendChild(div);
      });

      list.querySelectorAll('[data-stop-input]').forEach((input) => {
        input.onchange = () => {
          const stop = state.stops.find((s) => s.id === input.getAttribute('data-stop-input'));
          if (!stop) return;
          stop.address = cleanAddress(input.value);
          stop.lat = null;
          stop.lng = null;
          stop.normalizedLabel = '';
          stop.geocodeStatus = 'pendiente';
          syncManualTextFromStops();
          updateStats();
          renderStops();
        };
      });

      list.querySelectorAll('[data-delete]').forEach((btn) => {
        btn.onclick = () => {
          const id = btn.getAttribute('data-delete');
          state.stops = state.stops.filter((s) => s.id !== id);
          syncManualTextFromStops();
          renderStops();
          renderRouteBlocks();
        };
      });

      list.querySelectorAll('[data-up]').forEach((btn) => {
        btn.onclick = () => moveStop(btn.getAttribute('data-up'), -1);
      });
      list.querySelectorAll('[data-down]').forEach((btn) => {
        btn.onclick = () => moveStop(btn.getAttribute('data-down'), 1);
      });
      updateStats();
    }

    function moveStop(id, delta) {
      const idx = state.stops.findIndex((s) => s.id === id);
      const next = idx + delta;
      if (idx < 0 || next < 0 || next >= state.stops.length) return;
      [state.stops[idx], state.stops[next]] = [state.stops[next], state.stops[idx]];
      syncManualTextFromStops();
      renderStops();
      renderRouteBlocks();
    }

    function splitIntoBatches(items, batchSize) {
      const out = [];
      for (let i = 0; i < items.length; i += batchSize) out.push(items.slice(i, i + batchSize));
      return out;
    }

    function buildGoogleMapsDirectionsUrl(batch, origin) {
      if (!batch.length) return '#';
      const destination = batch[batch.length - 1].address;
      const waypoints = batch.slice(0, -1).map((stop) => stop.address).join('|');
      const params = new URLSearchParams({ api: '1', travelmode: 'driving', destination });
      if (origin && origin.trim()) params.set('origin', origin.trim());
      if (waypoints) params.set('waypoints', waypoints);
      return `https://www.google.com/maps/dir/?${params.toString()}`;
    }

    function buildRouteBatches() {
      const batchSize = Math.max(1, Number($('batchSize').value || 9));
      return splitIntoBatches(state.stops.filter((s) => s.address.trim()), batchSize).map((batch) => ({
        id: uid(),
        batch,
        url: buildGoogleMapsDirectionsUrl(batch, $('startAddress').value || ''),
      }));
    }

    function renderRouteBlocks() {
      const holder = $('routeBlocks');
      holder.innerHTML = '';
      const blocks = buildRouteBatches();
      blocks.forEach((block, idx) => {
        const div = document.createElement('div');
        div.className = 'route-block';
        div.innerHTML = `
          <div class="row space">
            <div>
              <strong>Bloque ${idx + 1}</strong>
              <div class="muted">${block.batch.length} parada(s)</div>
            </div>
            <a class="btn-link" href="${block.url}" target="_blank" rel="noreferrer">Abrir ruta</a>
          </div>
          <div class="section">
            ${block.batch.map((stop, i) => `<div class="route-stop">${i + 1}. ${escapeHtml(stop.address)}</div>`).join('')}
          </div>
        `;
        holder.appendChild(div);
      });
      updateStats();
    }

    async function geocodeNominatim(query) {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=mx&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('No se pudo consultar el geocodificador');
      const data = await res.json();
      if (!data.length) return null;
      return {
        lat: Number(data[0].lat),
        lng: Number(data[0].lon),
        label: data[0].display_name,
      };
    }

    function haversineKm(a, b) {
      const toRad = (deg) => (deg * Math.PI) / 180;
      const R = 6371;
      const dLat = toRad(b.lat - a.lat);
      const dLng = toRad(b.lng - a.lng);
      const x =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
    }

    function optimizeNearestNeighbor(stops, startPoint) {
      const pending = stops.filter((stop) => stop.lat && stop.lng && stop.address.trim());
      const unresolved = stops.filter((stop) => !stop.lat || !stop.lng);
      if (!pending.length) return stops;
      const route = [];
      let current = startPoint && startPoint.lat && startPoint.lng ? startPoint : pending[0];
      const pool = [...pending];
      while (pool.length) {
        let bestIndex = 0;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let i = 0; i < pool.length; i += 1) {
          const d = haversineKm(current, pool[i]);
          if (d < bestDistance) {
            bestDistance = d;
            bestIndex = i;
          }
        }
        const [next] = pool.splice(bestIndex, 1);
        route.push(next);
        current = next;
      }
      return [...route, ...unresolved];
    }

    function csvEscape(value) {
      const text = String(value ?? '');
      return `"${text.replace(/"/g, '""')}"`;
    }

    function exportCsv() {
      const header = ['orden', 'direccion', 'estado', 'lat', 'lng', 'coincidencia'];
      const rows = state.stops.map((stop, index) => [
        index + 1,
        stop.address,
        stop.geocodeStatus,
        stop.lat ?? '',
        stop.lng ?? '',
        stop.normalizedLabel ?? '',
      ]);
      const csv = [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'ruta-optimizada-ml.csv';
      link.click();
      URL.revokeObjectURL(link.href);
    }

    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function addFiles(files, source = 'upload') {
      files.forEach((file) => {
        state.images.push({
          id: uid(),
          file,
          name: file.name,
          source,
          url: URL.createObjectURL(file),
        });
      });
      renderPreviews();
      setStatus(`${files.length} imagen(es) agregadas.`);
    }

    
async function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen.'));
    };
    img.src = url;
  });
}

async function createCardSliceFiles(file) {
  const img = await loadImageElement(file);
  if (!(img.height > img.width * 1.2 && img.width <= 900)) return [];

  const estimated = Math.min(14, Math.max(6, Math.round(img.height / 95)));
  const sliceHeight = Math.max(72, Math.round(img.height / estimated));
  const step = Math.max(56, Math.round(sliceHeight * 0.82));
  const files = [];

  for (let y = 0; y < img.height - 30; y += step) {
    const canvas = document.createElement('canvas');
    const cropHeight = Math.min(sliceHeight, img.height - y);
    canvas.width = img.width * 1.5;
    canvas.height = cropHeight * 1.5;
    const ctx = canvas.getContext('2d');
    ctx.scale(1.5, 1.5);
    ctx.drawImage(img, 0, y, img.width, cropHeight, 0, 0, img.width, cropHeight);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) continue;
    files.push(new File([blob], `slice-${uid()}.png`, { type: 'image/png' }));
  }
  return files;
}

async function runOcrOnFile(file) {
  const TesseractLib = await ensureTesseractLoaded();
  const result = await TesseractLib.recognize(file, 'spa+eng', {
    logger: (m) => {
      if (typeof m?.progress === 'number') {
        const pct = Math.max(1, Math.min(99, Math.round(m.progress * 100)));
        const label = m.status ? `OCR: ${m.status}` : 'Procesando OCR...';
        setProgress(label, pct);
      }
    },
  });
  return result?.data?.text || '';
}

async function analyzeImageFile(file) {
  const texts = [];
  const wholeText = await runOcrOnFile(file);
  texts.push(wholeText);

  const sliceFiles = await createCardSliceFiles(file);
  for (let i = 0; i < sliceFiles.length; i += 1) {
    const sliceText = await runOcrOnFile(sliceFiles[i]);
    if (sliceText && sliceText.trim()) texts.push(sliceText);
  }

  const joined = texts.join('\n').trim();
  return {
    text: joined,
    candidates: extractAddressCandidates(joined),
  };
}

async function runOcrForAllImages() {
  if (!state.images.length) {
    setStatus('Primero agrega imágenes o captura frames.');
    return;
  }
  try {
    setOcrButtonsDisabled(true);
    setStatus('Iniciando OCR de capturas...');
    setProgress('Preparando motor OCR...', 3);
    await ensureTesseractLoaded();
    let combinedText = $('rawText').value ? $('rawText').value + '\n' : '';
    let allCandidates = [];
    for (let i = 0; i < state.images.length; i += 1) {
      const image = state.images[i];
      setProgress(`Leyendo captura ${i + 1} de ${state.images.length}...`, Math.round((i / state.images.length) * 100));
      const analysis = await analyzeImageFile(image.file);
      combinedText += `${analysis.text}\n`;
      allCandidates = allCandidates.concat(analysis.candidates);
      setProgress(`Leyendo captura ${i + 1} de ${state.images.length}...`, Math.round(((i + 1) / state.images.length) * 100));
    }
    $('rawText').value = combinedText.trim();
    const added = mergeAddresses(allCandidates, 'ocr');
    setStatus(`OCR terminado. Se agregaron ${added} dirección(es) nuevas.`);
  } catch (error) {
    setStatus(`Error leyendo capturas: ${error.message}`);
  } finally {
    setOcrButtonsDisabled(false);
    clearProgress();
  }
}

async function shareScreen() {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 10, max: 15 } },
          audio: false,
        });
        state.screenStream = stream;
        screenVideo.srcObject = stream;
        $('btnShareScreen').classList.add('hidden');
        $('btnStopScreen').classList.remove('hidden');
        stream.getVideoTracks()[0].onended = stopScreen;
        setStatus('Pantalla compartida. Ya puedes capturar frames o leer la pantalla actual.');
      } catch (error) {
        setStatus(`No se pudo compartir pantalla: ${error.message}`);
      }
    }

    function stopScreen() {
      if (state.autoCaptureTimer) {
        clearInterval(state.autoCaptureTimer);
        state.autoCaptureTimer = null;
        $('btnToggleAuto').textContent = 'Iniciar auto captura';
      }
      if (state.recorder && state.recorder.state !== 'inactive') {
        state.recorder.stop();
      }
      if (state.screenStream) {
        state.screenStream.getTracks().forEach((track) => track.stop());
      }
      state.screenStream = null;
      screenVideo.srcObject = null;
      $('btnShareScreen').classList.remove('hidden');
      $('btnStopScreen').classList.add('hidden');
      $('btnStartRec').classList.remove('hidden');
      $('btnStopRec').classList.add('hidden');
      setStatus('Captura de pantalla detenida.');
    }

    function captureCurrentFrameBlob() {
      return new Promise((resolve, reject) => {
        if (!screenVideo.videoWidth || !screenVideo.videoHeight) {
          reject(new Error('La vista de pantalla aún no está lista.'));
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = screenVideo.videoWidth;
        canvas.height = screenVideo.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('No se pudo generar imagen del frame.'));
            return;
          }
          resolve(blob);
        }, 'image/png');
      });
    }

    async function captureFrameToImages(announce = true) {
      try {
        const blob = await captureCurrentFrameBlob();
        const file = new File([blob], `screen-${uid()}.png`, { type: 'image/png' });
        addFiles([file], 'screen');
        if (announce) setStatus('Frame capturado desde pantalla.');
      } catch (error) {
        setStatus(error.message);
      }
    }

    
async function detectCurrentScreen() {
  try {
    setOcrButtonsDisabled(true);
    setStatus('Iniciando OCR sobre la pantalla actual...');
    setProgress('Leyendo pantalla actual...', 15);
    await ensureTesseractLoaded();
    const blob = await captureCurrentFrameBlob();
    const file = new File([blob], `screen-ocr-${uid()}.png`, { type: 'image/png' });
    setProgress('Leyendo pantalla actual...', 55);
    const analysis = await analyzeImageFile(file);
    $('rawText').value = `${$('rawText').value}\n${analysis.text}`.trim();
    const added = mergeAddresses(analysis.candidates, 'screen-ocr');
    setStatus(`Pantalla analizada. Se agregaron ${added} dirección(es) nuevas.`);
  } catch (error) {
    setStatus(`No se pudo leer la pantalla: ${error.message}`);
  } finally {
    setOcrButtonsDisabled(false);
    clearProgress();
  }
}

function startRecording() {
      if (!state.screenStream) {
        setStatus('Primero comparte pantalla.');
        return;
      }
      try {
        const chunks = [];
        if (state.recordingUrl) URL.revokeObjectURL(state.recordingUrl);
        state.recorder = new MediaRecorder(state.screenStream, { mimeType: 'video/webm' });
        state.recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) chunks.push(event.data);
        };
        state.recorder.onstop = () => {
          const blob = new Blob(chunks, { type: 'video/webm' });
          state.recordingUrl = URL.createObjectURL(blob);
          $('downloadRecording').href = state.recordingUrl;
          $('recordingBox').classList.remove('hidden');
          $('btnStartRec').classList.remove('hidden');
          $('btnStopRec').classList.add('hidden');
          setStatus('Grabación lista para descargar.');
        };
        state.recorder.start(1000);
        $('btnStartRec').classList.add('hidden');
        $('btnStopRec').classList.remove('hidden');
        setStatus('Grabación iniciada.');
      } catch (error) {
        setStatus(`No se pudo iniciar la grabación: ${error.message}`);
      }
    }

    function stopRecording() {
      if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop();
    }

    function toggleAutoCapture() {
      if (!state.screenStream) {
        setStatus('Primero comparte pantalla.');
        return;
      }
      if (state.autoCaptureTimer) {
        clearInterval(state.autoCaptureTimer);
        state.autoCaptureTimer = null;
        $('btnToggleAuto').textContent = 'Iniciar auto captura';
        setStatus('Auto captura detenida.');
        return;
      }
      const seconds = Math.max(1, Number($('captureSeconds').value || 3));
      state.autoCaptureTimer = setInterval(() => captureFrameToImages(false), seconds * 1000);
      $('btnToggleAuto').textContent = 'Detener auto captura';
      setStatus(`Auto captura iniciada cada ${seconds} segundo(s).`);
    }

    async function geocodeAll() {
      if (!state.stops.length) {
        setStatus('No hay direcciones para geocodificar.');
        return;
      }
      try {
        setProgress('Ubicando direcciones...', 3);
        if ($('startAddress').value.trim()) {
          state.startPoint = await geocodeNominatim($('startAddress').value.trim());
        }
        for (let i = 0; i < state.stops.length; i += 1) {
          const stop = state.stops[i];
          if (!stop.address.trim()) continue;
          try {
            stop.geocodeStatus = 'buscando';
            renderStops();
            const hit = await geocodeNominatim(`${stop.address}, San Luis Potosí, Mexico`);
            if (hit) {
              stop.lat = hit.lat;
              stop.lng = hit.lng;
              stop.normalizedLabel = hit.label;
              stop.geocodeStatus = 'ok';
            } else {
              stop.geocodeStatus = 'sin coincidencia';
            }
          } catch {
            stop.geocodeStatus = 'error';
          }
          renderStops();
          setProgress('Ubicando direcciones...', Math.round(((i + 1) / state.stops.length) * 100));
          await new Promise((resolve) => setTimeout(resolve, 900));
        }
        setStatus('Geocodificación terminada.');
      } catch (error) {
        setStatus(`Error geocodificando: ${error.message}`);
      } finally {
        clearProgress();
        renderRouteBlocks();
      }
    }

    function optimizeRoute() {
      if (!state.stops.length) {
        setStatus('No hay paradas para optimizar.');
        return;
      }
      state.stops = optimizeNearestNeighbor(state.stops, state.startPoint);
      syncManualTextFromStops();
      renderStops();
      renderRouteBlocks();
      setStatus('Ruta reordenada con heurística de vecino más cercano.');
    }

    function syncStopsFromManual() {
      const seen = new Set();
      state.stops = $('manualText').value
        .split(/\n+/)
        .map((line) => cleanAddress(line))
        .filter(Boolean)
        .filter((line) => {
          const key = normalize(line);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((address) => ({
          id: uid(),
          address,
          source: 'manual',
          lat: null,
          lng: null,
          normalizedLabel: '',
          geocodeStatus: 'pendiente',
        }));
      renderStops();
      renderRouteBlocks();
      setStatus(`Lista actualizada con ${state.stops.length} parada(s).`);
    }

    function addStop() {
      state.stops.push({
        id: uid(),
        address: '',
        source: 'manual',
        lat: null,
        lng: null,
        normalizedLabel: '',
        geocodeStatus: 'pendiente',
      });
      syncManualTextFromStops();
      renderStops();
    }

    async function copyList() {
      const text = state.stops.map((s, idx) => `${idx + 1}. ${s.address}`).join('\n');
      await navigator.clipboard.writeText(text);
      setStatus('Lista copiada al portapapeles.');
    }

    function initTabs() {
      document.querySelectorAll('.tabbtn').forEach((btn) => {
        btn.onclick = () => {
          document.querySelectorAll('.tabbtn').forEach((x) => x.classList.remove('active'));
          document.querySelectorAll('.tabpanel').forEach((x) => x.classList.remove('active'));
          btn.classList.add('active');
          document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
        };
      });
    }

    function initUploadZone() {
      $('btnPickImages').onclick = () => $('fileInput').click();
      $('fileInput').onchange = (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length) addFiles(files, 'upload');
        e.target.value = '';
      };

      const drop = $('dropZone');
      drop.addEventListener('paste', (event) => {
        const items = Array.from(event.clipboardData?.items || []);
        const files = items
          .filter((item) => item.type.startsWith('image/'))
          .map((item) => item.getAsFile())
          .filter(Boolean);
        if (!files.length) return;
        event.preventDefault();
        addFiles(files, 'paste');
      });
      drop.addEventListener('dragover', (e) => {
        e.preventDefault();
        drop.style.borderColor = '#2563eb';
      });
      drop.addEventListener('dragleave', () => {
        drop.style.borderColor = 'var(--line)';
      });
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.style.borderColor = 'var(--line)';
        const files = Array.from(e.dataTransfer?.files || []).filter((f) => f.type.startsWith('image/'));
        if (files.length) addFiles(files, 'drop');
      });
    }

    function bindActions() {
      $('btnRunOcr').onclick = runOcrForAllImages;
      $('btnShareScreen').onclick = shareScreen;
      $('btnStopScreen').onclick = stopScreen;
      $('btnCaptureFrame').onclick = () => captureFrameToImages(true);
      $('btnDetectScreen').onclick = detectCurrentScreen;
      $('btnStartRec').onclick = startRecording;
      $('btnStopRec').onclick = stopRecording;
      $('btnToggleAuto').onclick = toggleAutoCapture;
      $('btnGeocode').onclick = geocodeAll;
      $('btnOptimize').onclick = optimizeRoute;
      $('btnReoptimize').onclick = optimizeRoute;
      $('btnSyncList').onclick = syncStopsFromManual;
      $('btnAddStop').onclick = addStop;
      $('btnCopyList').onclick = copyList;
      $('btnExportCsv').onclick = exportCsv;
      $('startAddress').onchange = renderRouteBlocks;
      $('batchSize').onchange = renderRouteBlocks;
    }

    initTabs();
    initUploadZone();
    bindActions();
    renderPreviews();
    renderStops();
    renderRouteBlocks();
  