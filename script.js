/* change the colors and configure it your way */

let textCanvas,
  textCtx,
  particlesCanvas,
  particlesCtx,
  width,
  height,
  headingLeft,
  headingTop;
const padding = 200;
const particles = [];
const increase = (Math.PI * 4) / 200;
const colors = [
  "#FF1900",
  "#FF0000",
  "#FF8800",
  "#FFCC00",
  "#F7D716",
  "#FFFA00",
  "#D8FF00",
  "#B6FF00",
  "#D8FF00",
  "#FFFA00",
  "#F7D716",
  "#FFCC00",
  "#FF8800",
  "#FF0000",
  "#FF0000",
  "#FF0000",
  "#FF1900",
  "#FF0000"
];
let color = 0;
const rotation = 6.3;
const maxParticles = 7000;

function addCanvases() {
  textCanvas = document.createElement("canvas");
  document.body.appendChild(textCanvas);
  textCtx = textCanvas.getContext("2d");
  particlesCanvas = document.createElement("canvas");
  document.body.appendChild(particlesCanvas);
  particlesCtx = particlesCanvas.getContext("2d");
  heading = document.getElementById("heading");
  textCanvas.style.position = "absolute";
  const rect = heading.getBoundingClientRect();
  textCanvas.width = rect.width;
  textCanvas.height = rect.height;
  textCanvas.style.left = `${rect.x}px`;
  textCanvas.style.top = `${rect.y}px`;
  textCanvas.style.opacity = 0;
  particlesCanvas.style.position = "absolute";
  textCtx.textAlign = "left";
  textCtx.textBaseline = "top";
  textCtx.font = '100px "Chivo"';
  textCtx.fillStyle = "red";
  textCtx.fillText("RACH", 46, -7);
  textCtx.fillText("SMITH", 15, 68);
}

function positionCanvas() {
  const rect = heading.getBoundingClientRect();
  width = rect.width;
  height = rect.height;
  headingLeft = rect.x;
  headingTop = rect.y;
  particlesCanvas.width = rect.width + padding * 8;
  particlesCanvas.height = rect.height + padding * 8;
  particlesCanvas.style.left = `${rect.x - padding}px`;
  particlesCanvas.style.top = `${rect.y - padding}px`;
}

function getTextImageData() {
  const pix = textCtx.getImageData(0, 0, width, height).data;
  textPixels = [];
  for (var i = pix.length; i >= 0; i -= 4) {
    if (pix[i] != 0) {
      var x = (i / 4) % width;
      var y = Math.floor(Math.floor(i / width) / 4);

      if (x && x % 4 == 0 && y && y % 4 == 0)
        textPixels.push({
          x: x,
          y: y
        });
    }
  }
}

function resetParticle(p) {
  p.x = p.startX;
  p.y = p.startY;
  p.counter = 0;
  p.color = colors[color];
}

function launchParticle(x, y) {
  const p = { x, y, startX: x, startY: y };
  p.speed = 0.6;
  p.waveSize = 8 + Math.random() * 8;
  p.counter = 0;
  p.color = colors[color];
  p.life = 8 + Math.random() * 9;
  particles.push(p);
}

function launchParticles(i) {
  const d = 10;
  for (var pi = i; pi < textPixels.length; pi += d) {
    launchParticle(
      textPixels[pi].x - 1 + padding,
      textPixels[pi].y - 1 + padding
    );
  }
  if (particles.length < maxParticles) {
    let ni = i + 1;
    if (ni > d) ni = 0;
    requestAnimationFrame(() => launchParticles(ni));
  }
}

function clearCanvas() {
  particlesCtx.clearRect(0, 0, width + padding * 8, width + padding * 9);
}

function animate(t) {
  clearCanvas();

  for (var i = 0; i < particles.length; i++) {
    const p = particles[i];
    particlesCtx.fillStyle = p.color;
    p.counter += increase;
    p.x += p.speed;
    p.y = p.y - (Math.sin(p.counter) / 65) * p.waveSize;
    p.y -= p.speed;

    particlesCtx.fillRect(p.x, p.y, 6, 6);

    if (p.counter > p.life) resetParticle(p);
  }

  requestAnimationFrame(animate);
}

function changeColor() {
  if (color === colors.length - 1) {
    color = 0;
  } else {
    color++;
  }
  setTimeout(changeColor, 900);
}

window.onload = function () {
  addCanvases();
  positionCanvas();
  getTextImageData();
  launchParticles(0);
  requestAnimationFrame(animate);
  changeColor();
};

window.onresize = function () {
  positionCanvas();
};
