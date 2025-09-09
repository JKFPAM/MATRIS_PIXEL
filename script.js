"use strict";

// ===== Overlay = même bitmap que le média (GIF canvas ou video) =====
const $ = id => document.getElementById(id);
// AVANT: ... offsetX, offsetXVal, offsetY, offsetYVal,
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
  
    // on GARDE seulement les staggers
    staggerRows: $('staggerRows'), staggerRowsVal: $('staggerRowsVal'),
    staggerCols: $('staggerCols'), staggerColsVal: $('staggerColsVal'),
  
    // Layer 2 (conservée)
    layer2Enabled: $('layer2Enabled'),
    layer2dx: $('layer2dx'), layer2dxVal: $('layer2dxVal'),
    layer2dy: $('layer2dy'), layer2dyVal: $('layer2dyVal'),
    layer2scale: $('layer2scale'), layer2scaleVal: $('layer2scaleVal'),
    layer2alpha: $('layer2alpha'), layer2alphaVal: $('layer2alphaVal'),
    layer2blend: $('layer2blend'),
    layer2TintOn: $('layer2TintOn'), layer2Tint: $('layer2Tint'),
  
    hint: $('hint'),
  };
  

const srcCtx = els.src.getContext('2d', { willReadFrequently: true });
const oCtx   = els.overlay.getContext('2d');

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const lum  =(r,g,b)=>(0.2126*r+0.7152*g+0.0722*b)/255;

let srcURL=null;
let sourceMode=null; // "video" | "gif-sg" | "image"
let superGif=null, superGifImg=null, sgCanvas=null;

// dimensions CSS affichées (maj fréquente)
let viewW=0, viewH=0;

function setHint(msg=""){ if(els.hint) els.hint.textContent=msg; }

// ---- PERF state ----
let grid = { cols:0, rows:0, xCSS:[], yCSS:[] };
let lastGridKey = "";

const sampleCanvas = document.createElement('canvas');
const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
sampleCtx.imageSmoothingEnabled = false;

const USE_FAST_SAMPLE = true;  // lit 1 pixel par cellule
const TARGET_FPS = 30;         // cap FPS
let lastFrameMs = 0;
let lastFontStr = "";

// ---- Dimensions bitmap de la source (pixels intrinsèques) ----
function currentSourcePixels(){
  if (sourceMode==='gif-sg' && sgCanvas) return { pxW: sgCanvas.width, pxH: sgCanvas.height };
  if (sourceMode==='video'   && els.vid.videoWidth) return { pxW: els.vid.videoWidth, pxH: els.vid.videoHeight };
  if (els.gif.naturalWidth) return { pxW: els.gif.naturalWidth, pxH: els.gif.naturalHeight };
  return { pxW: 1, pxH: 1 };
}

// ---- Rebuild grille (positions pré-calculées + mini-canvas) ----
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

// ---- Ajuste tailles CSS + buffers internes (overlay/src en device px) ----
function syncSizes(){
  const displayEl = (sourceMode==='video') ? els.vid : (sgCanvas || els.gif);
  if (!displayEl) return;

  const rect = displayEl.getBoundingClientRect();     // taille AFFICHÉE (CSS px)
  const wCSS = Math.max(1, rect.width);
  const hCSS = Math.max(1, rect.height);

  // fixe la scène en CSS
  els.stage.style.width  = wCSS + 'px';
  els.stage.style.height = hCSS + 'px';

  // buffers en pixels RÉELS (device px)
  const dpr = window.devicePixelRatio || 1;
  const Wpx = Math.max(1, Math.round(wCSS * dpr));
  const Hpx = Math.max(1, Math.round(hCSS * dpr));

  if (els.overlay.width !== Wpx || els.overlay.height !== Hpx) {
    els.overlay.width  = Wpx; els.overlay.height = Hpx;
  }
  if (els.src.width !== Wpx || els.src.height !== Hpx) {
    els.src.width  = Wpx; els.src.height = Hpx;
  }

  // mapping 1 CSS px = dpr device px
  oCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  srcCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  oCtx.imageSmoothingEnabled = false;
  srcCtx.imageSmoothingEnabled = false;

  // expose tailles CSS + (re)build grille
  viewW = wCSS; viewH = hCSS;
  rebuildGrid();
}

// calcule taille scène (contain) depuis les métadonnées source
function sizeStageFromMediaMeta(){
  const { pxW, pxH } = currentSourcePixels();
  const vpW=Math.max(320, window.innerWidth-48), vpH=Math.max(240, window.innerHeight-48);
  const ar = pxW/pxH;
  let w = vpW, h = w/ar; if (h>vpH){ h=vpH; w=h*ar; }
  w = Math.round(w); h = Math.round(h);

  els.stage.style.width=w+'px';
  els.stage.style.height=h+'px';
  if (sgCanvas){ sgCanvas.style.width='100%'; sgCanvas.style.height='100%'; }
  syncSizes();
}

