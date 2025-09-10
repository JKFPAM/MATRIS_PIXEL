 "use strict";

// ====== util DOM ======
const $ = id => document.getElementById(id);

// ====== refs UI ======
const els = {
  stage: $('stage'), gif: $('gif'), vid: $('vid'),
  overlay: $('overlay'), src: $('src'),

  togglePanel: $('togglePanel'), panel: $('panel'), closePanel: $('closePanel'),

  gifInput: $('gifInput'),
  cell: $('cell'), cellVal: $('cellVal'),
  weight: $('weight'), weightVal: $('weightVal'),
  t1: $('t1'), t1Val: $('t1Val'),
  t2: $('t2'), t2Val: $('t2Val'),
  opacity: $('opacity'), opacityVal: $('opacityVal'),
  savePng: $('savePng'),

  gDark: $('gDark'), gMid: $('gMid'), gLight: $('gLight'),
  darkAuto: $('darkAuto'), midAuto: $('midAuto'), lightAuto: $('lightAuto'),
  darkColor: $('darkColor'), midColor: $('midColor'), lightColor: $('lightColor'),

  // staggers + layer 2 (optionnels)
  staggerRows: $('staggerRows'), staggerRowsVal: $('staggerRowsVal'),
  staggerCols: $('staggerCols'), staggerColsVal: $('staggerColsVal'),

  layer2Enabled: $('layer2Enabled'),
  layer2dx: $('layer2dx'), layer2dxVal: $('layer2dxVal'),
  layer2dy: $('layer2dy'), layer2dyVal: $('layer2dyVal'),
  layer2scale: $('layer2scale'), layer2scaleVal: $('layer2scaleVal'),
  layer2alpha: $('layer2alpha'), layer2alphaVal: $('layer2alphaVal'),
  layer2blend: $('layer2blend'),
  layer2TintOn: $('layer2TintOn'), layer2Tint: $('layer2Tint'),

  // Export vidéo/seq (optionnels)
  recDur: $('recDur'),
  recFps: $('recFps'),
  recScale: $('recScale'),
  recStart: $('recStart'),
  recStop: $('recStop'),

  // Nouveau : Caméra
  camStart: $('camStart'),
  camStop: $('camStop'),

  expSeqPng: $('expSeqPng'),
  hint: $('hint'),
};

// ====== canvas ctx ======
const srcCtx = els.src.getContext('2d', { willReadFrequently: true });
const oCtx   = els.overlay.getContext('2d');

// ====== helpers ======
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const lum  =(r,g,b)=>(0.2126*r+0.7152*g+0.0722*b)/255;
const sleep = (ms)=>new Promise(r=>setTimeout(r, ms));

// ====== source state ======
let srcURL=null;
let sourceMode=null; // "video" | "gif-sg" | "image" | "camera"
let superGif=null, superGifImg=null, sgCanvas=null;
let camStream = null; // flux caméra

// ====== viewport state ======
let viewW=0, viewH=0;

// ====== perf state (grille) ======
let grid = { cols:0, rows:0, xCSS:[], yCSS:[] };
let lastGridKey = "";

// mini-canvas d’échantillonnage (FAST)
const sampleCanvas = document.createElement('canvas');
const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
sampleCtx.imageSmoothingEnabled = false;

const USE_FAST_SAMPLE = true;  // 1 pixel par cellule
let TARGET_FPS = 30;
let lastFrameMs = 0;
let lastFontStr = "";

// ====== UI hint ======
function setHint(msg=""){ if(els.hint) els.hint.textContent=msg; }

// ====== pixels source ======
function currentSourcePixels(){
  if (sourceMode==='gif-sg' && sgCanvas) return { pxW: sgCanvas.width, pxH: sgCanvas.height };
  if ((sourceMode==='video' || sourceMode==='camera') && els.vid.videoWidth) return { pxW: els.vid.videoWidth, pxH: els.vid.videoHeight };
  if (els.gif.naturalWidth)  return { pxW: els.gif.naturalWidth,  pxH: els.gif.naturalHeight  };
  return { pxW: 1, pxH: 1 };
}

