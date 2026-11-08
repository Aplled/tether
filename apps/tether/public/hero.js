(() => {
  "use strict";

  const canvas = document.querySelector("#network");
  const context = canvas.getContext("2d", { alpha: true });
  const orbital = document.querySelector(".orbital");
  const mapNodes = [...document.querySelectorAll(".map-node")];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const motionToggle = document.querySelector(".motion-toggle");
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  let width = 0;
  let height = 0;
  let ratio = 1;
  let frame = 0;
  let manuallyPaused = false;
  let running = !document.hidden;
  let points = [];

  const makePoints = () => {
    const count = Math.min(
      80,
      Math.max(34, Math.round((width * height) / 24000)),
    );
    points = Array.from({ length: count }, (_, index) => ({
      x: (index * 83.7 + 41) % width,
      y: (index * 47.3 + 89) % height,
      vx: ((index % 5) - 2) * 0.035,
      vy: (((index * 3) % 5) - 2) * 0.027,
      size: index % 11 === 0 ? 2 : 1,
      warm: index % 17 === 0,
      phase: index * 0.73,
    }));
  };

  const resize = () => {
    ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    makePoints();
    if (reduceMotion.matches || manuallyPaused) draw(performance.now());
  };

  const draw = (time = 0) => {
    context.clearRect(0, 0, width, height);
    pointer.x += (pointer.tx - pointer.x) * 0.045;
    pointer.y += (pointer.ty - pointer.y) * 0.045;

    points.forEach((point, index) => {
      if (!reduceMotion.matches) {
        point.x += point.vx;
        point.y += point.vy;
        if (point.x < -10) point.x = width + 10;
        if (point.x > width + 10) point.x = -10;
        if (point.y < -10) point.y = height + 10;
        if (point.y > height + 10) point.y = -10;
      }

      const px = point.x + pointer.x * (index % 4) * 2.4;
      const py = point.y + pointer.y * (index % 4) * 2.4;
      for (
        let otherIndex = index + 1;
        otherIndex < points.length;
        otherIndex += 1
      ) {
        const other = points[otherIndex];
        const ox = other.x + pointer.x * (otherIndex % 4) * 2.4;
        const oy = other.y + pointer.y * (otherIndex % 4) * 2.4;
        const dx = px - ox;
        const dy = py - oy;
        const distance = Math.hypot(dx, dy);
        if (distance < 140) {
          context.strokeStyle = `rgba(75, 130, 215, ${(1 - distance / 140) * 0.13})`;
          context.lineWidth = 0.7;
          context.beginPath();
          context.moveTo(px, py);
          context.lineTo(ox, oy);
          context.stroke();
        }
      }

      const shimmer = reduceMotion.matches
        ? 0.68
        : 0.5 + Math.sin(time * 0.0013 + point.phase) * 0.22;
      context.fillStyle = point.warm
        ? `rgba(240,120,55,${shimmer})`
        : `rgba(103,155,240,${shimmer})`;
      context.beginPath();
      context.arc(px, py, point.size, 0, Math.PI * 2);
      context.fill();
    });

    if (running && !reduceMotion.matches && !manuallyPaused)
      frame = requestAnimationFrame(draw);
  };

  const updateParallax = () => {
    orbital.style.setProperty("--pointer-x", `${pointer.tx * 8}px`);
    orbital.style.setProperty("--pointer-y", `${pointer.ty * 8}px`);
    mapNodes.forEach((node) => {
      const depth = Number(node.dataset.depth || 1);
      node.style.translate = `${pointer.tx * depth * 5}px ${pointer.ty * depth * 5}px`;
    });
  };

  window.addEventListener(
    "pointermove",
    (event) => {
      if (reduceMotion.matches || manuallyPaused) return;
      pointer.tx = event.clientX / width - 0.5;
      pointer.ty = event.clientY / height - 0.5;
      updateParallax();
    },
    { passive: true },
  );

  window.addEventListener("resize", resize, { passive: true });
  document.addEventListener("visibilitychange", () => {
    running = !document.hidden;
    document.body.classList.toggle("motion-paused", !running || manuallyPaused);
    if (running && !reduceMotion.matches && !manuallyPaused) {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    }
  });
  reduceMotion.addEventListener("change", () => {
    cancelAnimationFrame(frame);
    draw(performance.now());
  });

  motionToggle.addEventListener("click", () => {
    manuallyPaused = !manuallyPaused;
    motionToggle.setAttribute("aria-pressed", String(manuallyPaused));
    motionToggle.setAttribute(
      "aria-label",
      manuallyPaused ? "Play motion" : "Pause motion",
    );
    motionToggle.querySelector("span").textContent = manuallyPaused ? "▶" : "Ⅱ";
    document.body.classList.toggle(
      "motion-paused",
      manuallyPaused || document.hidden,
    );
    cancelAnimationFrame(frame);
    if (!manuallyPaused && running && !reduceMotion.matches)
      frame = requestAnimationFrame(draw);
  });

  document.querySelector("[data-focus-map]").addEventListener("click", () => {
    document
      .querySelector("#manifest")
      .scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth" });
  });

  resize();
  draw(performance.now());
})();
