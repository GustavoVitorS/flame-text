(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const TEXT = 'FLAME';

  const PALETTES = {
    classic: { core: '#fff4b0', mid: '#ffb11f', outer: '#ff3b1f' },
    blue: { core: '#f4ffff', mid: '#38dcff', outer: '#315cff' },
    purple: { core: '#ffd7f7', mid: '#d450ff', outer: '#6d35ff' },
    toxic: { core: '#fbff8a', mid: '#98ff26', outer: '#169447' }
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const random = (min, max) => min + Math.random() * (max - min);

  function hexToRgb(hex) {
    const value = hex.replace('#', '');
    const bigint = Number.parseInt(value.length === 3
      ? value.split('').map((char) => char + char).join('')
      : value, 16);
    return {
      r: (bigint >> 16) & 255,
      g: (bigint >> 8) & 255,
      b: bigint & 255
    };
  }

  function rgba(hex, alpha = 1) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function mixColor(a, b, amount) {
    const ca = hexToRgb(a);
    const cb = hexToRgb(b);
    const t = clamp(amount, 0, 1);
    return `rgb(${Math.round(lerp(ca.r, cb.r, t))}, ${Math.round(lerp(ca.g, cb.g, t))}, ${Math.round(lerp(ca.b, cb.b, t))})`;
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  class QualityController {
    constructor() {
      this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.levels = ['low', 'medium', 'high'];
      this.level = this.pickInitialLevel();
      this.samples = [];
      this.lastEvaluation = performance.now();
      this.lastUpgrade = performance.now();
    }

    pickInitialLevel() {
      if (this.reducedMotion) return 'low';
      const cores = navigator.hardwareConcurrency || 4;
      if (window.innerWidth <= 520 || cores <= 4) return 'low';
      if (window.innerWidth <= 1100 || cores <= 6 || window.devicePixelRatio > 2) return 'medium';
      return 'high';
    }

    get factor() {
      if (this.reducedMotion) return 0.28;
      return { low: 0.5, medium: 0.72, high: 1 }[this.level];
    }

    get dpr() {
      const cap = this.level === 'high' ? 1.6 : this.level === 'medium' ? 1.4 : 1.2;
      return Math.min(window.devicePixelRatio || 1, cap);
    }

    sample(deltaMs) {
      if (deltaMs <= 0 || deltaMs > 100) return false;
      this.samples.push(deltaMs);
      if (this.samples.length > 120) this.samples.shift();

      const now = performance.now();
      if (now - this.lastEvaluation < 2200 || this.samples.length < 40) return false;
      this.lastEvaluation = now;

      const average = this.samples.reduce((sum, value) => sum + value, 0) / this.samples.length;
      const fps = 1000 / average;
      const current = this.levels.indexOf(this.level);
      let changed = false;

      if (fps < 44 && current > 0) {
        this.level = this.levels[current - 1];
        this.lastUpgrade = now;
        changed = true;
      } else if (fps > 58 && current < this.levels.length - 1 && now - this.lastUpgrade > 9000 && !this.reducedMotion) {
        this.level = this.levels[current + 1];
        this.lastUpgrade = now;
        changed = true;
      }

      if (changed) this.samples.length = 0;
      return changed;
    }
  }

  class ParticlePool {
    constructor(limit = 720) {
      this.limit = limit;
      this.created = 0;
      this.free = [];
    }

    acquire() {
      if (this.free.length) return this.free.pop();
      if (this.created >= this.limit) return null;
      this.created += 1;
      return {};
    }

    release(particle) {
      if (this.free.length < this.limit) this.free.push(particle);
    }
  }

  class FlameSurface {
    constructor(element, engine, mode) {
      this.element = element;
      this.canvas = element.querySelector('canvas');
      this.ctx = this.canvas.getContext('2d', { alpha: true });
      this.maskCanvas = document.createElement('canvas');
      this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true });
      this.engine = engine;
      this.mode = mode;
      this.palette = engine.palette;
      this.particles = [];
      this.emitters = [];
      this.visible = true;
      this.width = 1;
      this.height = 1;
      this.dpr = 1;
      this.fontSize = 100;
      this.textX = 0;
      this.textY = 0;
      this.textTop = 0;
      this.textBottom = 0;
      this.spawnAccumulator = 0;
      this.time = Math.random() * 10;
      this.intensity = mode === 'permanent' ? 1 : 0;
      this.targetIntensity = this.intensity;
      this.touchActive = false;
      this.hotGradient = null;
      this.lastStaticIntensity = -1;
      this.bindInteraction();
      this.resize();
    }

    bindInteraction() {
      if (this.mode !== 'hover') return;

      const ignite = () => {
        if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
          this.targetIntensity = 1;
          this.engine.wake();
        }
      };
      const extinguish = () => {
        if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
          this.targetIntensity = 0;
          this.engine.wake();
        }
      };

      this.element.addEventListener('pointerenter', ignite, { passive: true });
      this.element.addEventListener('pointerleave', extinguish, { passive: true });
      this.element.addEventListener('focus', () => {
        this.targetIntensity = 1;
        this.engine.wake();
      });
      this.element.addEventListener('blur', () => {
        this.targetIntensity = 0;
        this.touchActive = false;
        this.engine.wake();
      });
      this.element.addEventListener('click', (event) => {
        if (!window.matchMedia('(hover: none), (pointer: coarse)').matches) return;
        event.preventDefault();
        this.touchActive = !this.touchActive;
        this.targetIntensity = this.touchActive ? 1 : 0;
        this.engine.wake();
      });
      this.element.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        this.targetIntensity = this.targetIntensity > 0.5 ? 0 : 1;
        this.touchActive = this.targetIntensity === 1;
        this.engine.wake();
      });
    }

    getBudget() {
      const base = this.mode === 'hover' ? 210 : 170;
      return Math.max(34, Math.round(base * this.engine.quality.factor));
    }

    getEmissionRate() {
      const base = this.mode === 'hover' ? 86 : 62;
      const intensity = this.mode === 'hover' ? Math.pow(this.intensity, 1.25) : 1;
      return base * this.engine.quality.factor * intensity;
    }

    setVisible(value) {
      this.visible = value;
      if (value) {
        this.renderStatic();
        this.engine.wake();
      }
    }

    setPalette(palette) {
      this.palette = palette;
      this.buildGradient();
      this.renderStatic();
    }

    resize() {
      const rect = this.element.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      this.width = Math.round(rect.width);
      this.height = Math.round(rect.height);
      this.dpr = this.engine.quality.dpr;
      this.canvas.width = Math.round(this.width * this.dpr);
      this.canvas.height = Math.round(this.height * this.dpr);
      this.canvas.style.width = `${this.width}px`;
      this.canvas.style.height = `${this.height}px`;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.buildTextMask();
      this.buildGradient();
      this.renderStatic();
    }

    buildTextMask() {
      const ctx = this.maskCtx;
      this.maskCanvas.width = this.width;
      this.maskCanvas.height = this.height;
      ctx.clearRect(0, 0, this.width, this.height);

      let size = clamp(this.width * 0.245, 74, 158);
      const fontFamily = 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif';
      ctx.font = `900 ${size}px ${fontFamily}`;
      let metrics = ctx.measureText(TEXT);
      const maxTextWidth = this.width * (this.width < 520 ? 0.88 : 0.82);
      if (metrics.width > maxTextWidth) {
        size *= maxTextWidth / metrics.width;
        ctx.font = `900 ${size}px ${fontFamily}`;
        metrics = ctx.measureText(TEXT);
      }

      this.fontSize = size;
      this.font = `900 ${size}px ${fontFamily}`;
      this.textX = this.width / 2;
      this.textY = this.height * 0.58;
      this.textTop = this.textY - size * 0.48;
      this.textBottom = this.textY + size * 0.42;

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = this.font;
      ctx.fillStyle = '#fff';
      ctx.fillText(TEXT, this.textX, this.textY);

      const pixels = ctx.getImageData(0, 0, this.width, this.height).data;
      const xStart = Math.max(0, Math.floor(this.textX - metrics.width / 2));
      const xEnd = Math.min(this.width - 1, Math.ceil(this.textX + metrics.width / 2));
      const yStart = Math.max(0, Math.floor(this.textTop - 4));
      const yEnd = Math.min(this.height - 1, Math.ceil(this.textBottom + 4));
      const step = this.width < 520 ? 5 : 4;
      const emitters = [];

      for (let x = xStart; x <= xEnd; x += step) {
        let previousAlpha = 0;
        for (let y = yStart; y <= yEnd; y += 2) {
          const alpha = pixels[(y * this.width + x) * 4 + 3];
          if (alpha > 80 && previousAlpha <= 80) {
            emitters.push({ x, y });
            break;
          }
          previousAlpha = alpha;
        }
      }

      this.emitters = emitters.length ? emitters : [{ x: this.textX, y: this.textTop }];
    }

    buildGradient() {
      const gradient = this.ctx.createLinearGradient(0, this.textTop, 0, this.textBottom);
      gradient.addColorStop(0, this.palette.core);
      gradient.addColorStop(0.36, this.palette.mid);
      gradient.addColorStop(1, this.palette.outer);
      this.hotGradient = gradient;
    }

    spawnParticle() {
      if (this.particles.length >= this.getBudget()) return;
      const p = this.engine.pool.acquire();
      if (!p) return;

      const emitter = this.emitters[(Math.random() * this.emitters.length) | 0];
      const ember = Math.random() < (this.mode === 'hover' ? 0.13 : 0.09);
      const intensity = this.mode === 'hover' ? Math.max(0.25, this.intensity) : 1;

      p.type = ember ? 1 : 0;
      p.x = emitter.x + random(-3.5, 3.5);
      p.y = emitter.y + random(-1, 4);
      p.vx = random(-8, 8) * intensity;
      p.vy = -random(36, ember ? 78 : 62) * (0.7 + intensity * 0.45);
      p.age = 0;
      p.life = ember ? random(0.65, 1.15) : random(0.55, 0.95);
      p.size = ember ? random(1.4, 2.7) : random(2.7, 6.3);
      p.stretch = ember ? 1 : random(1.45, 2.35);
      p.phase = random(0, TAU);
      p.wobble = random(7, 18);
      p.heat = Math.random();
      this.particles.push(p);
    }

    update(dt) {
      if (!this.visible) return;
      this.time += dt;

      if (this.mode === 'hover') {
        const speed = this.targetIntensity > this.intensity ? 6.2 : 2.3;
        const eased = 1 - Math.exp(-dt * speed);
        this.intensity += (this.targetIntensity - this.intensity) * eased;
        if (Math.abs(this.targetIntensity - this.intensity) < 0.003) this.intensity = this.targetIntensity;
      }

      const budget = this.getBudget();
      while (this.particles.length > budget) {
        this.engine.pool.release(this.particles.pop());
      }

      const emission = this.getEmissionRate();
      this.spawnAccumulator += emission * dt;
      while (this.spawnAccumulator >= 1) {
        this.spawnParticle();
        this.spawnAccumulator -= 1;
      }

      for (let i = this.particles.length - 1; i >= 0; i -= 1) {
        const p = this.particles[i];
        p.age += dt;
        if (p.age >= p.life) {
          this.engine.pool.release(p);
          this.particles[i] = this.particles[this.particles.length - 1];
          this.particles.pop();
          continue;
        }

        const normalized = p.age / p.life;
        p.phase += dt * (p.type ? 4.2 : 6.2);
        p.x += (p.vx + Math.sin(p.phase) * p.wobble) * dt;
        p.y += p.vy * dt;
        if (p.type === 0) p.vy -= 5.5 * dt;
        p.vx *= 0.995;
        p.alpha = 1 - normalized;
      }
    }

    drawText() {
      const ctx = this.ctx;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = this.font;

      if (this.mode === 'hover') {
        ctx.fillStyle = '#444349';
        ctx.fillText(TEXT, this.textX, this.textY);

        if (this.intensity > 0.001) {
          const warmup = clamp(this.intensity * 1.2, 0, 1);
          ctx.save();
          ctx.globalAlpha = warmup;
          ctx.fillStyle = this.hotGradient;
          ctx.fillText(TEXT, this.textX, this.textY);
          ctx.restore();

          ctx.save();
          ctx.globalAlpha = 0.2 + this.intensity * 0.45;
          ctx.strokeStyle = this.palette.outer;
          ctx.lineWidth = 1.2;
          ctx.strokeText(TEXT, this.textX, this.textY);
          ctx.restore();
        }
      } else {
        ctx.fillStyle = this.hotGradient;
        ctx.fillText(TEXT, this.textX, this.textY);
        ctx.save();
        ctx.globalAlpha = 0.42;
        ctx.strokeStyle = this.palette.outer;
        ctx.lineWidth = 1.15;
        ctx.strokeText(TEXT, this.textX, this.textY);
        ctx.restore();
      }
    }

    drawTongues() {
      const intensity = this.mode === 'hover' ? this.intensity : 1;
      if (intensity < 0.025 || this.emitters.length === 0) return;

      const ctx = this.ctx;
      const targetCount = Math.max(12, Math.round((this.width < 520 ? 19 : 27) * this.engine.quality.factor * intensity));
      const stride = Math.max(1, Math.floor(this.emitters.length / targetCount));

      for (let index = 0; index < this.emitters.length; index += stride) {
        const emitter = this.emitters[index];
        const seed = ((Math.sin(index * 12.9898 + 78.233) * 43758.5453) % 1 + 1) % 1;
        const pulse = 0.5 + 0.5 * Math.sin(this.time * (3.2 + seed * 1.8) + index * 0.67);
        const sway = Math.sin(this.time * (2.4 + seed) + index * 0.41) * (3.2 + seed * 4.5);
        const height = (11 + seed * 15 + pulse * 11) * (0.45 + intensity * 0.65);
        const width = (3.5 + seed * 4.2) * (0.65 + intensity * 0.45);
        const baseY = emitter.y + 2;
        const tipX = emitter.x + sway;

        ctx.fillStyle = rgba(this.palette.outer, 0.46 * intensity);
        ctx.beginPath();
        ctx.moveTo(emitter.x - width, baseY + 3);
        ctx.quadraticCurveTo(emitter.x - width * 0.45, baseY - height * 0.38, tipX, baseY - height);
        ctx.quadraticCurveTo(emitter.x + width * 0.72, baseY - height * 0.34, emitter.x + width, baseY + 3);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = rgba(this.palette.mid, 0.72 * intensity);
        ctx.beginPath();
        ctx.moveTo(emitter.x - width * 0.58, baseY + 2);
        ctx.quadraticCurveTo(emitter.x - width * 0.12, baseY - height * 0.32, emitter.x + sway * 0.55, baseY - height * 0.72);
        ctx.quadraticCurveTo(emitter.x + width * 0.43, baseY - height * 0.23, emitter.x + width * 0.6, baseY + 2);
        ctx.closePath();
        ctx.fill();

        if (seed > 0.42) {
          ctx.fillStyle = rgba(this.palette.core, 0.76 * intensity);
          ctx.beginPath();
          ctx.moveTo(emitter.x - width * 0.26, baseY + 1);
          ctx.quadraticCurveTo(emitter.x, baseY - height * 0.16, emitter.x + sway * 0.2, baseY - height * 0.42);
          ctx.quadraticCurveTo(emitter.x + width * 0.2, baseY - height * 0.13, emitter.x + width * 0.27, baseY + 1);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    drawParticles() {
      const ctx = this.ctx;
      const { core, mid, outer } = this.palette;

      for (let i = 0; i < this.particles.length; i += 1) {
        const p = this.particles[i];
        const t = p.age / p.life;
        const alpha = p.alpha * (this.mode === 'hover' ? Math.max(0.2, this.intensity) : 1);

        if (p.type === 1) {
          ctx.fillStyle = t < 0.45 ? rgba(mid, alpha) : rgba(outer, alpha * 0.85);
          ctx.fillRect(p.x, p.y, p.size, p.size);
          continue;
        }

        const color = t < 0.2 ? core : t < 0.58 ? mid : outer;
        const width = p.size * (1 - t * 0.48);
        const height = p.size * p.stretch * (1 + (1 - t) * 0.35);

        ctx.fillStyle = rgba(color, alpha * 0.92);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - height * 0.68);
        ctx.quadraticCurveTo(p.x + width * 0.72, p.y, p.x, p.y + height * 0.38);
        ctx.quadraticCurveTo(p.x - width * 0.72, p.y, p.x, p.y - height * 0.68);
        ctx.fill();
      }
    }

    renderStatic() {
      if (!this.ctx || this.width < 2) return;
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.width, this.height);
      this.drawText();
      this.lastStaticIntensity = this.intensity;
    }

    render() {
      if (!this.visible) return;
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.width, this.height);
      this.drawText();
      this.drawTongues();
      this.drawParticles();
      this.lastStaticIntensity = this.intensity;
    }

    needsAnimation() {
      if (!this.visible) return false;
      if (this.mode === 'permanent') return true;
      return this.targetIntensity > 0.001 || this.intensity > 0.003 || this.particles.length > 0;
    }
  }

  class BurnButton {
    constructor(element, engine) {
      this.element = element;
      this.canvas = element.querySelector('canvas');
      this.hitTarget = element.querySelector('.burn-hit-target');
      this.result = document.querySelector('[data-burn-result]');
      this.restoreButton = document.querySelector('[data-restore]');
      this.ctx = this.canvas.getContext('2d', { alpha: true });
      this.engine = engine;
      this.palette = engine.palette;
      this.particles = [];
      this.cells = [];
      this.visible = true;
      this.width = 1;
      this.height = 1;
      this.dpr = 1;
      this.state = 'idle';
      this.elapsed = 0;
      this.duration = engine.quality.reducedMotion ? 2.2 : 4.25;
      this.spawnAccumulator = 0;
      this.lastBurnFront = -1;
      this.rect = { x: 0, y: 0, width: 1, height: 1 };
      this.textLayout = null;
      this.emitters = [];
      this.bind();
      this.resize();
    }

    bind() {
      this.hitTarget.addEventListener('click', () => this.ignite());
      this.restoreButton.addEventListener('click', () => this.restore());
    }

    setVisible(value) {
      this.visible = value;
      if (value) {
        this.render();
        this.engine.wake();
      }
    }

    setPalette(palette) {
      this.palette = palette;
      this.render();
    }

    resize() {
      const stageRect = this.element.getBoundingClientRect();
      if (stageRect.width < 2 || stageRect.height < 2) return;

      this.width = Math.round(stageRect.width);
      this.height = Math.round(stageRect.height);
      this.dpr = this.engine.quality.dpr;
      this.canvas.width = Math.round(this.width * this.dpr);
      this.canvas.height = Math.round(this.height * this.dpr);
      this.canvas.style.width = `${this.width}px`;
      this.canvas.style.height = `${this.height}px`;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      this.layoutText();
      this.buildCells();
      this.render();
    }

    layoutText() {
      const text = 'FLAME';
      const fontFamily = 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif';
      let size = clamp(this.width * 0.245, 74, 158);
      this.ctx.font = `900 ${size}px ${fontFamily}`;
      let metrics = this.ctx.measureText(text);
      const maxTextWidth = this.width * (this.width < 520 ? 0.88 : 0.82);
      if (metrics.width > maxTextWidth) {
        size *= maxTextWidth / metrics.width;
        this.ctx.font = `900 ${size}px ${fontFamily}`;
        metrics = this.ctx.measureText(text);
      }

      const x = this.width / 2;
      const y = this.height * 0.58;
      const textTop = y - size * 0.48;
      const textBottom = y + size * 0.42;
      const bounds = {
        x: Math.max(0, x - metrics.width / 2 - size * 0.08),
        y: Math.max(0, textTop - size * 0.22),
        width: Math.min(this.width, metrics.width + size * 0.16),
        height: Math.min(this.height, (textBottom - textTop) + size * 0.44)
      };

      this.textLayout = {
        text,
        font: `900 ${size}px ${fontFamily}`,
        size,
        x,
        y,
        textTop,
        textBottom,
        bounds
      };

      this.rect = { ...bounds };
      this.emitters = [];
      const emitterStep = this.width < 520 ? 14 : 18;
      const startX = x - metrics.width / 2;
      const endX = x + metrics.width / 2;
      for (let ex = startX; ex <= endX; ex += emitterStep) {
        this.emitters.push({ x: ex, y: textTop });
      }

      const hitWidth = Math.min(this.width - 4, metrics.width + size * 0.24);
      const hitHeight = Math.min(this.height - 4, size * 1.22);
      this.hitTarget.style.width = `${Math.max(44, hitWidth)}px`;
      this.hitTarget.style.height = `${Math.max(44, hitHeight)}px`;
      this.hitTarget.style.left = '50%';
      this.hitTarget.style.top = '58%';
      this.hitTarget.style.transform = 'translate(-50%, -50%)';
    }

    buildCells() {
      const cells = [];
      const size = this.width < 520 ? 8 : 9;
      let seed = 9137;
      const seeded = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      };
      const r = {
        x: clamp(this.rect.x, 0, this.width),
        y: clamp(this.rect.y, 0, this.height),
        width: clamp(this.rect.width, 1, this.width),
        height: clamp(this.rect.height, 1, this.height)
      };

      for (let y = r.y; y < r.y + r.height; y += size) {
        for (let x = r.x; x < r.x + r.width; x += size) {
          const vertical = (y - r.y) / r.height;
          const edgeDistance = Math.min((x - r.x) / r.width, (r.x + r.width - x) / r.width) * 2;
          const threshold = clamp(seeded() * 0.68 + vertical * 0.22 + edgeDistance * 0.1, 0, 1);
          cells.push({ x, y, size: size + 1, threshold, emitted: false });
        }
      }
      this.cells = cells;
    }

    getBudget() {
      return Math.max(45, Math.round(245 * this.engine.quality.factor));
    }

    ignite() {
      if (this.state !== 'idle') return;
      this.state = 'burning';
      this.elapsed = 0;
      this.spawnAccumulator = 0;
      this.lastBurnFront = -1;
      for (const cell of this.cells) cell.emitted = false;
      this.hitTarget.disabled = true;
      this.result.hidden = true;
      this.engine.wake();
    }

    restore() {
      this.releaseParticles();
      this.state = 'idle';
      this.elapsed = 0;
      this.hitTarget.disabled = false;
      this.result.hidden = true;
      for (const cell of this.cells) cell.emitted = false;
      this.render();
      this.hitTarget.focus({ preventScroll: true });
    }

    releaseParticles() {
      for (const particle of this.particles) this.engine.pool.release(particle);
      this.particles.length = 0;
    }

    spawnAt(x, y, type = 0, power = 1) {
      if (this.particles.length >= this.getBudget()) return;
      const p = this.engine.pool.acquire();
      if (!p) return;
      p.type = type;
      p.x = x + random(-3, 3);
      p.y = y + random(-2, 3);
      p.vx = random(-18, 18) * power;
      p.vy = type === 2 ? -random(10, 24) : -random(34, 76) * power;
      p.age = 0;
      p.life = type === 2 ? random(0.75, 1.35) : random(0.5, 1.15);
      p.size = type === 1 ? random(1.2, 2.8) : type === 2 ? random(5, 10) : random(2.5, 6.5);
      p.stretch = type === 0 ? random(1.4, 2.4) : 1;
      p.phase = random(0, TAU);
      p.wobble = random(5, 18);
      p.alpha = 1;
      this.particles.push(p);
    }

    update(dt) {
      if (!this.visible || this.state !== 'burning') return;
      this.elapsed += dt;
      const progress = clamp(this.elapsed / this.duration, 0, 1);
      const r = this.rect;
      const reduced = this.engine.quality.reducedMotion;

      const activeFire = progress < 0.82 ? 1 : clamp((1 - progress) / 0.18, 0, 1);
      const rate = (reduced ? 32 : 115) * this.engine.quality.factor * activeFire;
      this.spawnAccumulator += rate * dt;
      while (this.spawnAccumulator >= 1) {
        const emitter = this.emitters.length ? this.emitters[(Math.random() * this.emitters.length) | 0] : { x: random(r.x + 8, r.x + r.width - 8), y: r.y };
        const x = emitter.x + random(-4, 4);
        const y = emitter.y + random(-2, r.height * clamp(progress * 0.42, 0.05, 0.34));
        this.spawnAt(x, y, Math.random() < 0.16 ? 1 : 0, 0.8 + progress * 0.45);
        this.spawnAccumulator -= 1;
      }

      const dissolve = clamp((progress - 0.32) / 0.45, 0, 1);
      if (dissolve > this.lastBurnFront) {
        for (let i = 0; i < this.cells.length; i += 1) {
          const cell = this.cells[i];
          if (!cell.emitted && cell.threshold <= dissolve && Math.random() < 0.18 * this.engine.quality.factor) {
            cell.emitted = true;
            this.spawnAt(cell.x, cell.y, 1, 0.75);
          }
        }
        this.lastBurnFront = dissolve;
      }

      if (progress > 0.68 && Math.random() < dt * 14 * this.engine.quality.factor) {
        this.spawnAt(random(r.x, r.x + r.width), r.y + random(0, r.height), 2, 0.6);
      }

      for (let i = this.particles.length - 1; i >= 0; i -= 1) {
        const p = this.particles[i];
        p.age += dt;
        if (p.age >= p.life) {
          this.engine.pool.release(p);
          this.particles[i] = this.particles[this.particles.length - 1];
          this.particles.pop();
          continue;
        }
        const t = p.age / p.life;
        p.phase += dt * 5;
        p.x += (p.vx + Math.sin(p.phase) * p.wobble) * dt;
        p.y += p.vy * dt;
        if (p.type === 2) {
          p.vx *= 0.985;
          p.vy *= 0.994;
        } else {
          p.vy -= 4 * dt;
        }
        p.alpha = 1 - t;
      }

      if (progress >= 1) {
        this.state = 'done';
        this.hitTarget.disabled = true;
        this.releaseParticles();
        this.render();
        this.result.hidden = false;
      }
    }

    drawButton(progress) {
      const ctx = this.ctx;
      const layout = this.textLayout;
      const heat = this.state === 'idle' ? 0 : clamp(progress / 0.28, 0, 1);
      const dissolve = this.state === 'burning' ? clamp((progress - 0.32) / 0.45, 0, 1) : 0;
      const fade = this.state === 'burning' ? 1 - clamp((progress - 0.78) / 0.17, 0, 1) : this.state === 'done' ? 0 : 1;

      if (fade <= 0 || !layout) return;

      ctx.save();
      ctx.globalAlpha = fade;
      ctx.font = layout.font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.fillStyle = '#444349';
      ctx.fillText(layout.text, layout.x, layout.y, this.width * 0.96);

      if (heat > 0.02) {
        const gradient = ctx.createLinearGradient(0, layout.textTop, 0, layout.textBottom);
        gradient.addColorStop(0, this.palette.core);
        gradient.addColorStop(0.36, this.palette.mid);
        gradient.addColorStop(1, this.palette.outer);

        ctx.save();
        ctx.globalAlpha = clamp(heat * 1.05, 0, 1);
        ctx.fillStyle = gradient;
        ctx.fillText(layout.text, layout.x, layout.y, this.width * 0.96);
        ctx.restore();

        ctx.save();
        ctx.globalAlpha = 0.18 + heat * 0.42;
        ctx.strokeStyle = this.palette.outer;
        ctx.lineWidth = 1.1 + heat * 0.7;
        ctx.strokeText(layout.text, layout.x, layout.y, this.width * 0.96);
        ctx.restore();
      }

      if (dissolve > 0) {
        ctx.globalCompositeOperation = 'destination-out';
        for (let i = 0; i < this.cells.length; i += 1) {
          const cell = this.cells[i];
          if (cell.threshold <= dissolve) {
            const local = clamp((dissolve - cell.threshold) * 5.5, 0.15, 1);
            ctx.globalAlpha = local;
            ctx.fillStyle = '#000';
            ctx.fillRect(cell.x, cell.y, cell.size, cell.size);
          }
        }
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();
    }

    drawParticles() {
      const ctx = this.ctx;
      for (const p of this.particles) {
        const t = p.age / p.life;
        if (p.type === 2) {
          ctx.fillStyle = `rgba(128, 123, 117, ${p.alpha * 0.16})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.65 + t), 0, TAU);
          ctx.fill();
          continue;
        }
        if (p.type === 1) {
          ctx.fillStyle = t < 0.5 ? rgba(this.palette.mid, p.alpha) : rgba(this.palette.outer, p.alpha * 0.85);
          ctx.fillRect(p.x, p.y, p.size, p.size);
          continue;
        }
        const color = t < 0.22 ? this.palette.core : t < 0.6 ? this.palette.mid : this.palette.outer;
        const width = p.size * (1 - t * 0.45);
        const height = p.size * p.stretch;
        ctx.fillStyle = rgba(color, p.alpha * 0.92);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - height * 0.68);
        ctx.quadraticCurveTo(p.x + width * 0.75, p.y, p.x, p.y + height * 0.38);
        ctx.quadraticCurveTo(p.x - width * 0.75, p.y, p.x, p.y - height * 0.68);
        ctx.fill();
      }
    }

    render() {
      if (!this.ctx || this.width < 2) return;
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.width, this.height);
      const progress = this.state === 'burning' ? clamp(this.elapsed / this.duration, 0, 1) : this.state === 'done' ? 1 : 0;
      this.drawButton(progress);
      this.drawParticles();
    }

    needsAnimation() {
      return this.visible && this.state === 'burning';
    }
  }

  class FlameEngine {
    constructor() {
      this.quality = new QualityController();
      this.pool = new ParticlePool(760);
      this.palette = { ...PALETTES.classic };
      this.surfaces = [];
      this.burnButton = null;
      this.rafId = 0;
      this.lastTime = 0;
      this.running = false;
      this.pageVisible = document.visibilityState === 'visible';
      this.resizeTimer = 0;
      this.tick = this.tick.bind(this);
      this.setup();
    }

    setup() {
      document.querySelectorAll('[data-flame-stage]').forEach((element) => {
        this.surfaces.push(new FlameSurface(element, this, element.dataset.flameStage));
      });
      const burnElement = document.querySelector('[data-burn-stage]');
      if (burnElement) this.burnButton = new BurnButton(burnElement, this);

      this.setupObservers();
      this.setupPaletteControls();
      this.setupVisibility();
      this.wake();
    }

    setupObservers() {
      const resize = () => {
        window.clearTimeout(this.resizeTimer);
        this.resizeTimer = window.setTimeout(() => {
          for (const surface of this.surfaces) surface.resize();
          if (this.burnButton) this.burnButton.resize();
          this.wake();
        }, 100);
      };
      window.addEventListener('resize', resize, { passive: true });

      if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            const targetSurface = this.surfaces.find((surface) => surface.element === entry.target);
            if (targetSurface) targetSurface.setVisible(entry.isIntersecting);
            if (this.burnButton && this.burnButton.element === entry.target) this.burnButton.setVisible(entry.isIntersecting);
          }
          this.wake();
        }, { rootMargin: '120px 0px', threshold: 0.01 });

        for (const surface of this.surfaces) observer.observe(surface.element);
        if (this.burnButton) observer.observe(this.burnButton.element);
      }
    }

    setupVisibility() {
      document.addEventListener('visibilitychange', () => {
        this.pageVisible = document.visibilityState === 'visible';
        if (!this.pageVisible) {
          if (this.rafId) cancelAnimationFrame(this.rafId);
          this.rafId = 0;
          this.running = false;
          return;
        }
        this.lastTime = performance.now();
        this.wake();
      });
    }

    setupPaletteControls() {
      const buttons = [...document.querySelectorAll('[data-palette]')];
      const customPanel = document.querySelector('[data-custom-colors]');
      const colorInputs = [...document.querySelectorAll('[data-color]')];

      const activateButton = (button) => {
        for (const item of buttons) item.classList.toggle('is-active', item === button);
      };

      for (const button of buttons) {
        button.addEventListener('click', () => {
          const name = button.dataset.palette;
          activateButton(button);
          const isCustom = name === 'custom';
          customPanel.hidden = !isCustom;
          if (isCustom) {
            this.applyCustomPalette(colorInputs);
          } else {
            this.setPalette(PALETTES[name]);
          }
        });
      }

      for (const input of colorInputs) {
        input.addEventListener('input', () => {
          const customButton = buttons.find((button) => button.dataset.palette === 'custom');
          activateButton(customButton);
          customPanel.hidden = false;
          this.applyCustomPalette(colorInputs);
        });
      }
    }

    applyCustomPalette(inputs) {
      const palette = {};
      for (const input of inputs) palette[input.dataset.color] = input.value;
      this.setPalette(palette);
    }

    setPalette(palette) {
      this.palette = { ...palette };
      for (const surface of this.surfaces) surface.setPalette(this.palette);
      if (this.burnButton) this.burnButton.setPalette(this.palette);
      document.documentElement.style.setProperty('--warm', this.palette.outer);
      this.wake();
    }

    hasWork() {
      if (!this.pageVisible) return false;
      if (this.surfaces.some((surface) => surface.needsAnimation())) return true;
      return Boolean(this.burnButton && this.burnButton.needsAnimation());
    }

    wake() {
      if (!this.pageVisible || this.running || !this.hasWork()) return;
      this.running = true;
      this.lastTime = performance.now();
      this.rafId = requestAnimationFrame(this.tick);
    }

    tick(now) {
      if (!this.pageVisible) {
        this.running = false;
        this.rafId = 0;
        return;
      }

      const deltaMs = clamp(now - this.lastTime, 0, 40);
      const dt = deltaMs / 1000;
      this.lastTime = now;

      const qualityChanged = this.quality.sample(deltaMs);
      if (qualityChanged) {
        for (const surface of this.surfaces) surface.resize();
        if (this.burnButton) this.burnButton.resize();
      }

      for (const surface of this.surfaces) {
        if (!surface.needsAnimation()) continue;
        surface.update(dt);
        surface.render();
      }

      if (this.burnButton && this.burnButton.needsAnimation()) {
        this.burnButton.update(dt);
        this.burnButton.render();
      }

      if (this.hasWork()) {
        this.rafId = requestAnimationFrame(this.tick);
      } else {
        this.running = false;
        this.rafId = 0;
      }
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    new FlameEngine();
  }, { once: true });
})();