// ====== grille ======
function rebuildGrid(){
  const cell = parseInt(els.cell.value, 10) || 10;
  const cols = Math.max(1, Math.floor(viewW / cell));
  const rows = Math.max(1, Math.floor(viewH / cell));
  const key  = `${Math.round(viewW)}x${Math.round(viewH)}@${cell}`;

  if (key === lastGridKey && grid.cols === cols && grid.rows === rows) return;

  grid.cols = cols; grid.rows = rows;
  grid.xCSS = new Float32Array(cols);
  grid.yCSS = new Float32Array(rows);

  for (let c=0; c<cols; c++) grid.xCSS[c] = Math.round(c * cell);
  for (let r=0; r<rows; r++) grid.yCSS[r] = Math.round(r * cell);

  sampleCanvas.width  = cols;
  sampleCanvas.height = rows;

  lastGridKey = key;
}

// ====== sync tailles & DPR ======
let dprOverride = null;
function syncSizes(){
  const displayEl = ((sourceMode==='video' || sourceMode==='camera') ? els.vid : (sgCanvas || els.gif));
  if (!displayEl) return;

  const rect = displayEl.getBoundingClientRect();
  const wCSS = Math.max(1, rect.width);
  const hCSS = Math.max(1, rect.height);

  els.stage.style.width  = wCSS + 'px';
  els.stage.style.height = hCSS + 'px';

  const dpr = (dprOverride || (window.devicePixelRatio || 1));
  const Wpx = Math.max(1, Math.round(wCSS * dpr));
  const Hpx = Math.max(1, Math.round(hCSS * dpr));

  if (els.overlay.width !== Wpx || els.overlay.height !== Hpx) {
    els.overlay.width  = Wpx; els.overlay.height = Hpx;
  }
  if (els.src.width !== Wpx || els.src.height !== Hpx) {
    els.src.width  = Wpx; els.src.height = Hpx;
  }

  oCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  srcCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  oCtx.imageSmoothingEnabled = false;
  srcCtx.imageSmoothingEnabled = false;

  viewW = wCSS; viewH = hCSS;
  rebuildGrid();
}

// ====== mise à l’échelle initiale ======
function sizeStageFromMediaMeta(){
  const { pxW, pxH } = currentSourcePixels();
  const vpW=Math.max(320, window.innerWidth-48), vpH=Math.max(240, window.innerHeight-48);
  const ar = pxW/pxH || 1;
  let w = vpW, h = w/ar; if (h>vpH){ h=vpH; w=h*ar; }
  w = Math.round(w); h = Math.round(h);

  els.stage.style.width=w+'px';
  els.stage.style.height=h+'px';
  if (sgCanvas){ sgCanvas.style.width='100%'; sgCanvas.style.height='100%'; }
  syncSizes();
}

// ====== couleurs / glyphs ======
function colorForGlyph(cat, r,g,b, L){
  const fallback=`rgb(${Math.round(L*255)},${Math.round(L*255)},${Math.round(L*255)})`;
  if (cat==='dark')  return els.darkAuto?.checked  ? `rgb(${r},${g},${b})` : (els.darkColor?.value  || fallback);
  if (cat==='mid')   return els.midAuto?.checked   ? `rgb(${r},${g},${b})` : (els.midColor?.value   || fallback);
  return els.lightAuto?.checked ? `rgb(${r},${g},${b})` : (els.lightColor?.value || fallback);
}
function pickGlyphByL(L, gD, gM, gL, t1, t2){
  if (L < t1) return { ch: gD || '#', cat: 'dark' };
  if (L < t2) return { ch: gM || '*', cat: 'mid' };
  return { ch: gL || '.', cat: 'light' };
}

