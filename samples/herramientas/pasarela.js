// Pasarela de la web (portada): tiras de andar hacia la derecha de personajes y criaturas del juego, todas con los pies
// en la misma línea y al mismo tamaño de mundo (16 px = 1 casilla). Genera web/img/pasarela/*.png y web/pasarela.css.
// Uso: node Arte/pasarela.js [--control]
const fs = require('fs'), path = require('path');
const P = require('./pnglib.js');
const G = path.join(__dirname, '../My project/Assets/GFX/Characters/');
const WEB = path.join(__dirname, '../rpg-server/web/');
const OUT = WEB + 'img/pasarela/';
const SPEED = 46;          // px por segundo
let LOOP = 0;               // px por vuelta = lo que ocupan todos en fila (así no hay huecos sin nadie)
const GAP = 46;            // px entre uno y el siguiente
const SCALE = 2;           // píxeles de pantalla por píxel del juego (entero: nítido)

// right = fila de "mirando a la derecha" según el orden de filas de cada pack (NpcAnimationSetup.rowOrder)
const R_DULR = 2, R_DLRU = 2, R_DUL_R = 3;
const LIST = [
  // [id, ruta relativa, fila derecha, ppu (16 normal, 32 el dragón HD), velocidad de pasos (s por ciclo)]
  ['caballero', 'luchadores-ddproject/PNG/Caballero_negro/With_shadow/Caballero_negro_Walk_with_shadow.png', R_DLRU, 16, .75],
  ['demonio', 'craftpix-net-463118-demons-4-direction-pixel-character-sprite-pack/PNG/Demon1/With_shadow/Demon1_Walk_with_shadow.png', R_DUL_R, 16, .9],
  ['madara', 'luchadores-ddproject/PNG/Madara/With_shadow/Madara_Walk_with_shadow.png', R_DLRU, 16, .75],
  ['liche', 'craftpix-net-543463-top-down-pixel-lich-character-sprites/PNG/Lich1/With_shadow/Lich1_Walk_with_shadow.png', R_DUL_R, 16, .8],
  ['heroe', 'craftpix-net-180537-free-swordsman-1-3-level-pixel-top-down-sprite-character/PNG/Swordsman_lvl2/With_shadow/Swordsman_lvl2_Walk_with_shadow.png', R_DLRU, 16, .7],
  ['golem', 'craftpix-net-625807-golem-pixel-art-top-down-sprite-pack/PNG/Golem1/With_shadow/Golem1_Walk_with_shadow.png', R_DUL_R, 16, 1.1],
  ['akane', 'luchadores-ddproject/PNG/Akane/With_shadow/Akane_Walk_with_shadow.png', R_DLRU, 16, .75],
  ['dragon', 'dragon-hd/PNG/Drake/With_shadow/Drake_Walk_with_shadow.png', R_DUL_R, 32, .9],
  ['raiden', 'luchadores-ddproject/PNG/Raiden/With_shadow/Raiden_Walk_with_shadow.png', R_DLRU, 16, .75],
  ['beholder', 'craftpix-net-404608-beholder-monsters-top-down-pixel-art-sprites/PNG/Beholder1/With_shadow/Beholder1_Walk_with_shadow.png', R_DUL_R, 16, .8],
  ['paladin', 'luchadores-ddproject/PNG/Paladin/With_shadow/Paladin_Walk_with_shadow.png', R_DLRU, 16, .75],
  ['maga', 'craftpix-net-248938-mage-4-6-level-pixel-top-down-sprite-characters/PNG/Mage_5lvl/With_shadow/Mage_lvl5_Walk.png', R_DLRU, 16, .75],
  ['ent', 'craftpix-net-838021-top-down-pixel-ent-character-sprites/PNG/Ent1/With_shadow/Ent1_Walk_with_shadow.png', R_DUL_R, 16, 1],
  ['mazoku', 'luchadores-ddproject/PNG/Mazoku/With_shadow/Mazoku_Walk_with_shadow.png', R_DLRU, 16, .75],
  ['slime_jefe', 'craftpix-net-827305-slime-boss-pixel-art-2d-sprite-for-roguelike-games/PNG/Slime_boss1/With_shadow/Slime_boss1_Walk_with_shadow.png', R_DUL_R, 16, 1],
  ['gnoll', 'craftpix-net-393827-top-down-pixel-gnolls-character-pack/PNG/Gnoll1/With_shadow/Gnoll1_Walk_with_shadow.png', R_DUL_R, 16, .8],
  ['vampiro', 'craftpix-net-208004-free-vampire-4-direction-pixel-character-sprite-pack/PNG/Vampires1/With_shadow/Vampires1_Walk_with_shadow.png', R_DUL_R, 16, .8],
  ['ryuga', 'luchadores-ddproject/PNG/Ryuga/With_shadow/Ryuga_Walk_with_shadow.png', R_DLRU, 16, .75],
  ['orco', 'craftpix-net-363992-free-top-down-orc-game-character-pixel-art/PNG/Orc1/With_shadow/orc1_walk_with_shadow.png', R_DUL_R, 16, .8],
  ['kurena', 'luchadores-ddproject/PNG/Kurena/With_shadow/Kurena_Walk_with_shadow.png', R_DLRU, 16, .75],
  ['esqueleto', 'craftpix-net-870078-top-down-pixel-skeletons-character-sprite-pack/PNG/Skeleton1/With_shadow/Skeleton1_Walk_with_shadow.png', R_DUL_R, 16, .8],
  ['zero', 'luchadores-ddproject/PNG/Zero/With_shadow/Zero_Walk_with_shadow.png', R_DLRU, 16, .75],
  ['lagarto', 'craftpix-net-900504-lizardmen-pixel-art-character-sprite-pack/PNG/Lizardman1/With_shadow/Lizardman1_Walk_with_shadow.png', R_DUL_R, 16, .8],
  ['kaito', 'luchadores-ddproject/PNG/Kaito/With_shadow/Kaito_Walk_with_shadow.png', R_DLRU, 16, .75],
  ['fantasma', 'craftpix-net-894297-top-down-pixel-ghost-character-sprite-pack/PNG/Ghost1/With_shadow/Ghost1_Walk_with_shadow.png', R_DUL_R, 16, .8],
  ['hime', 'luchadores-ddproject/PNG/Hime/With_shadow/Hime_Walk_with_shadow.png', R_DLRU, 16, .75],
  ['diablillo', 'craftpix-net-500988-imp-mobs-pixel-art-character-sprite-pack/PNG/Imp1/With_shadow/Imp1_Walk_with_shadow.png', R_DUL_R, 16, .7],
  ['sora', 'luchadores-ddproject/PNG/Sora/With_shadow/Sora_Walk_with_shadow.png', R_DLRU, 16, .75],
  ['espadachin9', 'craftpix-net-299679-swordsman-7-9-level-pixel-top-down-sprite-character-pack/PNG/Swordsman_lvl9/With_shadow/lvl9_Walk_with_shadow.png', R_DLRU, 16, .75],
];

