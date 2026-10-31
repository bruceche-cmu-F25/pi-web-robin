// Standalone prototype: refract ONLY a copy of the known scene background.
// No application CSS, DOM snapshots, user data, frameworks or production engine.
// Ordinary SVG filter (not SVG backdrop-filter) keeps the technique portable;
// this is not a solution for arbitrary overlapping application content.
const scene = document.querySelector('.scene');
const glass = document.querySelector('.glass');
const specimen = document.querySelector('.specimen');
const optics = document.querySelector('.optics');
const defs = document.querySelector('.filter-definitions defs');
const position = document.querySelector('.position input');
const refract = document.querySelector('.refraction input');
const feedback = document.querySelector('.feedback');
const preferences = matchMedia('(prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)');
const state = { component: 'search', material: 'clear', background: 'lake' };
const defaults = { ...state };
const allowed = { component: ['search', 'toolbar', 'sheet'], material: ['clear', 'frost', 'solid'], background: ['lake', 'paper', 'grid'] };
const params = new URLSearchParams(location.search);
for (const key of Object.keys(state)) if (allowed[key].includes(params.get(key))) state[key] = params.get(key);
const namespace = 'http://www.w3.org/2000/svg';
let generation = 0, geometry = '', timer;
const svg = (tag, attributes) => {
  const node = document.createElementNS(namespace, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
};

function align() {
  const width = scene.clientWidth, height = scene.clientHeight;
  const w = glass.offsetWidth, h = glass.offsetHeight;
  const shift = (Number(position.value) - 50) / 50 * Math.max(0, (width - w) / 2 - 20);
  specimen.style.setProperty('--shift', `${shift}px`);
  const x = -((width - w) / 2 + shift), y = -(height - h) / 2;
  optics.style.setProperty('--source-x', `${x}px`);
  optics.style.setProperty('--source-y', `${y}px`);
  // Match background-size: cover for the bundled 1600×1067 photograph,
  // but paint only the lens-sized crop. Oversized filtered children can be
  // clipped inconsistently by SVG filter regions, particularly on WebKit.
  const zoom = Math.max(width / 1600, height / 1067);
  optics.style.setProperty('--photo-width', `${1600 * zoom}px`);
  optics.style.setProperty('--photo-height', `${1067 * zoom}px`);
  optics.style.setProperty('--photo-x', `${x + (width - 1600 * zoom) / 2}px`);
  optics.style.setProperty('--photo-y', `${y + (height - 1067 * zoom) / 2}px`);
  optics.style.setProperty('--scene-width', `${width}px`);
  optics.style.setProperty('--scene-height', `${height}px`);
}

function finish() {
  const soft = state.material === 'frost' ? 10 : .7;
  defs.querySelector('feGaussianBlur')?.setAttribute('stdDeviation', String(soft));
  for (const node of defs.querySelectorAll('feDisplacementMap')) {
    node.setAttribute('scale', refract.checked ? node.dataset.strength : '0');
  }
}

async function buildLens() {
  align();
  refract.disabled = preferences.matches;
  if (preferences.matches) {
    generation++; geometry = ''; defs.replaceChildren();
    optics.style.filter = 'none'; delete scene.dataset.optics;
    feedback.textContent = '已遵循系统偏好，透明与折射效果关闭。';
    return;
  }
  const w = glass.offsetWidth, h = glass.offsetHeight;
  const r = Math.min(parseFloat(getComputedStyle(glass).borderRadius), w / 2, h / 2);
  const key = `${w}:${h}:${r}`;
  if (geometry === key) { finish(); return; }
  geometry = key;
  const version = ++generation;
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(384, w); canvas.height = Math.min(384, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) { geometry = ''; return; }
  const image = ctx.createImageData(canvas.width, canvas.height);
  const band = Math.min(22, h * .28, w * .28);
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const px = (x + .5) * w / canvas.width - w / 2;
    const py = (y + .5) * h / canvas.height - h / 2;
    const qx = Math.abs(px) - w / 2 + r, qy = Math.abs(py) - h / 2 + r;
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), d = Math.hypot(ox, oy);
    const inside = r - d - Math.min(Math.max(qx, qy), 0);
    // A smooth inward lip, neutral outside and at the centre of the pane.
    const power = inside > 0 && inside < band ? Math.sin(Math.PI * inside / band) ** .7 : 0;
    const nx = d ? ox / d : qx > qy ? 1 : 0;
    const ny = d ? oy / d : qx > qy ? 0 : 1;
    const i = (y * canvas.width + x) * 4;
    image.data[i] = 128 - Math.sign(px) * nx * power * 127;
    image.data[i + 1] = 128 - Math.sign(py) * ny * power * 127;
    image.data[i + 2] = 128;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const url = canvas.toDataURL();
  const decoded = new Image(); decoded.src = url;
  try { await decoded.decode(); } catch { geometry = ''; return; }
  if (version !== generation || preferences.matches) return;
  const id = `study-lens-${version}`;
  const filter = svg('filter', { id, x: -24, y: -24, width: w + 48, height: h + 48, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' });
  filter.append(svg('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: .7, result: 'soft' }));
  filter.append(svg('feImage', { href: url, x: 0, y: 0, width: w, height: h, preserveAspectRatio: 'none', result: 'map' }));
  // Subtle dispersion: three slightly different sampling offsets, not coloured
  // borders painted over the content. RGB recombines without shifting the centre.
  for (let channel = 0; channel < 3; channel++) {
    const strength = 36 * [1.035, 1, .965][channel];
    filter.append(svg('feDisplacementMap', { in: 'soft', in2: 'map', scale: strength, 'data-strength': strength, xChannelSelector: 'R', yChannelSelector: 'G', result: `sample${channel}` }));
    const matrix = new Array(20).fill(0); matrix[channel * 6] = 1; matrix[18] = 1;
    filter.append(svg('feColorMatrix', { in: `sample${channel}`, type: 'matrix', values: matrix.join(' '), result: `channel${channel}` }));
  }
  filter.append(svg('feBlend', { in: 'channel0', in2: 'channel1', mode: 'screen', result: 'redgreen' }));
  filter.append(svg('feBlend', { in: 'redgreen', in2: 'channel2', mode: 'screen' }));
  defs.replaceChildren(filter);
  optics.style.filter = `url("#${id}")`;
  scene.dataset.optics = 'ready';
  finish();
}

function render() {
  for (const [key, value] of Object.entries(state)) {
    scene.dataset[key] = value;
    for (const button of document.querySelectorAll(`[data-control="${key}"] button`)) button.setAttribute('aria-pressed', String(button.dataset.value === value));
  }
  for (const view of document.querySelectorAll('[data-view]')) view.hidden = view.dataset.view !== state.component;
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(state)) url.searchParams.set(key, value);
  history.replaceState(null, '', url);
  void buildLens();
}
for (const group of document.querySelectorAll('[data-control]')) {
  group.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    state[group.dataset.control] = button.dataset.value;
    render();
  });
}
position.addEventListener('input', align);
refract.addEventListener('change', finish);
const search = () => { feedback.textContent = '这是材质样板，不会发出搜索请求。输入文字仍保留在搜索框里。'; };
document.querySelector('.search-action').addEventListener('click', search);
document.querySelector('.search input').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) search(); });
for (const button of document.querySelectorAll('.return, .close')) button.addEventListener('click', () => {
  state.component = 'search'; render(); document.querySelector('.search input').focus({ preventScroll: true });
});
for (const button of document.querySelectorAll('[data-tool]')) button.addEventListener('click', () => {
  if (button.dataset.tool === 'bookmark') {
    const checked = button.getAttribute('aria-pressed') === 'true';
    button.setAttribute('aria-pressed', String(!checked));
    button.querySelector('span').textContent = checked ? '收藏' : '已选中';
    feedback.textContent = '这里只切换按钮状态，不会新增收藏。';
  } else { position.value = button.dataset.tool === 'back' ? '0' : '100'; align(); }
});
document.querySelector('.reset').addEventListener('click', () => {
  Object.assign(state, defaults); position.value = '50'; refract.checked = true;
  const bookmark = document.querySelector('[data-tool="bookmark"]');
  bookmark.setAttribute('aria-pressed', 'false'); bookmark.querySelector('span').textContent = '收藏';
  feedback.textContent = '预览已恢复初始状态，输入文字保留。'; render();
});
const observer = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(buildLens, 80); });
observer.observe(scene); observer.observe(glass);
preferences.addEventListener('change', () => {
  if (!preferences.matches) feedback.textContent = '透明效果已恢复。所有控件仅用于演示。';
  void buildLens();
});
render();