// ====== copie frame -> source d’échantillonnage ======
function drawFrameToSource(){
  const displayEl = ((sourceMode==='video' || sourceMode==='camera') ? els.vid : (sgCanvas || els.gif));
  if (!displayEl || !viewW || !viewH) return;

  if (USE_FAST_SAMPLE && grid.cols && grid.rows){
    sampleCtx.clearRect(0,0,grid.cols,grid.rows);
    sampleCtx.drawImage(displayEl, 0, 0, grid.cols, grid.rows);
    return;
  }

  srcCtx.clearRect(0,0,viewW,viewH);
  if (sourceMode==='video' || sourceMode==='camera'){
    if (els.vid.readyState>=2) srcCtx.drawImage(els.vid, 0, 0, viewW, viewH);
  } else if (sourceMode==='gif-sg'){
    if (sgCanvas) srcCtx.drawImage(sgCanvas, 0,0, sgCanvas.width, sgCanvas.height, 0,0, viewW, viewH);
  } else if (sourceMode==='image'){
    if (els.gif.naturalWidth) srcCtx.drawImage(els.gif, 0, 0, viewW, viewH);
  }
}

// ====== staggers ======
function baseOffsets(){
  return {
    dx: 0,
    dy: 0,
    rowStagger: parseFloat(els.staggerRows?.value || 0) || 0,
    colStagger: parseFloat(els.staggerCols?.value || 0) || 0,
  };
}

