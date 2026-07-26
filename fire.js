/* ============ Fire scales hero — burning (optimized) ============ */
(() => {
  const canvas = document.getElementById('scales');
  if (!canvas) return;
  const isStatic = canvas.hasAttribute('data-static'); // sub-pages: baked banner, no animation
  const ctx = canvas.getContext('2d');
  const hero = canvas.parentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const SIZE = 30;             // bigger scales = far fewer to process
  const COL_STEP = SIZE * 2;   // traditional uroko: arcs meet edge-to-edge
  const ROW_STEP = SIZE;       // each row rises half a scale, peak centered on the gap below
  const RADIUS = 120;          // cursor influence radius
  const CURSOR_HEAT = 0.35;    // max heat the cursor can add
  const DECAY = 0.89;          // per-tick cooling (tuned for 30fps)
  const RISE = 0.5;            // how much heat climbs to the scale above
  const MAX_PARTS = 200;
  const FPS = 30;              // fire doesn't need 60
  const FRAME = 1000 / FPS;

  const stops = [[122,14,0],[255,61,28],[255,174,0],[255,30,94]];
  const goldHot = [255,214,120];
  const whiteHot = [255,246,220];

  let scales = [], parts = [], W = 0, H = 0, dpr = 1, cols = 0;
  let cold = null, glowSprite = null, emberSprite = null, dirty = null;
  let mx = -9999, my = -9999, running = true, lastT = 0;

  const lerp = (a,b,t) => a + (b-a)*t;
  const mix = (c1,c2,t) => [lerp(c1[0],c2[0],t), lerp(c1[1],c2[1],t), lerp(c1[2],c2[2],t)];

  function baseColor(x, y) {
    const n = Math.sin(x*0.006 + y*0.004) * Math.cos(y*0.007 - x*0.003);
    const t = (n + 1) / 2 * (stops.length - 1);
    const i = Math.min(Math.floor(t), stops.length - 2);
    return mix(stops[i], stops[i+1], t - i);
  }

  function scalePath(c, s, swell) {
    c.beginPath();
    c.arc(s.x, s.y, SIZE * swell, Math.PI, 0);
    c.lineTo(s.x + SIZE, s.y + ROW_STEP);
    c.lineTo(s.x - SIZE, s.y + ROW_STEP);
    c.closePath();
  }

  // pre-rendered radial sprites: no gradient objects created per frame
  function makeSprite(px, inner, mid, alpha) {
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const g2 = c.getContext('2d');
    const g = g2.createRadialGradient(px/2, px/2, 0, px/2, px/2, px/2);
    g.addColorStop(0, `rgba(${inner},${alpha})`);
    g.addColorStop(0.45, `rgba(${mid},${alpha*0.55})`);
    g.addColorStop(1, `rgba(${mid},0)`);
    g2.fillStyle = g;
    g2.fillRect(0, 0, px, px);
    return c;
  }

  function build() {
    dpr = Math.min(devicePixelRatio || 1, 1.5);
    W = hero.clientWidth; H = hero.clientHeight;
    if (W * H * dpr * dpr > 1.6e6) dpr = 1;   // big screens: trade sharpness for speed
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    scales = []; parts = [];
    const rows = Math.ceil(H / ROW_STEP) + 2;
    cols = Math.ceil(W / COL_STEP) + 2;
    for (let r = 0; r < rows; r++) {
      const offset = (r % 2) * (COL_STEP / 2);
      for (let c = 0; c < cols; c++) {
        const x = c * COL_STEP - COL_STEP/2 + offset;
        const y = r * ROW_STEP - ROW_STEP/2;
        const phase = Math.random() * Math.PI * 2;
        const shimmer = 0.10 + 0.12 * Math.sin(phase); // frozen flicker, reused for repaints
        scales.push({x, y, base: baseColor(x, y), heat: 0, phase, shimmer});
      }
    }

    // bake the resting field once — per-frame work only touches hot scales
    cold = document.createElement('canvas');
    cold.width = W * dpr; cold.height = H * dpr;
    const cc = cold.getContext('2d');
    cc.setTransform(dpr, 0, 0, dpr, 0, 0);
    cc.strokeStyle = 'rgba(11,5,3,.55)';
    cc.lineWidth = 1.5;
    for (const s of scales) {
      const col = mix([11,5,3], s.base, 0.34 + s.shimmer * 0.5);
      scalePath(cc, s, 1);
      cc.fillStyle = `rgb(${col[0]|0},${col[1]|0},${col[2]|0})`;
      cc.fill();
      cc.stroke();
    }

    dirty = new Uint8Array(scales.length);
    glowSprite = makeSprite(96, '255,190,80', '255,70,15', 0.34);
    emberSprite = makeSprite(24, '255,240,190', '255,120,30', 0.9);
  }

  function update(time) {
    const t = time * 0.001;
    for (let i = 0; i < scales.length; i++) {
      const s = scales[i];
      const below = scales[i + cols];
      if (below && below.heat * RISE > s.heat) s.heat = below.heat * RISE;

      const d = Math.hypot(s.x - mx, s.y - my);
      if (d < RADIUS) s.heat = Math.max(s.heat, (1 - d / RADIUS) * CURSOR_HEAT);

      if (s.y > H - ROW_STEP * 2.4) {
        const smolder = 0.30 + 0.30 * Math.sin(t*2.1 + s.x*0.045) * Math.sin(t*3.3 + s.phase);
        if (smolder > s.heat) s.heat = smolder;
      }

      s.heat *= DECAY;
      if (s.heat < 0.005) { s.heat = 0; continue; }

      if (s.heat > 0.45 && parts.length < MAX_PARTS && Math.random() < s.heat * 0.14) {
        parts.push({
          x: s.x + (Math.random()-0.5) * SIZE, y: s.y,
          vx: (Math.random()-0.5) * 0.7, vy: -(1.1 + Math.random() * 2.2),
          life: 1, size: 1.5 + Math.random() * 2.6, wob: Math.random() * Math.PI * 2
        });
      }
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.x += p.vx + Math.sin(t*6 + p.wob) * 0.45;
      p.y += p.vy;
      p.vy *= 1.012;
      p.life -= 0.024;
      if (p.life <= 0 || p.y < -10) parts.splice(i, 1);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(cold, 0, 0, W, H);

    // mark burning scales dirty, then cascade downward: any repainted
    // scale's skirt overdraws the row below, so that row repaints too —
    // this preserves the uroko overlap and hides the squared skirt edges
    dirty.fill(0);
    for (let i = 0; i < scales.length; i++) {
      if (scales[i].heat >= 0.04) dirty[i] = 1;
      if (dirty[i]) {
        const j = i + cols;
        if (j < scales.length) {
          dirty[j] = 1;
          if (j - 1 >= 0) dirty[j - 1] = 1;
          if (j + 1 < scales.length) dirty[j + 1] = 1;
        }
      }
    }

    // repaint dirty scales in row order (top first, matching the bake)
    ctx.strokeStyle = 'rgba(11,5,3,.55)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < scales.length; i++) {
      if (!dirty[i]) continue;
      const s = scales[i];
      let col;
      if (s.heat < 0.04) {
        col = mix([11,5,3], s.base, 0.34 + s.shimmer * 0.5); // identical to bake
        scalePath(ctx, s, 1);
      } else {
        col = mix([11,5,3], s.base, 0.34 + Math.min(1, s.heat + 0.12) * 0.5);
        col = mix(col, goldHot, s.heat * 0.8);
        if (s.heat > 0.75) col = mix(col, whiteHot, (s.heat - 0.75) * 3.2);
        scalePath(ctx, s, 1 + s.heat * 0.08);
      }
      ctx.fillStyle = `rgb(${col[0]|0},${col[1]|0},${col[2]|0})`;
      ctx.fill();
      ctx.stroke();
    }

    // additive flame light + embers via cached sprites
    ctx.globalCompositeOperation = 'lighter';
    for (const s of scales) {
      if (s.heat < 0.16) continue;
      const r = SIZE * (1.6 + s.heat * 2.4);
      const ry = r * (1 + s.heat * 1.4);          // flames stretch upward
      ctx.globalAlpha = s.heat;
      ctx.drawImage(glowSprite, s.x - r, s.y - ry - SIZE * s.heat, r * 2, ry * 2);
    }
    for (const p of parts) {
      ctx.globalAlpha = p.life;
      const r = p.size * 3;
      ctx.drawImage(emberSprite, p.x - r, p.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function loop(t) {
    requestAnimationFrame(loop);
    if (!running) { lastT = t; return; }
    if (t - lastT < FRAME - 1) return;          // 30fps cap
    lastT = t;
    update(t);
    draw();
  }

  build();

  if (isStatic || reduced) {
    // sub-pages / reduced motion: draw the resting field once, no loop, no listeners
    draw();
    addEventListener('resize', () => { build(); draw(); });
    return;
  }

  hero.addEventListener('pointermove', e => {
    const rect = canvas.getBoundingClientRect();
    mx = e.clientX - rect.left; my = e.clientY - rect.top;
  });
  hero.addEventListener('pointerleave', () => { mx = my = -9999; });

  // stop burning CPU when the hero is off-screen or the tab is hidden
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(en => { running = en[0].isIntersecting; }).observe(hero);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) running = false;
    else if (!('IntersectionObserver' in window)) running = true;
  });

  addEventListener('resize', build);
  requestAnimationFrame(loop);
})();