// ----- couleur par glyph -----
function colorForGlyph(cat, r,g,b, L){
  const fallback=`rgb(${Math.round(L*255)},${Math.round(L*255)},${Math.round(L*255)})`;
  if (cat==='dark')  return els.darkAuto.checked  ? `rgb(${r},${g},${b})` : (els.darkColor.value  || fallback);
  if (cat==='mid')   return els.midAuto.checked   ? `rgb(${r},${g},${b})` : (els.midColor.value   || fallback);
  return els.lightAuto.checked ? `rgb(${r},${g},${b})` : (els.lightColor.value || fallback);
}
function pickGlyphByL(L, gD,gM,gL, t1,t2){
  if(L<t1) return {ch:gD||'#',cat:'dark'};
  if(L<t2) return {ch:gM||'*',cat:'mid'};
  return {ch:gL||'.',cat:'light'};
}

// ----- copie frame -> source d’échantillonnage -----
function drawFrameToSource(){
  const displayEl = (sourceMode==='video') ? els.vid : (sgCanvas || els.gif);
  if (!displayEl || !viewW || !viewH) return;

  if (USE_FAST_SAMPLE && grid.cols && grid.rows){
    // FAST: réduire la source à (cols x rows) → 1 pixel par cellule
    sampleCtx.clearRect(0,0,grid.cols,grid.rows);
    sampleCtx.drawImage(displayEl, 0, 0, grid.cols, grid.rows);
    return;
  }

  // Fallback FULL (si besoin)
  srcCtx.clearRect(0,0,viewW,viewH);
  if (sourceMode==='video'){
    if (els.vid.readyState>=2) srcCtx.drawImage(els.vid, 0, 0, viewW, viewH);
  } else if (sourceMode==='gif-sg'){
    if (sgCanvas) srcCtx.drawImage(sgCanvas, 0,0, sgCanvas.width, sgCanvas.height, 0,0, viewW, viewH);
  } else if (sourceMode==='image'){
    if (els.gif.naturalWidth) srcCtx.drawImage(els.gif, 0, 0, viewW, viewH);
  }
}

// ---- helpers offset/stagger ----
// --- SHIM: plus d'offsetX/offsetY globaux, on ne garde que les staggers ---
function baseOffsets(){
    return {
      dx: 0,                      // plus de décalage global X
      dy: 0,                      // plus de décalage global Y
      rowStagger: parseFloat(els.staggerRows?.value || 0) || 0,
      colStagger: parseFloat(els.staggerCols?.value || 0) || 0,
    };
  }
  
  