// ====== dessin d’une couche ======
function drawLayer({data, stride, rows, cols, cell, weight, t1, t2, gD, gM, gL}, layer){
  const fontStr = `${weight} ${Math.max(1, cell * (layer.scale || 1))}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  if (fontStr !== lastFontStr){ oCtx.font = fontStr; lastFontStr = fontStr; }
  oCtx.globalAlpha = parseFloat(els.opacity.value) * (layer.alpha ?? 1);
  oCtx.globalCompositeOperation = layer.blend || 'source-over';

  const tintOn = !!layer.tintOn;
  const tint   = layer.tint || '#ffffff';

  const { rowStagger, colStagger } = baseOffsets();

  for (let r=0; r<rows; r++){
    const yCSS0 = grid.yCSS[r];
    const yCSS  = yCSS0 + (r & 1 ? rowStagger : 0) + (layer.dy || 0);
    const rowBase = r * stride;

    for (let c=0; c<cols; c++){
      const xCSS0 = grid.xCSS[c];
      const xCSS  = xCSS0 + (c & 1 ? colStagger : 0) + (layer.dx || 0);

      const i  = rowBase + c*4;
      const a  = data[i+3]; if (a < 16) continue;
      const R  = data[i], G = data[i+1], B = data[i+2];
      const L  = (0.2126*R + 0.7152*G + 0.0722*B)/255;

      const pick = (L<t1) ? {ch:gD, cat:'dark'} : (L<t2) ? {ch:gM, cat:'mid'} : {ch:gL, cat:'light'};
      oCtx.fillStyle = tintOn ? tint : colorForGlyph(pick.cat, R,G,B, L);
      oCtx.fillText(pick.ch, xCSS, yCSS);
    }
  }
}

// ====== rendu temps réel ======
function render(){
  const now = performance.now();
  if (now - lastFrameMs < (1000 / TARGET_FPS)) {
    if ((sourceMode==='video' || sourceMode==='camera') && 'requestVideoFrameCallback' in els.vid){
      els.vid.requestVideoFrameCallback(()=>render());
    } else {
      requestAnimationFrame(render);
    }
    return;
  }
  lastFrameMs = now;

  syncSizes();
  drawFrameToSource();

  const cell  = parseInt(els.cell.value, 10) || 10;
  const rows  = grid.rows;
  const cols  = grid.cols;
  if (!rows || !cols) {
    if ((sourceMode==='video' || sourceMode==='camera') && 'requestVideoFrameCallback' in els.vid){
      els.vid.requestVideoFrameCallback(()=>render());
    } else {
      requestAnimationFrame(render);
    }
    return;
  }

  let data, stride;
  if (USE_FAST_SAMPLE){
    const img = sampleCtx.getImageData(0,0,cols,rows);
    data = img.data;
    stride = cols * 4;
  } else {
    const Wpx = els.src.width, Hpx = els.src.height;
    const img = srcCtx.getImageData(0,0,Wpx,Hpx);
    data = img.data;
    stride = Wpx * 4;
  }

  oCtx.clearRect(0,0,viewW,viewH);

  const weight = parseInt(els.weight.value, 10) || 600;
  const t1 = parseFloat(els.t1.value), t2 = parseFloat(els.t2.value);
  const gD = els.gDark.value || '#', gM = els.gMid.value || '*', gL = els.gLight.value || '.';

  drawLayer({data, stride, rows, cols, cell, weight, t1, t2, gD, gM, gL}, {
    dx: 0, dy: 0, scale: 1, alpha: 1, blend: 'source-over', tintOn:false
  });

  if (els.layer2Enabled && els.layer2Enabled.checked){
    drawLayer({data, stride, rows, cols, cell, weight, t1, t2, gD, gM, gL}, {
      dx: parseFloat(els.layer2dx?.value) || 0,
      dy: parseFloat(els.layer2dy?.value) || 0,
      scale: parseFloat(els.layer2scale?.value) || 1,
      alpha: parseFloat(els.layer2alpha?.value) || 0.5,
      blend: (els.layer2blend && els.layer2blend.value) || 'source-over',
      tintOn: !!(els.layer2TintOn && els.layer2TintOn.checked),
      tint: (els.layer2Tint && els.layer2Tint.value) || '#ffffff',
    });
  }

  if ((sourceMode==='video' || sourceMode==='camera') && 'requestVideoFrameCallback' in els.vid){
    els.vid.requestVideoFrameCallback(()=>render());
  } else {
    requestAnimationFrame(render);
  }
}

// ====== boucle ======
let rafId=0;
function startLoop(){
  stopLoop();
  if ((sourceMode==='video' || sourceMode==='camera') && 'requestVideoFrameCallback' in els.vid){
    const step=()=>els.vid.requestVideoFrameCallback(()=>{ render(); step(); });
    els.vid.requestVideoFrameCallback(()=>{ render(); step(); });
  } else {
    const loop=()=>{ rafId=requestAnimationFrame(loop); render(); };
    rafId=requestAnimationFrame(loop);
  }
}
function stopLoop(){ if (rafId) cancelAnimationFrame(rafId), rafId=0; }

// ====== SuperGif cleanup ======
function cleanupSuperGif(){
  try{ if (superGif && superGif.get_canvas){ const c=superGif.get_canvas(); if(c&&c.parentNode)c.parentNode.removeChild(c);} }catch(_){}
  try{ if (superGifImg && superGifImg.parentNode) superGifImg.parentNode.removeChild(superGifImg);}catch(_){}
  superGif=null; superGifImg=null; sgCanvas=null;
}

// ====== Caméra ======
async function startCamera(){
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    setHint('❌ getUserMedia non disponible.');
    return;
  }

  stopLoop();
  if (camStream) stopCamera();
  cleanupSuperGif();
  if (srcURL){ URL.revokeObjectURL(srcURL); srcURL=null; }

  els.gif.classList.add('hidden');
  els.vid.classList.remove('hidden');

  try{
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: {ideal:1280}, height:{ideal:720} },
      audio: false
    });
    els.vid.srcObject = camStream;
    await els.vid.play().catch(()=>{});
    sourceMode = 'camera';
    sizeStageFromMediaMeta();
    startLoop();
    setHint('🎥 Caméra active.');
  }catch(err){
    console.error(err);
    setHint('❌ Accès caméra refusé ou indisponible.');
    els.vid.classList.add('hidden');
    sourceMode = null;
  }
}
function stopCamera(){
  try{ camStream?.getTracks()?.forEach(t=>t.stop()); }catch(_){}
  camStream=null;
  if (els.vid.srcObject){ els.vid.srcObject = null; }
  setHint('Caméra arrêtée.');
}

// ====== helpers export OFFLINE (seek/frame-perfect si possible) ======
function nextVideoFrameOnce(video){
  if (!('requestVideoFrameCallback' in video)) {
    return new Promise(res => setTimeout(res, 0));
  }
  return new Promise(res => video.requestVideoFrameCallback(() => res()));
}

async function setSourceTimeExact(tSec){
  if (sourceMode === 'video') {
    const dur = isFinite(els.vid.duration) ? els.vid.duration : tSec;
    const t   = Math.min(Math.max(0, tSec), Math.max(0, dur - 1e-4));
    els.vid.pause();
    if (Math.abs(els.vid.currentTime - t) > 1e-4) {
      await new Promise((res, rej) => {
        const onErr = () => { els.vid.removeEventListener('seeked', onOk); rej(new Error('seek error')); };
        const onOk  = () => { els.vid.removeEventListener('error', onErr); res(); };
        els.vid.addEventListener('seeked', onOk, { once:true });
        els.vid.addEventListener('error', onErr, { once:true });
        els.vid.currentTime = t;
      });
    }
    await nextVideoFrameOnce(els.vid);
  } else if (sourceMode === 'gif-sg' && superGif) {
    try {
      const frames = superGif.get_frames ? superGif.get_frames() : null;
      const n = frames ? frames.length : (superGif.get_length ? superGif.get_length() : 1);
      let totalMs = 0;
      if (frames && frames.length) for (const f of frames) totalMs += (f.delay || 10);
      else totalMs = (superGif.get_length ? superGif.get_length() : 1000);
      const p = totalMs ? (tSec * 1000) / totalMs : 0;
      const idx = Math.max(0, Math.min(n-1, Math.floor(p * n)));
      if (superGif.pause) superGif.pause();
      if (superGif.move_to) superGif.move_to(idx);
      await new Promise(r => requestAnimationFrame(r));
    } catch(_){}
  } else if (sourceMode === 'camera') {
    // pas de seek pour un MediaStream
    await new Promise(r => requestAnimationFrame(r));
  } else {
    await new Promise(r => requestAnimationFrame(r));
  }
}

// ====== Rendu overlay dans un ctx externe ======
function renderOverlayIntoContext(ctxOut, W, H, scale){
  const cell = parseInt(els.cell.value, 10) || 10;
  const cols = Math.max(1, Math.floor((viewW * scale) / (cell * scale)));
  const rows = Math.max(1, Math.floor((viewH * scale) / (cell * scale)));

  const xCSS = new Float32Array(cols);
  const yCSS = new Float32Array(rows);
  for (let c=0;c<cols;c++) xCSS[c] = Math.round(c * cell * scale);
  for (let r=0;r<rows;r++) yCSS[r] = Math.round(r * cell * scale);

  const displayEl = ((sourceMode==='video' || sourceMode==='camera') ? els.vid : (sgCanvas || els.gif));
  const localSample = document.createElement('canvas');
  localSample.width = cols; localSample.height = rows;
  const lctx = localSample.getContext('2d', { willReadFrequently:true });
  lctx.imageSmoothingEnabled = false;
  if (displayEl) lctx.drawImage(displayEl, 0, 0, cols, rows);

  const img = lctx.getImageData(0,0,cols,rows);
  const data = img.data;
  const stride = cols*4;

  const weight = parseInt(els.weight.value, 10) || 600;
  const t1 = parseFloat(els.t1.value), t2 = parseFloat(els.t2.value);
  const gD = els.gDark.value || '#', gM = els.gMid.value || '*', gL = els.gLight.value || '.';
  const cellPx = Math.max(1, Math.round(cell * scale));

  ctxOut.setTransform(1,0,0,1,0,0);
  ctxOut.imageSmoothingEnabled = false;
  ctxOut.globalCompositeOperation = 'source-over';
  ctxOut.globalAlpha = parseFloat(els.opacity.value);
  ctxOut.clearRect(0,0,W,H);
  ctxOut.font = `${weight} ${cellPx}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctxOut.textBaseline = 'top';
  ctxOut.textAlign = 'left';

  const rowStagger = parseFloat(els.staggerRows?.value || 0) * scale || 0;
  const colStagger = parseFloat(els.staggerCols?.value || 0) * scale || 0;

  // L1
  let lastStyle = null;
  for (let r=0;r<rows;r++){
    const y = yCSS[r] + ((r & 1) ? rowStagger : 0);
    const base = r * stride;
    for (let c=0;c<cols;c++){
      const x = xCSS[c] + ((c & 1) ? colStagger : 0);
      const i = base + c*4;
      const a = data[i+3]; if (a < 16) continue;
      const R = data[i], G=data[i+1], B=data[i+2];
      const L = (0.2126*R + 0.7152*G + 0.0722*B)/255;
      const pick = (L<t1) ? {ch:gD, cat:'dark'} : (L<t2) ? {ch:gM, cat:'mid'} : {ch:gL, cat:'light'};
      const style = colorForGlyph(pick.cat, R,G,B, L);
      if (style !== lastStyle){ ctxOut.fillStyle = style; lastStyle = style; }
      ctxOut.fillText(pick.ch, x, y);
    }
  }

  // L2
  if (els.layer2Enabled && els.layer2Enabled.checked){
    const dx = (parseFloat(els.layer2dx?.value) || 0) * scale;
    const dy = (parseFloat(els.layer2dy?.value) || 0) * scale;
    const sc = parseFloat(els.layer2scale?.value) || 1;
    const al = parseFloat(els.layer2alpha?.value) || 0.5;
    const blend = (els.layer2blend && els.layer2blend.value) || 'source-over';
    const tintOn = !!(els.layer2TintOn && els.layer2TintOn.checked);
    const tint   = (els.layer2Tint && els.layer2Tint.value) || '#ffffff';

    ctxOut.globalCompositeOperation = blend;
    ctxOut.globalAlpha = (parseFloat(els.opacity.value) * al);
    ctxOut.font = `${weight} ${Math.max(1, Math.round(cellPx * sc))}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    lastStyle = null;

    for (let r=0;r<rows;r++){
      const y = yCSS[r] + ((r & 1) ? rowStagger : 0) + dy;
      const base = r * stride;
      for (let c=0;c<cols;c++){
        const x = xCSS[c] + ((c & 1) ? colStagger : 0) + dx;
        const i = base + c*4;
        const a = data[i+3]; if (a < 16) continue;
        const R = data[i], G=data[i+1], B=data[i+2];
        const L = (0.2126*R + 0.7152*G + 0.0722*B)/255;
        const pick = (L<t1) ? {ch:gD, cat:'dark'} : (L<t2) ? {ch:gM, cat:'mid'} : {ch:gL, cat:'light'};
        const style = tintOn ? tint : colorForGlyph(pick.cat, R,G,B, L);
        if (style !== lastStyle){ ctxOut.fillStyle = style; lastStyle = style; }
        ctxOut.fillText(pick.ch, x, y);
      }
    }
  }
}

// ====== Export PNG Sequence + ZIP ======
async function ensureJSZip(){
  if (window.JSZip) return window.JSZip;
  await new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
    s.onload=()=>res();
    s.onerror=()=>rej(new Error("JSZip load failed"));
    document.head.appendChild(s);
  });
  return window.JSZip;
}

function downloadBlob(name, blob){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=name; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

async function exportPNGSequence({ fps=30, seconds=null, scale=1, basename='overlay' } = {}){
  // déduire la durée par défaut
  let totalSec = seconds;
  if (totalSec == null) {
    if (sourceMode === 'camera') {
      totalSec = parseFloat(els.recDur?.value || '3');
    } else if (sourceMode === 'video' && isFinite(els.vid.duration)) {
      totalSec = els.vid.duration;
    } else if (sourceMode === 'gif-sg' && superGif && superGif.get_frames) {
      const frames = superGif.get_frames(); let ms=0;
      for (const f of frames) ms += (f.delay || 10);
      totalSec = Math.max(0.1, ms/1000);
    } else totalSec = 3;
  }

  // Taille offscreen
  const W = Math.max(1, Math.round(viewW * scale));
  const H = Math.max(1, Math.round(viewH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctxOut = canvas.getContext('2d', { alpha:true });
  ctxOut.imageSmoothingEnabled = false;

  const totalFrames = Math.max(1, Math.floor(totalSec * fps));
  setHint(`Export PNG seq… 0/${totalFrames}`);

  const JSZip = await ensureJSZip();
  const zip = new JSZip();
  const dir = zip.folder('frames');

  for (let k=0; k<totalFrames; k++){
    const t = k / fps;

    if (sourceMode === 'camera') {
      if (k>0) await sleep(1000 / fps); // temps réel
    } else {
      await setSourceTimeExact(t);
    }

    renderOverlayIntoContext(ctxOut, W, H, scale);

    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    const idx  = String(k+1).padStart(6,'0');
    await dir.file(`${basename}_${idx}.png`, blob);
    if ((k % 5) === 0) setHint(`Export PNG seq… ${k+1}/${totalFrames}`);
    if ((k % 20) === 0) await new Promise(r => setTimeout(r, 0));
  }

  const outBlob = await zip.generateAsync({ type:'blob' });
  downloadBlob(`overlay_png_seq_${fps}fps_${totalSec}s.zip`, outBlob);

  setHint(`Séquence PNG prête : ${totalFrames} images dans le ZIP.`);
}

// ====== WebM live recorder (optionnel web) ======
let mediaRecorder=null, recChunks=[], recTimer=null, wasTargetFps=TARGET_FPS;
function pickSupportedMime() {
  const candidates=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'];
  return candidates.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
}
function enableRecordScale(scale){ if (!scale || scale===1) return; const base=window.devicePixelRatio||1; dprOverride=base*scale; syncSizes(); }
function disableRecordScale(){ if (dprOverride){ dprOverride=null; syncSizes(); } }
async function startRecording(){
  const mime = pickSupportedMime(); if(!mime){ alert('MediaRecorder WebM non supporté.'); return; }
  const durSec = Math.max(1, parseInt(els.recDur?.value || '5', 10));
  const fps    = Math.min(60, Math.max(1, parseInt(els.recFps?.value || '30', 10)));
  const scale  = Math.max(1, parseFloat(els.recScale?.value || '1'));
  enableRecordScale(scale);
  wasTargetFps = TARGET_FPS; TARGET_FPS = fps;
  const stream = els.overlay.captureStream(fps);
  recChunks = [];
  mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
  mediaRecorder.ondataavailable = (e)=>{ if(e.data && e.data.size) recChunks.push(e.data); };
  mediaRecorder.onstop = ()=>{
    TARGET_FPS = wasTargetFps; disableRecordScale();
    const blob = new Blob(recChunks, { type: mime });
    downloadBlob(`overlay_live_${fps}fps.webm`, blob);
    setHint('');
  };
  mediaRecorder.start(100);
  clearTimeout(recTimer);
  recTimer = setTimeout(stopRecording, durSec * 1000);
  setHint(`Recording… ${durSec}s @ ${fps}fps${scale>1?` (scale ${scale}×)`:''}`);
}
function stopRecording(){ try{clearTimeout(recTimer);}catch(_){}
  recTimer=null; if(mediaRecorder && mediaRecorder.state!=='inactive'){ mediaRecorder.stop(); }}

// ====== chargement média ======
els.gifInput.addEventListener('change', async e=>{
  const f=e.target.files?.[0]; if(!f) return;
  if (srcURL) URL.revokeObjectURL(srcURL);
  srcURL=URL.createObjectURL(f);

  // si caméra active, on la coupe
  if (camStream) stopCamera();

  stopLoop(); cleanupSuperGif();
  els.gif.classList.add('hidden'); els.vid.classList.add('hidden');
  Array.from(els.stage.querySelectorAll('.sg-canvas')).forEach(n=>n.remove());

  if (f.type.startsWith('video/')){
    els.vid.srcObject = null;
    els.vid.src=srcURL; els.vid.classList.remove('hidden');
    sourceMode='video';
    await els.vid.play().catch(()=>{});
    if (els.vid.readyState<1) await new Promise(res=>els.vid.addEventListener('loadedmetadata',res,{once:true}));
    sizeStageFromMediaMeta(); startLoop();
  } else if (f.type==='image/gif'){
    superGifImg=new Image(); superGifImg.style.display='none';
    superGifImg.setAttribute('rel:animated_src', srcURL);
    els.stage.appendChild(superGifImg);

    await new Promise((resolve,reject)=>{
      try{
        superGif=new window.SuperGif({ gif: superGifImg, auto_play:true, loop_mode:true, show_progress_bar:false });
        superGif.load(()=>resolve());
        setTimeout(()=>reject(new Error('SuperGif timeout')),10000);
      }catch(err){ reject(err); }
    }).catch(console.error);

    sgCanvas=superGif.get_canvas();
    if (sgCanvas){
      sgCanvas.classList.add('media','sg-canvas');
      sgCanvas.style.position='absolute'; sgCanvas.style.inset='0';
      sgCanvas.style.width='100%'; sgCanvas.style.height='100%';
      els.stage.insertBefore(sgCanvas, els.overlay);
    }
    sourceMode='gif-sg';
    sizeStageFromMediaMeta(); startLoop();
  } else {
    els.gif.src=srcURL; await new Promise(res=>els.gif.addEventListener('load',res,{once:true}));
    els.gif.classList.remove('hidden');
    sourceMode='image';
    sizeStageFromMediaMeta(); startLoop();
  }
});

// ====== UI binds ======
function setPanel(open){ els.panel.classList.toggle('open',open); els.togglePanel.setAttribute('aria-expanded',String(open)); }
els.togglePanel.addEventListener('click',()=> setPanel(!els.panel.classList.contains('open')));
els.closePanel.addEventListener('click',()=> setPanel(false));

els.cell.addEventListener('input',   ()=> { els.cellVal.textContent = els.cell.value; rebuildGrid(); });
els.weight.addEventListener('input', ()=> els.weightVal.textContent= els.weight.value);
els.t1.addEventListener('input',     ()=> els.t1Val.textContent    = (+els.t1.value).toFixed(2));
els.t2.addEventListener('input',     ()=> els.t2Val.textContent    = (+els.t2.value).toFixed(2));
els.opacity.addEventListener('input',()=> els.opacityVal.textContent = (+els.opacity.value).toFixed(2));

// valeurs live pour les contrôles optionnels
for (const [input, out] of [
  [els.staggerRows, els.staggerRowsVal],
  [els.staggerCols, els.staggerColsVal],
  [els.layer2dx, els.layer2dxVal],
  [els.layer2dy, els.layer2dyVal],
  [els.layer2scale, els.layer2scaleVal],
  [els.layer2alpha, els.layer2alphaVal],
]) {
  if (!input || !out) continue;
  const update = () => {
    const v = input.type === 'range' && (input.step+'').includes('.') ? (+input.value).toFixed(2) : input.value;
    out.textContent = v;
  };
  input.addEventListener('input', update);
  update();
}

// PNG (une image) — Alt+clic => séquence PNG (ZIP)
els.savePng.addEventListener('click', async (ev)=>{
  if (ev && ev.altKey){
    const fps   = parseFloat(els.recFps?.value || '30');
    const secs  = parseFloat(els.recDur?.value || '3');
    const scale = parseFloat(els.recScale?.value || '1');
    try{
      await exportPNGSequence({ fps, seconds: secs, scale, basename: 'overlay' });
    }catch(e){ console.error(e); alert('Export sequence échoué: '+e.message); }
    return;
  }
  const a=document.createElement('a');
  a.download='glyph-overlay.png';
  a.href=els.overlay.toDataURL('image/png');
  a.click();
});

// Bouton “Export PNG Sequence”
if (els.expSeqPng){
  els.expSeqPng.addEventListener('click', async ()=>{
    const fps   = parseFloat(els.recFps?.value || '30');
    const secs  = parseFloat(els.recDur?.value || '3');
    const scale = parseFloat(els.recScale?.value || '1');
    setHint('Préparation export PNG sequence…');
    try{
      await exportPNGSequence({ fps, seconds: secs, scale, basename: 'overlay' });
    }catch(e){ console.error(e); alert('Export sequence échoué: '+e.message); }
  });
}

// Live WebM
if (els.recStart) els.recStart.addEventListener('click', startRecording);
if (els.recStop)  els.recStop.addEventListener('click',  stopRecording);

// Caméra
if (els.camStart) els.camStart.addEventListener('click', startCamera);
if (els.camStop)  els.camStop.addEventListener('click',  stopCamera);

window.addEventListener('resize', ()=>{ sizeStageFromMediaMeta(); });

// ====== Boot ======
sizeStageFromMediaMeta();
syncSizes();
els.cellVal.textContent  = els.cell.value;
els.weightVal.textContent= els.weight.value;
els.opacityVal.textContent=(+els.opacity.value).toFixed(2);
els.t1Val.textContent=(+els.t1.value).toFixed(2);
els.t2Val.textContent=(+els.t2.value).toFixed(2);
