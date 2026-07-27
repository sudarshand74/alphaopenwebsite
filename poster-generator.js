(() => {
  const dialog = document.querySelector("#matchPosterDialog");
  const canvas = document.querySelector("#matchPosterCanvas");
  const message = document.querySelector("#matchPosterMessage");
  const copyButton = document.querySelector("#copyMatchPoster");
  const downloadButton = document.querySelector("#downloadMatchPoster");
  const closeButton = document.querySelector("#closeMatchPoster");
  if (!dialog || !canvas) return;

  const context = canvas.getContext("2d");
  let currentPoster = null;
  let currentPosterBlob = null;

  function roundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
  }

  function fitFont(ctx, text, maximumWidth, startSize, weight = 800) {
    let size = startSize;
    do {
      ctx.font = `${weight} ${size}px Arial, sans-serif`;
      if (ctx.measureText(text).width <= maximumWidth) return size;
      size -= 2;
    } while (size > 22);
    return size;
  }

  function drawCentered(ctx, text, x, y, maximumWidth, startSize, color = "#071a38", weight = 800) {
    fitFont(ctx, text, maximumWidth, startSize, weight);
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
  }

  function playerLines(players) {
    return (players || [])
      .map((player) => {
        const label = String(player || "").trim();
        return /^P\d+$/i.test(label) ? "Player name unavailable" : label;
      })
      .filter(Boolean)
      .slice(0, 2);
  }

  function drawCourt(ctx) {
    const sky = ctx.createLinearGradient(0, 0, 0, 900);
    sky.addColorStop(0, "#020a18");
    sky.addColorStop(0.42, "#0d315c");
    sky.addColorStop(0.43, "#1766a5");
    sky.addColorStop(1, "#2786c1");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 1600, 900);

    ctx.fillStyle = "#21743d";
    ctx.fillRect(0, 690, 1600, 210);
    ctx.fillStyle = "#1478b5";
    ctx.beginPath();
    ctx.moveTo(290, 900);
    ctx.lineTo(1310, 900);
    ctx.lineTo(1120, 420);
    ctx.lineTo(480, 420);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.9)";
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(800, 420);
    ctx.lineTo(800, 900);
    ctx.moveTo(385, 660);
    ctx.lineTo(1215, 660);
    ctx.stroke();

    for (const x of [230, 460, 1140, 1370]) {
      const glow = ctx.createRadialGradient(x, 170, 3, x, 170, 105);
      glow.addColorStop(0, "rgba(255,255,255,.95)");
      glow.addColorStop(0.2, "rgba(255,255,255,.35)");
      glow.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(x - 110, 60, 220, 220);
    }
  }

  async function drawLogo(ctx) {
    const image = new Image();
    image.src = "assets/alphaopen-logo.png";
    try {
      await image.decode();
      const ratio = image.naturalWidth / image.naturalHeight;
      const height = 82;
      ctx.drawImage(image, 72, 34, height * ratio, height);
    } catch {
      drawCentered(ctx, "AlphaOpen", 210, 76, 280, 54, "#1758a5", 900);
    }
  }

  async function renderPoster(data) {
    canvas.width = 1600;
    canvas.height = 900;
    drawCourt(context);

    context.fillStyle = "rgba(255,255,255,.96)";
    context.fillRect(55, 28, 1490, 112);
    await drawLogo(context);
    drawCentered(context, `${data.seasonName}  ·  ${data.weekLabel}  ·  L${data.lineNumber}`, 970, 83, 1040, 54, "#05070b", 900);

    const cards = [
      { x: 80, team: data.homeTeam, players: playerLines(data.homePlayers), colorA: "#d95f0a", colorB: "#ff9a54" },
      { x: 920, team: data.awayTeam, players: playerLines(data.awayPlayers), colorA: "#0b4f91", colorB: "#3b8fd0" },
    ];
    cards.forEach((card) => {
      const gradient = context.createLinearGradient(card.x, 0, card.x + 600, 0);
      gradient.addColorStop(0, card.colorA);
      gradient.addColorStop(1, card.colorB);
      context.fillStyle = gradient;
      roundedRect(context, card.x, 190, 600, 88, 12);
      context.fill();
      context.fillStyle = "rgba(255,255,255,.96)";
      context.fillRect(card.x, 278, 600, 255);
      context.strokeStyle = "#071a38";
      context.lineWidth = 4;
      context.strokeRect(card.x, 190, 600, 343);
      drawCentered(context, card.team, card.x + 300, 235, 530, 43, "#fff", 900);
      const first = card.players[0] || "Player TBD";
      const second = card.players[1] || "Player TBD";
      drawCentered(context, first, card.x + 300, 344, 530, 42, "#071a38", 800);
      drawCentered(context, "&", card.x + 300, 405, 100, 35, "#d75a0d", 900);
      drawCentered(context, second, card.x + 300, 468, 530, 42, "#071a38", 800);
    });

    const versus = context.createRadialGradient(800, 360, 8, 800, 360, 105);
    versus.addColorStop(0, "#fff7a8");
    versus.addColorStop(0.55, "#ff8a00");
    versus.addColorStop(1, "#8b2200");
    context.fillStyle = versus;
    context.beginPath();
    context.arc(800, 360, 92, 0, Math.PI * 2);
    context.fill();
    drawCentered(context, "VS", 800, 360, 150, 56, "#fff", 900);

    context.fillStyle = "rgba(255,255,255,.96)";
    roundedRect(context, 220, 620, 1160, 220, 16);
    context.fill();
    context.strokeStyle = "#071a38";
    context.lineWidth = 3;
    context.stroke();

    const played = data.scheduledAt ? new Date(data.scheduledAt) : null;
    const dateText = played && !Number.isNaN(played.getTime())
      ? played.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })
      : "Date and time TBD";
    drawCentered(context, `📅  ${dateText}`, 800, 672, 1050, 38, "#071a38", 800);
    drawCentered(context, `📍  ${data.venueName || "Venue TBD"}`, 800, 730, 1050, 40, "#071a38", 900);
    if (data.venueAddress) drawCentered(context, data.venueAddress, 800, 782, 1050, 31, "#334155", 700);

    if (data.status === "completed" && data.score && data.score !== "—") {
      context.fillStyle = "#d7f52b";
      roundedRect(context, 590, 548, 420, 54, 27);
      context.fill();
      drawCentered(context, `FINAL  ${data.score}  ·  ${data.homePoints}-${data.awayPoints} pts`, 800, 576, 390, 27, "#071a38", 900);
    }
  }

  async function openPoster(data) {
    currentPoster = data;
    message.textContent = "Select Copy Image or Download PNG.";
    await renderPoster(data);
    currentPosterBlob = await canvasBlob();
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function canvasBlob() {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Poster image could not be created.")), "image/png"));
  }

  copyButton.addEventListener("click", async () => {
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("Image clipboard is unavailable in this browser.");
      if (!window.isSecureContext) throw new Error("Image copying requires a secure browser connection.");
      const blob = currentPosterBlob || await canvasBlob();
      const clipboardWrite = navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      await clipboardWrite;
      message.textContent = "Poster copied to clipboard.";
    } catch (error) {
      message.textContent = `${error.message} Use Download PNG instead.`;
    }
  });

  downloadButton.addEventListener("click", async () => {
    const blob = await canvasBlob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${currentPoster?.lineupId || "AlphaOpen-match-poster"}.png`;
    link.click();
    URL.revokeObjectURL(link.href);
  });

  closeButton.addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", () => dialog.close());
  window.addEventListener("alphaopen:generate-poster", (event) => openPoster(event.detail));
})();
