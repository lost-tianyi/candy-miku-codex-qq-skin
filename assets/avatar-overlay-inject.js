((overlayPetDataUrl, overlayLive2D) => {
  if (!/avatar-overlay/i.test(String(location.href || ""))) return { installed: false, reason: "not-overlay" };

  const STYLE_ID = "codex-qq-skin-avatar-overlay-style";
  const IMG_ID = "codex-qq-skin-avatar-overlay-img";
  const CANVAS_ID = "codex-qq-skin-avatar-overlay-canvas";
  const STATE_KEY = "__CODEX_QQ_SKIN_AVATAR_OVERLAY__";
  const STATUS_KEY = "codex-qq-skin-pet-status";
  const previous = window[STATE_KEY];
  previous?.cleanup?.();

  const live2d = overlayLive2D && typeof overlayLive2D === "object" && Array.isArray(overlayLive2D.layers)
    ? overlayLive2D
    : null;
  const useLive2D = Boolean(live2d?.layers?.length);

  const cssText = `
[data-testid="codex-avatar"].codex-avatar-root,
.codex-avatar-root[data-avatar-asset-ref],
[data-avatar-mascot="true"] .codex-avatar-root {
  background-image: none !important;
  background-size: auto !important;
  overflow: visible !important;
  transform: none !important;
  animation: none !important;
}
#${IMG_ID}, #${CANVAS_ID} {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center center;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
  filter: drop-shadow(0 1px 2px rgb(18 70 96 / .06));
  z-index: 2;
}
#${CANVAS_ID} { image-rendering: auto; }
[data-testid="avatar-mascot-button"],
[data-avatar-overlay-hit-region="mascot"] {
  overflow: visible !important;
}
`;

  const ensureStyle = () => {
    let style = document.getElementById(STYLE_ID);
    if (!style || style.parentElement !== document.documentElement) {
      style?.remove();
      style = document.createElement("style");
      style.id = STYLE_ID;
      document.documentElement.appendChild(style);
    }
    if (style.textContent !== cssText) style.textContent = cssText;
    return style;
  };

  const findRoot = () => document.querySelector('[data-testid="codex-avatar"].codex-avatar-root')
    || document.querySelector(".codex-avatar-root");

  const ensureImageFallback = () => {
    const root = findRoot();
    if (!root || !overlayPetDataUrl) return null;
    document.getElementById(CANVAS_ID)?.remove();
    if (getComputedStyle(root).position === "static") root.style.position = "relative";
    let img = document.getElementById(IMG_ID);
    if (!img || img.parentElement !== root) {
      img?.remove();
      img = document.createElement("img");
      img.id = IMG_ID;
      img.alt = "";
      img.decoding = "async";
      img.draggable = false;
      root.appendChild(img);
    }
    if (img.getAttribute("src") !== overlayPetDataUrl) img.src = overlayPetDataUrl;
    return img;
  };

  let runtime = null;
  let bootPromise = null;

  const loadImage = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("layer-load-failed"));
    img.src = src;
  });

  const loadLayerSpecs = async (specs) => {
    const loaded = [];
    for (const spec of specs || []) {
      if (!spec?.image) continue;
      try {
        const img = await loadImage(spec.image);
        loaded.push({
          id: String(spec.id || "layer"),
          role: String(spec.role || "base"),
          img,
          pivotX: Number.isFinite(spec.pivotX) ? spec.pivotX : 0.5,
          pivotY: Number.isFinite(spec.pivotY) ? spec.pivotY : 0.5,
          amp: Number.isFinite(spec.amp) ? spec.amp : 1,
          phase: Number.isFinite(spec.phase) ? spec.phase : 0,
          z: Number.isFinite(spec.z) ? spec.z : 0,
        });
      } catch {
        // skip broken layer
      }
    }
    return loaded;
  };

  const readPetStatus = () => {
    try {
      if (runtime?.forcedStatus) return runtime.forcedStatus;
      return String(window.localStorage?.getItem(STATUS_KEY) || "").trim() || "idle";
    } catch {
      return "idle";
    }
  };

  /** Map Codex companion status → visual pet state. */
  const visualStateForStatus = (status, available) => {
    const has = (name) => Boolean(available[name]?.length);
    if (status === "running") {
      if (has("working")) return "working";
      if (has("thinking")) return "thinking";
      if (has("wave")) return "wave";
    }
    if (status === "approval") {
      if (has("thinking")) return "thinking";
      if (has("wave")) return "wave";
    }
    if (status === "completed") {
      if (has("wave")) return "wave";
    }
    // idle / offline / unknown → idle
    if (has("idle")) return "idle";
    return Object.keys(available)[0] || "idle";
  };

  const motionForState = (t, state) => {
    if (state === "wave") {
      const breath = Math.sin(t * Math.PI * 2 / 2.4);
      const sway = Math.sin(t * Math.PI * 2 / 2.8);
      const wave = Math.sin(t * Math.PI * 2 / 1.15);
      return {
        dx: sway * 1.2 + wave * 0.55,
        dy: breath * 1.9,
        rot: sway * 0.018 + wave * 0.012,
        sx: 1 + breath * 0.008,
        sy: 1 + breath * 0.018,
      };
    }
    if (state === "thinking") {
      // Softer bob + slight curious tilt
      const breath = Math.sin(t * Math.PI * 2 / 3.2);
      const sway = Math.sin(t * Math.PI * 2 / 4.4);
      return {
        dx: sway * 0.75,
        dy: breath * 1.35,
        rot: sway * 0.022,
        sx: 1 + breath * 0.006,
        sy: 1 + breath * 0.014,
      };
    }
    if (state === "working") {
      // Quicker busy bob — typing / focused energy
      const breath = Math.sin(t * Math.PI * 2 / 1.9);
      const sway = Math.sin(t * Math.PI * 2 / 2.5);
      const tap = Math.sin(t * Math.PI * 2 / 0.55);
      return {
        dx: sway * 0.85,
        dy: breath * 1.55 + tap * 0.35,
        rot: sway * 0.014,
        sx: 1 + breath * 0.007,
        sy: 1 + breath * 0.015 + tap * 0.002,
      };
    }
    const breath = Math.sin(t * Math.PI * 2 / 2.9);
    const sway = Math.sin(t * Math.PI * 2 / 3.6);
    return {
      dx: sway * 1.0,
      dy: breath * 1.7,
      rot: sway * 0.016,
      sx: 1 + breath * 0.007,
      sy: 1 + breath * 0.016,
    };
  };

  const drawFrame = (now) => {
    if (!runtime) return;
    const { canvas, ctx, width, height, startedAt, statePacks, activeState } = runtime;
    const layers = statePacks[activeState] || statePacks.idle || [];
    if (!layers.length) return;

    const t = (now - startedAt) / 1000;
    const motion = motionForState(t, activeState);

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    ctx.clearRect(0, 0, width, height);

    const sorted = layers.slice().sort((a, b) => a.z - b.z);
    const baseLayer = sorted.find((l) => l.role === "base" || l.role === "body") || sorted[0];
    const pivotX = (baseLayer?.pivotX ?? 0.5) * width;
    const pivotY = (baseLayer?.pivotY ?? 0.58) * height;

    for (const layer of sorted) {
      const img = layer.img;
      if (!img?.complete || !img.naturalWidth) continue;
      const role = layer.role || "base";
      if (["eyes-closed", "blink", "bangs", "hair-l", "hair-r", "hair", "head", "accessory", "eyes-open"].includes(role)) {
        continue;
      }

      ctx.save();
      ctx.globalAlpha = 1;
      ctx.translate(pivotX + motion.dx, pivotY + motion.dy);
      ctx.rotate(motion.rot);
      ctx.scale(motion.sx, motion.sy);
      ctx.translate(-pivotX, -pivotY);
      ctx.drawImage(img, 0, 0, width, height);
      ctx.restore();
    }
  };

  const tick = (now) => {
    if (!runtime) return;
    // Poll status every ~0.5s so same-window localStorage writes still switch pose
    // (storage events only fire across windows).
    if (!runtime._lastStatusPoll || now - runtime._lastStatusPoll > 500) {
      runtime._lastStatusPoll = now;
      syncActiveState();
    }
    drawFrame(now);
    runtime.raf = requestAnimationFrame(tick);
  };

  const syncActiveState = () => {
    if (!runtime) return;
    const status = readPetStatus();
    const next = visualStateForStatus(status, runtime.statePacks);
    runtime.lastStatus = status;
    if (next && next !== runtime.activeState && runtime.statePacks[next]?.length) {
      runtime.activeState = next;
    }
  };

  const ensureLive2D = async () => {
    const root = findRoot();
    if (!root || !live2d) return null;
    if (getComputedStyle(root).position === "static") root.style.position = "relative";
    document.getElementById(IMG_ID)?.remove();

    let canvas = document.getElementById(CANVAS_ID);
    if (!canvas || canvas.parentElement !== root) {
      canvas?.remove();
      canvas = document.createElement("canvas");
      canvas.id = CANVAS_ID;
      root.appendChild(canvas);
    }

    if (runtime?.canvas === canvas && runtime.statePacks) {
      syncActiveState();
      return canvas;
    }
    if (bootPromise) return bootPromise.then(() => canvas);

    bootPromise = (async () => {
      const width = Math.max(64, Math.round(Number(live2d.width) || 420));
      const height = Math.max(64, Math.round(Number(live2d.height) || 520));
      const statePacks = {};
      const states = live2d.states && typeof live2d.states === "object" ? live2d.states : null;
      if (states) {
        for (const [name, pack] of Object.entries(states)) {
          const loaded = await loadLayerSpecs(pack?.layers);
          if (loaded.length) statePacks[name] = loaded;
        }
      }
      if (!statePacks.idle?.length) {
        const fallback = await loadLayerSpecs(live2d.layers);
        if (fallback.length) statePacks.idle = fallback;
      }
      if (!Object.keys(statePacks).length) throw new Error("no-live2d-layers");

      const ctx = canvas.getContext("2d", { alpha: true });
      if (!ctx) throw new Error("no-2d-context");
      if (runtime?.raf) cancelAnimationFrame(runtime.raf);

      const defaultState = "idle";
      const initial = statePacks[defaultState]?.length
        ? defaultState
        : (statePacks.idle ? "idle" : Object.keys(statePacks)[0]);

      runtime = {
        canvas,
        ctx,
        statePacks,
        activeState: initial,
        lastStatus: "idle",
        forcedStatus: null,
        width,
        height,
        startedAt: performance.now(),
        raf: 0,
      };
      canvas.width = width;
      canvas.height = height;
      syncActiveState();
      runtime.raf = requestAnimationFrame(tick);
      return canvas;
    })().catch(() => {
      runtime = null;
      bootPromise = null;
      ensureImageFallback();
      return null;
    });

    return bootPromise;
  };

  const sync = () => {
    ensureStyle();
    if (useLive2D) {
      void ensureLive2D();
      return;
    }
    ensureImageFallback();
  };

  sync();
  const observer = typeof MutationObserver === "function"
    ? new MutationObserver(sync)
    : null;
  observer?.observe(document.documentElement, { childList: true, subtree: true });
  const timer = setInterval(sync, 800);
  const onStorage = (event) => {
    if (event.key && event.key !== STATUS_KEY) return;
    syncActiveState();
  };
  window.addEventListener("storage", onStorage);

  let statusChannel = null;
  try {
    statusChannel = new BroadcastChannel("codex-qq-skin-pet");
    statusChannel.onmessage = (event) => {
      const status = String(event?.data?.status || "").trim();
      if (!status || !runtime) return;
      runtime.forcedStatus = null;
      try { window.localStorage?.setItem(STATUS_KEY, status); } catch {}
      syncActiveState();
    };
  } catch {
    statusChannel = null;
  }

  window[STATE_KEY] = {
    installed: true,
    mode: useLive2D ? "live2d-lite" : "single-animated",
    getDebugState: () => ({
      status: runtime?.lastStatus || readPetStatus(),
      activeState: runtime?.activeState || null,
      packs: Object.keys(runtime?.statePacks || {}),
    }),
    setStatus: (status) => {
      const next = String(status || "idle").trim() || "idle";
      if (runtime) runtime.forcedStatus = next;
      try { window.localStorage?.setItem(STATUS_KEY, next); } catch {}
      syncActiveState();
      return window[STATE_KEY].getDebugState();
    },
    cleanup: () => {
      observer?.disconnect();
      clearInterval(timer);
      window.removeEventListener("storage", onStorage);
      try { statusChannel?.close?.(); } catch {}
      if (runtime?.raf) cancelAnimationFrame(runtime.raf);
      runtime = null;
      bootPromise = null;
      document.getElementById(STYLE_ID)?.remove();
      document.getElementById(IMG_ID)?.remove();
      document.getElementById(CANVAS_ID)?.remove();
      delete window[STATE_KEY];
      return true;
    },
  };
  return {
    installed: true,
    target: "avatar-overlay",
    mode: useLive2D ? "live2d-lite" : "single-animated",
  };
})(
  __QQ_SKIN_OVERLAY_PET_JSON__,
  __QQ_SKIN_OVERLAY_LIVE2D_JSON__
);
