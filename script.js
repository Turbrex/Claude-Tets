const countEl = document.getElementById("count");
const bestEl = document.getElementById("best");
const cpsEl = document.getElementById("cps");
const clickBtn = document.getElementById("clickBtn");
const resetBtn = document.getElementById("resetBtn");

let count = Number(localStorage.getItem("clickCount")) || 0;
let best = Number(localStorage.getItem("clickBest")) || 0;
let clickTimestamps = [];

function render() {
  countEl.textContent = count;
  bestEl.textContent = best;
}

function bump() {
  countEl.classList.remove("bump");
  void countEl.offsetWidth;
  countEl.classList.add("bump");
}

function updateCps() {
  const now = Date.now();
  clickTimestamps.push(now);
  clickTimestamps = clickTimestamps.filter((t) => now - t <= 1000);
  cpsEl.textContent = clickTimestamps.length;
}

clickBtn.addEventListener("click", () => {
  count += 1;
  if (count > best) {
    best = count;
    localStorage.setItem("clickBest", best);
  }
  localStorage.setItem("clickCount", count);
  updateCps();
  bump();
  render();
});

resetBtn.addEventListener("click", () => {
  count = 0;
  localStorage.setItem("clickCount", count);
  render();
});

setInterval(() => {
  const now = Date.now();
  clickTimestamps = clickTimestamps.filter((t) => now - t <= 1000);
  cpsEl.textContent = clickTimestamps.length;
}, 500);

render();