fs.mkdirSync(OUT, { recursive: true });
const css = [], html = [], control = [];
let cum = 0;
LIST.forEach(([id, rel, row, ppu, speed], i) => {
  const im = P.decode(G + rel);
  const cell = im.H / 4, n = Math.round(im.W / cell), y0 = row * cell;
  // contenido de la fila: columnas/filas con píxeles visibles en algún cuadro (pies = fila más baja, sombra incluida)
  let top = cell, bot = 0, left = cell, right = 0;
  for (let f = 0; f < n; f++) for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
    if (im.px[((y0 + y) * im.W + f * cell + x) * 4 + 3] > 40) { top = Math.min(top, y); bot = Math.max(bot, y); left = Math.min(left, x); right = Math.max(right, x); }
  }
  const w = right - left + 1, h = bot - top + 1;
  const out = new Uint8Array(w * n * h * 4);
  for (let f = 0; f < n; f++) for (let y = 0; y < h; y++) {
    const s = ((y0 + top + y) * im.W + f * cell + left) * 4;
    out.set(im.px.subarray(s, s + w * 4), (y * w * n + f * w) * 4);
  }
  P.encode(OUT + id + '.png', w * n, h, out);
  control.push({ id, w, h, n, out });
  const k = SCALE * 16 / ppu;                     // el dragón HD (ppu 32) se dibuja a la mitad: mismo tamaño en el mundo
  const W = w * k, H = h * k;
  const off = cum; cum += W + GAP;   // separados según su ancho (el retraso se calcula al final, con la vuelta ya medida)
  css.push(() => `.w-${id}{animation-duration:${(LOOP / SPEED).toFixed(1)}s;animation-delay:${-(off / SPEED).toFixed(2)}s}` +
    `.w-${id} .spr{width:${W}px;height:${H}px;background-image:url(img/pasarela/${id}.png);background-size:${W * n}px ${H}px;` +
    `animation:f-${id} ${speed}s steps(${n}) infinite}@keyframes f-${id}{to{background-position-x:-${W * n}px}}`);
  html.push(`    <div class="walker w-${id}"><div class="spr"></div></div>`);
  console.log(id.padEnd(11), `${n} cuadros ${w}×${h} → ${W}×${H}`);
});
// vuelta = la fila entera; como mínimo lo que hace falta para cruzar una pantalla de 1920 (si no, desaparecerían a medio camino)
LOOP = Math.max(cum, 2300);
if (cum < 2300) console.warn('Faltan ' + (2300 - cum) + ' px de personajes: habrá un hueco');
const base = '.parade .walker{left:0;bottom:12px;animation-name:pasar;animation-timing-function:linear;animation-iteration-count:infinite}' +
  '.parade .spr{image-rendering:pixelated;background-repeat:no-repeat}' +
  `@keyframes pasar{from{transform:translateX(-260px)}to{transform:translateX(${LOOP - 260}px)}}`;
fs.writeFileSync(WEB + 'pasarela.css', '/* Generado por Arte/pasarela.js: no editar a mano */\n' + base + '\n' + css.map(f => f()).join('\n') + '\n');
fs.writeFileSync(path.join(__dirname, 'pasarela_html.txt'), html.join('\n') + '\n');

if (process.argv.includes('--control')) {
  // primer cuadro de cada uno, en fila, con los pies alineados abajo
  const pad = 6, H = Math.max(...control.map(c => c.h)), W = control.reduce((a, c) => a + c.w + pad, 0);
  const px = new Uint8Array(W * H * 4).fill(60); let ox = 0;
  for (const c of control) {
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
      const s = (y * c.w * c.n + x) * 4, a = c.out[s + 3] / 255, o = ((H - c.h + y) * W + ox + x) * 4;
      for (let k = 0; k < 3; k++) px[o + k] = Math.round(c.out[s + k] * a + 60 * (1 - a)); px[o + 3] = 255;
    }
    ox += c.w + pad;
  }
  P.encode(path.join(__dirname, 'pasarela_control.png'), W, H, px);
}