// ---- dessine une couche de glyphs ----
function drawLayer({data, stride, rows, cols, cell, weight, t1, t2, gD, gM, gL}, layer){
    const fontStr = `${weight} ${Math.max(1, cell * (layer.scale || 1))}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    if (fontStr !== lastFontStr){ oCtx.font = fontStr; lastFontStr = fontStr; }
    oCtx.globalAlpha = parseFloat(els.opacity.value) * (layer.alpha ?? 1);
    oCtx.globalCompositeOperation = layer.blend || 'source-over';
  
    const tintOn = !!layer.tintOn;
    const tint   = layer.tint || '#ffffff';
  
    // UNIQUEMENT les staggers + le décalage de LA LAYER
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
  

// ----- rendu glyphs -----
function render(){
  // throttle FPS
  const now = performance.now();
  if (now - lastFrameMs < (1000 / TARGET_FPS)) {
    if (sourceMode==='video' && 'requestVideoFrameCallback' in els.vid){
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
    if (sourceMode==='video' && 'requestVideoFrameCallback' in els.vid){
      els.vid.requestVideoFrameCallback(()=>render());
    } else {
      requestAnimationFrame(render);
    }
    return;
  }

  // Récup pixels (FAST: minicanvas ; FULL: src)
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

  // clear en CSS (oCtx est mappé via dpr)
  oCtx.clearRect(0,0,viewW,viewH);

  // paramètres communs
  const weight = parseInt(els.weight.value, 10) || 600;
  const t1 = parseFloat(els.t1.value), t2 = parseFloat(els.t2.value);
  const gD = els.gDark.value || '#', gM = els.gMid.value || '*', gL = els.gLight.value || '.';

  // LAYER 1 (base)
  drawLayer({data, stride, rows, cols, cell, weight, t1, t2, gD, gM, gL}, {
    dx: 0, dy: 0, scale: 1, alpha: 1, blend: 'source-over', tintOn:false
  });

  // LAYER 2 (superposition)
  if (els.layer2Enabled && els.layer2Enabled.checked){
    drawLayer({data, stride, rows, cols, cell, weight, t1, t2, gD, gM, gL}, {
      dx: parseFloat(els.layer2dx.value) || 0,
      dy: parseFloat(els.layer2dy.value) || 0,
      scale: parseFloat(els.layer2scale.value) || 1,
      alpha: parseFloat(els.layer2alpha.value) || 0.5,
      blend: (els.layer2blend && els.layer2blend.value) || 'source-over',
      tintOn: !!(els.layer2TintOn && els.layer2TintOn.checked),
      tint: (els.layer2Tint && els.layer2Tint.value) || '#ffffff',
    });
  }

  // boucle
  if (sourceMode==='video' && 'requestVideoFrameCallback' in els.vid){
    els.vid.requestVideoFrameCallback(()=>render());
  } else {
    requestAnimationFrame(render);
  }
}

// boucle synchro
let rafId=0;
function startLoop(){
  stopLoop();
  if (sourceMode==='video' && 'requestVideoFrameCallback' in els.vid){
    const step=()=>els.vid.requestVideoFrameCallback(()=>{ render(); step(); });
    els.vid.requestVideoFrameCallback(()=>{ render(); step(); });
  } else {
    const loop=()=>{ rafId=requestAnimationFrame(loop); render(); };
    rafId=requestAnimationFrame(loop);
  }
}
function stopLoop(){ if (rafId) cancelAnimationFrame(rafId), rafId=0; }

// SuperGif helpers
function cleanupSuperGif(){
  try{ if (superGif && superGif.get_canvas){ const c=superGif.get_canvas(); if(c&&c.parentNode)c.parentNode.removeChild(c);} }catch(_){}
  try{ if (superGifImg && superGifImg.parentNode) superGifImg.parentNode.removeChild(superGifImg);}catch(_){}
  superGif=null; superGifImg=null; sgCanvas=null;
}

// chargement média
els.gifInput.addEventListener('change', async e=>{
  const f=e.target.files?.[0]; if(!f) return;
  if (srcURL) URL.revokeObjectURL(srcURL);
  srcURL=URL.createObjectURL(f);

  stopLoop(); cleanupSuperGif();
  els.gif.classList.add('hidden'); els.vid.classList.add('hidden');
  Array.from(els.stage.querySelectorAll('.sg-canvas')).forEach(n=>n.remove());

  if (f.type.startsWith('video/')){
    els.vid.src=srcURL; els.vid.classList.remove('hidden');
    sourceMode='video';
    await els.vid.play().catch(()=>{});
    if (els.vid.readyState<1) await new Promise(res=>els.vid.addEventListener('loadedmetadata',res,{once:true}));
    sizeStageFromMediaMeta();  // fixe la scène (CSS)
    startLoop();
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
      els.stage.insertBefore(sgCanvas, els.overlay); // sous overlay
    }
    sourceMode='gif-sg';
    sizeStageFromMediaMeta();
    startLoop();
  } else {
    els.gif.src=srcURL; await new Promise(res=>els.gif.addEventListener('load',res,{once:true}));
    els.gif.classList.remove('hidden');
    sourceMode='image';
    sizeStageFromMediaMeta();
    startLoop();
  }
});

// UI
function setPanel(open){ els.panel.classList.toggle('open',open); els.togglePanel.setAttribute('aria-expanded',String(open)); }
els.togglePanel.addEventListener('click',()=> setPanel(!els.panel.classList.contains('open')));
els.closePanel.addEventListener('click',()=> setPanel(false));

els.cell.addEventListener('input',   ()=> { els.cellVal.textContent = els.cell.value; rebuildGrid(); });
els.weight.addEventListener('input', ()=> els.weightVal.textContent= els.weight.value);
els.t1.addEventListener('input',     ()=> els.t1Val.textContent    = (+els.t1.value).toFixed(2));
els.t2.addEventListener('input',     ()=> els.t2Val.textContent    = (+els.t2.value).toFixed(2));
els.opacity.addEventListener('input',()=> els.opacityVal.textContent = (+els.opacity.value).toFixed(2));

// NEW: binds affichage live
// AVANT: la boucle incluait offsetX/offsetY
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
  

els.savePng.addEventListener('click', ()=>{
  const a=document.createElement('a');
  a.download='glyph-overlay.png';
  a.href=els.overlay.toDataURL('image/png');
  a.click();
});

window.addEventListener('resize', ()=>{ sizeStageFromMediaMeta(); });

// Boot labels + init taille
sizeStageFromMediaMeta();     // 16:9 si aucune source
syncSizes();                  // initialise transforms & buffers
els.cellVal.textContent  = els.cell.value;
els.weightVal.textContent= els.weight.value;
els.opacityVal.textContent=(+els.opacity.value).toFixed(2);
els.t1Val.textContent=(+els.t1.value).toFixed(2);
els.t2Val.textContent=(+els.t2.value).toFixed(2);
// (la boucle démarre après sélection du média)
