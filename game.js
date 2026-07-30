/* ============================================================
   BATTLE BUBBLE — a soap-bubble battle royale
   ============================================================ */
'use strict';

/* A phone has no console, and this file binds the DEPLOY button near the very bottom —
   so anything that throws during setup used to leave the start screen silently dead.
   Surface the error on screen instead of guessing from across the room. */
function showLoadError(msg){
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:999;'+
    'background:#7a1f1f;color:#fff;font:11px/1.5 monospace;padding:8px 10px;'+
    'white-space:pre-wrap;word-break:break-word;';
  box.textContent = 'JS ERROR — ' + msg + '\n(tap to dismiss)';
  box.addEventListener('click', ()=>box.remove());
  (document.body || document.documentElement).appendChild(box);
}
addEventListener('error', e=>{
  showLoadError((e.message || e.type) + '\n' + (e.filename||'') + ':' + (e.lineno||'?'));
});

/* ---------------- config ---------------- */
const ISLAND_R   = 100;   // island radius
const BOT_COUNT  = 9;
const DROP_H     = 85;    // drop start height
const DROP_SPEED = 9;
const MOVE_SPEED = 13.5;
const BOT_SPEED  = 8.2;
const GRAVITY    = 30;
const TRAP_TIME  = 5;     // seconds inside a bubble before it pops on its own
const PLAYER_GRACE = 35;  // bots ignore the player for this long after landing
const AMMO_PER_GUN = 12;
const GUN_COUNT  = 26;
const PROJ_SPEED = 42;
const PROJ_RISE  = 1.6;   // bubbles are buoyant — they drift up over the flight
const KICK_RANGE = 3.6;

const BOT_NAMES = ['BUBBLES','POPPER','FLOATY','SUDSY','FOAMY','GLOSSY','DRIFTER','SQUEAK','BOUNCER'];
const SHIRT_COLORS = [0xd94f4f,0x4f7ad9,0x4fd97a,0xd9c94f,0x9b4fd9,0xd9884f,0x4fd0d9,0xd94fb2,0x8ad94f];
const PANTS_COLORS = [0x2f4858,0x54494b,0x3a5a40,0x5e548e,0x774936,0x355070,0x6d597a,0x40534c,0x584b53];
const SKIN = 0xf2c25e;

/* zone phases: hold, then shrink to radius over duration */
const ZONE_PHASES = [
  {hold:40, to:75, dur:38},
  {hold:20, to:52, dur:30},
  {hold:18, to:30, dur:24},
  {hold:16, to:15, dur:20},
  {hold:14, to:5,  dur:16},
];

/* ---------------- tiny synth sfx ---------------- */
let AC = null;
function sfx(freq, dur, type, vol, slideTo){
  try{
    if(!AC) AC = new (window.AudioContext||window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type||'sine';
    o.frequency.setValueAtTime(freq, AC.currentTime);
    if(slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30,slideTo), AC.currentTime+dur);
    g.gain.setValueAtTime(vol||0.12, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime+dur);
    o.connect(g); g.connect(AC.destination);
    o.start(); o.stop(AC.currentTime+dur);
  }catch(e){}
}
const sShoot  = ()=>{ sfx(650,0.15,'sine',0.10,320); };
const sTrap   = ()=>{ sfx(300,0.35,'sine',0.12,900); };
const sPopS   = ()=>{ sfx(900,0.08,'square',0.06,300); };
const sBurst  = ()=>{ sfx(180,0.25,'square',0.14,60); sfx(1200,0.12,'sine',0.08,300); };
const sKick   = ()=>{ sfx(110,0.12,'square',0.14,70); };
const sPickup = ()=>{ sfx(520,0.08,'sine',0.10); setTimeout(()=>sfx(780,0.10,'sine',0.10),80); };
const sZone   = ()=>{ sfx(220,0.25,'sine',0.12); setTimeout(()=>sfx(220,0.25,'sine',0.12),300); };

/* ---------------- procedural music ----------------
   No audio files — the soundtrack is scheduled WebAudio, same synth as the sfx above,
   so it costs nothing to download and works with the CDN blocked. Notes are queued
   ~0.15s ahead of the clock: a frame hitch on a phone can't punch a hole in the beat.
   Four bars of Am - F - C - G; layers and tempo come in as the match heats up. */
let musicOn = true, musicStarted = false, musicGain = null, musicTimer = null;
let musicStep = 0, musicNext = 0, noiseBuf = null;

const CHORDS = [
  {root:110.00, tones:[220.00, 261.63, 329.63]}, // Am
  {root: 87.31, tones:[174.61, 220.00, 261.63]}, // F
  {root:130.81, tones:[261.63, 329.63, 392.00]}, // C
  {root: 98.00, tones:[196.00, 246.94, 293.66]}, // G
];
const MUSIC_BPM = [84, 100, 112, 126];

/* 0 menu · 1 dropping · 2 fighting · 3 endgame (small zone or few left) */
function musicIntensity(){
  if(gameState === 'drop') return 1;
  if(gameState !== 'play') return 0;
  return (zonePhaseIdx >= 3 || aliveCount() <= 3) ? 3 : 2;
}

function mtone(type, freq, t, dur, vol, opts){
  opts = opts || {};
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if(opts.slideTo) o.frequency.exponentialRampToValueAtTime(opts.slideTo, t+dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + (opts.attack || 0.008));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(musicGain);
  o.start(t); o.stop(t + dur + 0.02);
}
function mnoise(t, dur, vol, hp){
  const s = AC.createBufferSource(); s.buffer = noiseBuf;
  const f = AC.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
  const g = AC.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(musicGain);
  s.start(t); s.stop(t + dur);
}

function musicPlayStep(s, t, inten, spb){
  const ch = CHORDS[Math.floor(s/8)], beat = s % 8;
  if(beat === 0){                                   // pad, one soft swell per bar
    mtone('triangle', ch.root*2,   t, spb*8, 0.030, {attack:0.35});
    mtone('triangle', ch.tones[1], t, spb*8, 0.022, {attack:0.50});
  }
  // bubbly arpeggio — the one layer that never drops out
  mtone('sine', ch.tones[s % 3] * (beat === 2 || beat === 6 ? 2 : 1),
        t, spb*1.6, inten ? 0.075 : 0.050, {attack:0.012});
  if(inten >= 1){
    if(beat === 0 || beat === 4) mtone('sine', 120, t, 0.14, 0.50, {slideTo:45});
    if(beat === 0 || beat === 3 || beat === 6) mtone('sawtooth', ch.root, t, spb*0.9, 0.09);
  }
  if(inten >= 2){
    if(beat % 2 === 1) mnoise(t, 0.035, 0.055, 7000);
    if(beat === 4)     mnoise(t, 0.12,  0.150, 1400);
  }
  if(inten >= 3){
    if(beat === 7) mnoise(t, 0.05, 0.09, 5000);
    mtone('square', ch.tones[2]*2, t, spb*0.45, 0.016);
  }
}

function musicSchedule(){
  if(!AC || !musicOn || !musicGain) return;
  const inten = musicIntensity();
  const spb = 60 / MUSIC_BPM[inten] / 2;   // one step = an eighth note
  while(musicNext < AC.currentTime + 0.15){
    try{ musicPlayStep(musicStep, Math.max(musicNext, AC.currentTime), inten, spb); }catch(e){}
    musicNext += spb;
    musicStep = (musicStep + 1) % 32;      // 4 bars x 8 steps
  }
}

function musicStart(){
  if(musicStarted || !musicOn) return;
  try{
    if(!AC) AC = new (window.AudioContext||window.webkitAudioContext)();
    if(AC.state === 'suspended') AC.resume();
    if(!noiseBuf){
      noiseBuf = AC.createBuffer(1, Math.floor(AC.sampleRate*0.3), AC.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for(let i=0;i<d.length;i++) d[i] = Math.random()*2 - 1;
    }
    musicGain = AC.createGain();
    musicGain.gain.value = 0.30;
    musicGain.connect(AC.destination);
    musicStep = 0;
    musicNext = AC.currentTime + 0.10;
    musicTimer = setInterval(musicSchedule, 25);
    musicStarted = true;
  }catch(e){}
}
function musicStop(){
  clearInterval(musicTimer); musicTimer = null;
  musicStarted = false;
  const g = musicGain;
  musicGain = null;                       // scheduler bails out immediately
  if(g && AC){
    try{
      g.gain.setTargetAtTime(0.0001, AC.currentTime, 0.15);
      setTimeout(()=>{ try{ g.disconnect(); }catch(e){} }, 900);
    }catch(e){}
  }
}
function toggleMusic(){
  musicOn = !musicOn;
  if(musicOn) musicStart(); else musicStop();
  const b = el('musicToggle');
  if(b){
    b.textContent = musicOn ? '♪ MUSIC ON' : '♪ MUSIC OFF';
    b.classList.toggle('off', !musicOn);
  }
}
/* browsers won't let audio start before a gesture — latch onto the first one */
['pointerdown','touchstart','keydown'].forEach(ev=>
  addEventListener(ev, ()=>musicStart(), {once:true}));

/* ---------------- three.js setup ---------------- */
/* ?touch=1 forces the mobile control layout on a desktop, for checking the HUD */
const IS_TOUCH = ('ontouchstart' in window) || navigator.maxTouchPoints > 0
  || /[?&]touch=1/.test(location.search);

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({canvas, antialias:true});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, IS_TOUCH ? 1.5 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87c8eb);
scene.fog = new THREE.Fog(0x87c8eb, 120, 420);

const camera = new THREE.PerspectiveCamera(65, innerWidth/innerHeight, 0.1, 800);

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const sun = new THREE.DirectionalLight(0xfff2d9, 1.0);
sun.position.set(80, 140, 60);
sun.castShadow = true;
sun.shadow.mapSize.set(IS_TOUCH ? 1024 : 2048, IS_TOUCH ? 1024 : 2048);
const sc = sun.shadow.camera;
sc.left = -130; sc.right = 130; sc.top = 130; sc.bottom = -130; sc.far = 400;
scene.add(sun);

addEventListener('resize', ()=>{
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ---------------- island ---------------- */
const obstacles = []; // {x, z, r} for simple push-out collision

function buildIsland(){
  // water
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(600, 48),
    new THREE.MeshLambertMaterial({color:0x2a7fbe})
  );
  water.rotation.x = -Math.PI/2;
  water.position.y = -1.4;
  scene.add(water);

  // sand base
  const sand = new THREE.Mesh(
    new THREE.CylinderGeometry(ISLAND_R, ISLAND_R+8, 2.5, 64),
    new THREE.MeshLambertMaterial({color:0xdfc98a})
  );
  sand.position.y = -1.25;
  sand.receiveShadow = true;
  scene.add(sand);

  // grass top
  const grass = new THREE.Mesh(
    new THREE.CircleGeometry(ISLAND_R-9, 64),
    new THREE.MeshLambertMaterial({color:0x74b04a})
  );
  grass.rotation.x = -Math.PI/2;
  grass.position.y = 0.02;
  grass.receiveShadow = true;
  scene.add(grass);

  // trees
  const trunkMat = new THREE.MeshLambertMaterial({color:0x7a5230});
  const leafMats = [0x4d8a3d, 0x5da24a, 0x3f7a34].map(c=>new THREE.MeshLambertMaterial({color:c}));
  for(let i=0;i<26;i++){
    const a = Math.random()*Math.PI*2;
    const d = 12 + Math.random()*(ISLAND_R-26);
    const x = Math.cos(a)*d, z = Math.sin(a)*d;
    const h = 4+Math.random()*3;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.45,0.6,h,8), trunkMat);
    trunk.position.set(x, h/2, z);
    trunk.castShadow = true;
    scene.add(trunk);
    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(2.2+Math.random()*1.2, 10, 8),
      leafMats[i%3]
    );
    leaf.position.set(x, h+1.2, z);
    leaf.scale.y = 0.85;
    leaf.castShadow = true;
    scene.add(leaf);
    obstacles.push({x, z, r:1.1, h:h+3});
  }

  // rocks
  const rockMat = new THREE.MeshLambertMaterial({color:0x8d8d86});
  for(let i=0;i<14;i++){
    const a = Math.random()*Math.PI*2;
    const d = 8 + Math.random()*(ISLAND_R-20);
    const s = 1+Math.random()*1.8;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s,0), rockMat);
    rock.position.set(Math.cos(a)*d, s*0.5, Math.sin(a)*d);
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    rock.castShadow = true;
    scene.add(rock);
    obstacles.push({x:rock.position.x, z:rock.position.z, r:s*0.9, h:s*1.5});
  }

  // clouds
  const cloudMat = new THREE.MeshLambertMaterial({color:0xffffff});
  for(let i=0;i<10;i++){
    const g = new THREE.Group();
    for(let j=0;j<3;j++){
      const puff = new THREE.Mesh(new THREE.SphereGeometry(5+Math.random()*4, 8, 6), cloudMat);
      puff.position.set(j*6-6, Math.random()*2, Math.random()*3);
      puff.scale.y = 0.5;
      g.add(puff);
    }
    const a = Math.random()*Math.PI*2, d = 60+Math.random()*180;
    g.position.set(Math.cos(a)*d, 55+Math.random()*35, Math.sin(a)*d);
    scene.add(g);
  }
}
buildIsland();

/* ---------------- character factory (Roblox-style blocky) ---------------- */
function makeFaceTexture(){
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  c.fillStyle = '#'+SKIN.toString(16);
  c.fillRect(0,0,128,128);
  c.fillStyle = '#1a1a1a';
  // eyes
  c.beginPath(); c.ellipse(42,52,8,12,0,0,Math.PI*2); c.fill();
  c.beginPath(); c.ellipse(86,52,8,12,0,0,Math.PI*2); c.fill();
  // smile
  c.strokeStyle = '#1a1a1a'; c.lineWidth = 6; c.lineCap = 'round';
  c.beginPath(); c.arc(64,74,20,Math.PI*0.15,Math.PI*0.85); c.stroke();
  const t = new THREE.CanvasTexture(cv);
  return t;
}
const faceTex = makeFaceTexture();

function makeGunModel(){
  const g = new THREE.Group();
  const dark = new THREE.MeshLambertMaterial({color:0x35506b});
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.28,0.34,1.0), dark);
  g.add(body);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.12,0.7,8), dark);
  barrel.rotation.x = Math.PI/2;
  barrel.position.set(0,0.06,0.8);
  g.add(barrel);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.22,0.4,0.24), dark);
  grip.position.set(0,-0.32,-0.28);
  grip.rotation.x = 0.3;
  g.add(grip);
  const tank = new THREE.Mesh(
    new THREE.SphereGeometry(0.24,10,8),
    new THREE.MeshPhongMaterial({color:0x9fd8ff, transparent:true, opacity:0.55, shininess:100})
  );
  tank.position.set(0,0.32,0.1);
  g.add(tank);
  return g;
}

function makeCharacter(shirt, pants){
  const g = new THREE.Group();
  const skinMat  = new THREE.MeshLambertMaterial({color:SKIN});
  const shirtMat = new THREE.MeshLambertMaterial({color:shirt});
  const pantsMat = new THREE.MeshLambertMaterial({color:pants});
  const faceMat  = new THREE.MeshLambertMaterial({map:faceTex});

  // legs (pivot at hip)
  function leg(x){
    const geo = new THREE.BoxGeometry(0.45,1.2,0.45);
    geo.translate(0,-0.6,0);
    const m = new THREE.Mesh(geo, pantsMat);
    m.position.set(x,1.2,0);
    m.castShadow = true;
    g.add(m);
    return m;
  }
  const lLeg = leg(-0.27), rLeg = leg(0.27);

  // torso
  const torso = new THREE.Mesh(new THREE.BoxGeometry(1.05,1.2,0.55), shirtMat);
  torso.position.y = 1.8;
  torso.castShadow = true;
  g.add(torso);

  // arms (pivot at shoulder)
  function arm(x){
    const geo = new THREE.BoxGeometry(0.4,1.2,0.4);
    geo.translate(0,-0.5,0);
    const m = new THREE.Mesh(geo, skinMat);
    m.position.set(x,2.3,0);
    m.castShadow = true;
    g.add(m);
    return m;
  }
  const lArm = arm(-0.75), rArm = arm(0.75);

  // head (face on +z)
  const headMats = [skinMat,skinMat,skinMat,skinMat,faceMat,skinMat];
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.8,0.8,0.8), headMats);
  head.position.y = 2.85;
  head.castShadow = true;
  g.add(head);

  // blob shadow helper (small dark disc; real shadows also on)
  scene.add(g);
  return {group:g, parts:{lLeg,rLeg,torso,lArm,rArm,head}};
}

/* ---------------- bubble materials ---------------- */
function makeBubbleMesh(radius, hue){
  const color = new THREE.Color().setHSL(hue!==undefined?hue:0.55, 0.6, 0.75);
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 24, 18),
    new THREE.MeshPhongMaterial({
      color, transparent:true, opacity:0.28,
      shininess:140, specular:0xffffff, depthWrite:false
    })
  );
  return m;
}

/* ---------------- game state ---------------- */
let gameState = 'menu';   // menu | drop | play | end
let gameTime = 0;
let zoneStarted = false;

const chars = [];         // [0] is the player
const guns = [];          // pickups
const projectiles = [];
const particles = [];
const flashes = [];      // muzzle-flash rings
let camKick = 0;         // recoil kick on the player camera
const UP = new THREE.Vector3(0,1,0);

/* zone */
let zoneRadius = ISLAND_R + 8;
let zonePhaseIdx = 0;
let zoneTimer = 0;
let zoneShrinking = false;
let zoneFrom = zoneRadius;
/* zone wall texture: bright vertical bars, solid at the base, fading upward */
function makeZoneTexture(){
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 256;
  const c = cv.getContext('2d');
  const grad = c.createLinearGradient(0,256,0,0);
  grad.addColorStop(0.00,'rgba(255,60,160,1.00)');
  grad.addColorStop(0.25,'rgba(255,60,160,0.70)');
  grad.addColorStop(0.65,'rgba(255,110,190,0.30)');
  grad.addColorStop(1.00,'rgba(255,150,210,0.05)');
  c.fillStyle = grad;
  c.fillRect(0,0,64,256);
  // brighter bar every other stripe
  c.globalCompositeOperation = 'lighter';
  c.fillStyle = 'rgba(255,255,255,0.35)';
  c.fillRect(0,0,22,256);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const zoneTex = makeZoneTexture();
const zoneWall = new THREE.Mesh(
  new THREE.CylinderGeometry(1, 1, 90, 64, 1, true),
  new THREE.MeshBasicMaterial({map:zoneTex, color:0xffffff, transparent:true,
    opacity:0.85, side:THREE.DoubleSide, depthWrite:false})
);
zoneWall.position.y = 45;
zoneWall.scale.set(zoneRadius, 1, zoneRadius);
scene.add(zoneWall);

/* solid ring painted on the ground so the edge is unmistakable */
const zoneRing = new THREE.Mesh(
  new THREE.RingGeometry(0.965, 1.0, 96),
  new THREE.MeshBasicMaterial({color:0xff3ca0, transparent:true, opacity:0.95,
    side:THREE.DoubleSide, depthWrite:false})
);
zoneRing.rotation.x = -Math.PI/2;
zoneRing.position.y = 0.12;
zoneRing.scale.set(zoneRadius, zoneRadius, 1);
scene.add(zoneRing);

/* ---------------- create fighters ---------------- */
function spawnChar(isPlayer, idx){
  const shirt = isPlayer ? 0xD97757 : SHIRT_COLORS[idx % SHIRT_COLORS.length];
  const pants = isPlayer ? 0x35506b : PANTS_COLORS[idx % PANTS_COLORS.length];
  const {group, parts} = makeCharacter(shirt, pants);

  const a = Math.random()*Math.PI*2;
  const d = isPlayer ? 20+Math.random()*30 : Math.random()*70;
  group.position.set(Math.cos(a)*d, DROP_H + Math.random()*14, Math.sin(a)*d);

  const dropBubble = makeBubbleMesh(2.6, 0.55+Math.random()*0.1);
  scene.add(dropBubble);

  const ch = {
    name: isPlayer ? 'YOU' : BOT_NAMES[idx % BOT_NAMES.length],
    isPlayer, group, parts,
    alive: true, dying: 0,
    vel: new THREE.Vector3(),
    yaw: Math.random()*Math.PI*2,
    landed: false, dropBubble,
    trapped: false, bubble: null, trapTimer: 0,
    trapDrift: new THREE.Vector3(), lastStruggle: -99,
    invuln: 0,
    ammo: 0, gunMesh: null,
    shootCd: 0, kickCd: 0, kickAnim: 0, recoil: 0, crouch: 0,
    walk: 0, moving: false,
    poseLegL: 0, poseLegR: 0, poseArmL: 0, poseArmR: 0,
    kills: 0,
    brain: {mode:'wander', wx:0, wz:0, dirTimer:0, think:Math.random()*0.5, targetGun:null}
  };
  chars.push(ch);
  return ch;
}

function giveGunModel(ch){
  if(ch.gunMesh) return;
  const gm = makeGunModel();
  gm.position.set(0, -1.05, 0.35);
  ch.parts.rArm.add(gm);
  ch.gunMesh = gm;
  ch.parts.rArm.rotation.x = -0.5;
}

/* ---------------- gun pickups ---------------- */
function spawnGuns(){
  for(let i=0;i<GUN_COUNT;i++){
    const a = Math.random()*Math.PI*2;
    const d = 6 + Math.random()*(ISLAND_R-18);
    const holder = new THREE.Group();
    const model = makeGunModel();
    model.scale.setScalar(1.5);
    model.rotation.z = 0.2;
    holder.add(model);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.3, 0.07, 8, 32),
      new THREE.MeshBasicMaterial({color:0xD97757, transparent:true, opacity:0.7})
    );
    ring.rotation.x = Math.PI/2;
    ring.position.y = -0.9;
    holder.add(ring);
    holder.position.set(Math.cos(a)*d, 1.4, Math.sin(a)*d);
    scene.add(holder);
    guns.push({mesh:holder, taken:false, x:holder.position.x, z:holder.position.z});
  }
}

/* ---------------- particles ---------------- */
function burst(pos, color, count, speed, size){
  for(let i=0;i<count;i++){
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(size||0.18, 6, 5),
      new THREE.MeshBasicMaterial({color:color||0xbfe8ff, transparent:true, opacity:0.9})
    );
    m.position.copy(pos);
    scene.add(m);
    const v = new THREE.Vector3(
      (Math.random()-0.5)*2, (Math.random()-0.3)*2, (Math.random()-0.5)*2
    ).normalize().multiplyScalar((speed||8)*(0.4+Math.random()*0.8));
    particles.push({mesh:m, vel:v, life:0.6+Math.random()*0.3, maxLife:0.9});
  }
}

/* ---------------- HUD helpers ---------------- */
const el = id => document.getElementById(id);
const hud = el('hud'), msgEl = el('message');
let msgTimer = null;
function showMessage(html, dur){
  msgEl.innerHTML = html;
  msgEl.classList.add('show');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(()=>msgEl.classList.remove('show'), dur||2500);
}
function addFeed(html){
  const d = document.createElement('div');
  d.className = 'feed';
  d.innerHTML = html;
  const feed = el('killfeed');
  feed.prepend(d);
  while(feed.children.length > 5) feed.lastChild.remove();
  setTimeout(()=>{ if(d.parentNode) d.remove(); }, 7000);
}
function aliveCount(){ return chars.filter(c=>c.alive).length; }
function updateAliveHud(){
  el('aliveCount').innerHTML = 'ALIVE <b>'+aliveCount()+'</b> / '+chars.length;
}
function updateAmmoHud(){
  const p = chars[0], v = el('ammoVal');
  if(p.ammo > 0){
    v.textContent = '● '.repeat(Math.min(p.ammo,10)).trim() + '  ('+p.ammo+')';
    v.className = 'val';
  }else{
    v.textContent = 'UNARMED — FIND A GUN';
    v.className = 'val none';
  }
}

/* ---------------- trap / release / eliminate ---------------- */
function trapChar(ch, byName){
  if(!ch.alive || ch.trapped || ch.invuln > 0 || !ch.landed) return false;
  ch.trapped = true;
  ch.trapTimer = TRAP_TIME;
  ch.bubble = makeBubbleMesh(2.3, 0.5 + Math.random()*0.35);
  ch.bubble.position.copy(ch.group.position).y += 1.6;
  scene.add(ch.bubble);
  ch.trapDrift.set((Math.random()-0.5)*2, 0, (Math.random()-0.5)*2);
  ch.vel.set(0,0,0);
  sTrap();
  addFeed('<b>'+byName+'</b> bubbled <b>'+ch.name+'</b>');
  if(ch.isPlayer){
    showMessage('<span class="mark">YOU ARE TRAPPED!</span> '+(IS_TOUCH?'TAP THE SCREEN!':'MASH SPACE!'), 3000);
    el('struggleBox').classList.add('show');
  }
  return true;
}

function releaseChar(ch){
  if(!ch.trapped) return;
  ch.trapped = false;
  if(ch.bubble){
    burst(ch.bubble.position, 0xbfe8ff, 12, 6);
    scene.remove(ch.bubble);
    ch.bubble = null;
  }
  sPopS();
  ch.invuln = ch.isPlayer ? 4 : 2.5;
  ch.vel.set(0, -2, 0);
  if(ch.isPlayer){
    el('struggleBox').classList.remove('show');
    showMessage('BUBBLE POPPED — YOU\'RE FREE!', 2000);
  }
}

function eliminate(ch, byName){
  if(!ch.alive) return;
  const pos = ch.bubble ? ch.bubble.position.clone() : ch.group.position.clone().setY(ch.group.position.y+1.6);
  if(ch.bubble){ scene.remove(ch.bubble); ch.bubble = null; }
  ch.trapped = false;
  ch.alive = false;
  ch.dying = 0.7;
  burst(pos, 0xbfe8ff, 22, 12, 0.22);
  burst(pos, 0xD97757, 10, 9, 0.15);
  sBurst();
  addFeed('<b>'+byName+'</b> popped <b>'+ch.name+'</b> ✕');
  updateAliveHud();
  if(ch.isPlayer){
    el('struggleBox').classList.remove('show');
    endGame(false, byName);
  }else{
    checkWin();
  }
}

function checkWin(){
  if(gameState !== 'drop' && gameState !== 'play') return;
  const alive = chars.filter(c=>c.alive);
  if(alive.length === 1 && alive[0].isPlayer) endGame(true, null);
}

/* ---------------- shooting / kicking ---------------- */
function shoot(ch, dir, aimPoint){
  if(ch.ammo <= 0 || ch.shootCd > 0 || ch.trapped || !ch.landed) return;
  ch.ammo--;
  ch.shootCd = 0.55;
  // muzzle sits at the gun, slightly right of centre
  const right = new THREE.Vector3(dir.z, 0, -dir.x).normalize();
  const origin = ch.group.position.clone()
    .add(new THREE.Vector3(0, 2.3 - 0.9*(ch.crouch||0), 0))
    .addScaledVector(right, 0.5);
  // aim at the crosshair, not along the camera's downward tilt
  if(aimPoint) dir = aimPoint.clone().sub(origin).normalize();
  origin.addScaledVector(dir, 1.2);

  // the bubble itself — big, bright, with a glowing core and a comet tail
  const grp = new THREE.Group();
  const shell = makeBubbleMesh(0.95, 0.55);
  shell.material.opacity = 0.9;
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 12, 10),
    new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:0.8,
      blending:THREE.AdditiveBlending, depthWrite:false})
  );
  const tail = new THREE.Mesh(
    new THREE.ConeGeometry(0.7, 4.5, 12, 1, true),
    new THREE.MeshBasicMaterial({color:0x9fe4ff, transparent:true, opacity:0.5,
      side:THREE.DoubleSide, blending:THREE.AdditiveBlending, depthWrite:false})
  );
  grp.add(shell, core, tail);
  grp.position.copy(origin);
  scene.add(grp);
  projectiles.push({mesh:grp, shell, tail, vel:dir.clone().multiplyScalar(PROJ_SPEED),
    owner:ch, life:3.4, trailCd:0});

  // muzzle flash: a ring that expands and a puff of foam
  const flash = new THREE.Mesh(
    new THREE.RingGeometry(0.25, 0.55, 16),
    new THREE.MeshBasicMaterial({color:0xbfe8ff, transparent:true, opacity:0.9,
      side:THREE.DoubleSide, depthWrite:false})
  );
  flash.position.copy(origin);
  flash.lookAt(origin.clone().add(dir));
  scene.add(flash);
  flashes.push({mesh:flash, life:0.18, maxLife:0.18});
  burst(origin, 0xdff4ff, 7, 5, 0.11);

  // kick the arm back, and the camera too if it's the player
  ch.recoil = 1;
  sShoot();
  if(ch.isPlayer){
    camKick = 0.055;
    updateAmmoHud();
  }
}

function tryKick(kicker){
  if(kicker.kickCd > 0 || kicker.trapped || !kicker.landed) return false;
  kicker.kickCd = 0.7;
  kicker.kickAnim = 0.35;
  sKick();
  for(const t of chars){
    if(t === kicker || !t.alive || !t.trapped || !t.bubble) continue;
    const d = kicker.group.position.distanceTo(t.bubble.position);
    if(d < KICK_RANGE + 2.3 && t.bubble.position.y < 7.5){
      // struggling target may dodge the kick
      const dodgeChance = t.isPlayer ? 0.9 : 0.4;
      if(gameTime - t.lastStruggle < 0.7 && Math.random() < dodgeChance){
        burst(t.bubble.position, 0xffffff, 5, 4, 0.12);
        t.trapDrift.set((Math.random()-0.5)*6, 0, (Math.random()-0.5)*6);
        if(t.isPlayer) showMessage('DODGED THE KICK!', 1200);
        if(kicker.isPlayer) showMessage(t.name+' WRIGGLED AWAY!', 1200);
        return false;
      }
      kicker.kills++;
      eliminate(t, kicker.name);
      if(kicker.isPlayer) showMessage('<span class="mark">POP!</span> '+t.name+' ELIMINATED', 2200);
      return true;
    }
  }
  return false;
}

/* ---------------- player input ---------------- */
const keys = {};
let pointerLocked = false;
let camYaw = 0, camPitch = 0.25;
/* positive pitch looks down. the old range bottomed out at -0.15 and updateCamera
   then floored it at 0.05 anyway, so the whole upward half was dead — scoping felt
   like the vertical axis was broken. one clamp now, wide enough to aim uphill. */
const PITCH_MIN = -0.60, PITCH_MAX = 1.00;
/* scoping slows the aim, but not to a crawl — at full zoom this is 0.55, not 0.31 */
function aimSens(){ return 0.35 + 0.65*(camera.fov/BASE_FOV); }
function addLook(dYaw, dPitch){
  const s = aimSens();
  camYaw += dYaw*s;
  camPitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, camPitch + dPitch*s));
}

function doStruggle(p){
  // shorten trap, jitter the bubble, enable dodge window
  p.trapTimer = Math.max(0.2, p.trapTimer - 0.4);
  p.lastStruggle = gameTime;
  if(p.bubble){
    p.trapDrift.x += (Math.random()-0.5)*4;
    p.trapDrift.z += (Math.random()-0.5)*4;
    p.bubble.position.y += 0.15;
  }
  sfx(400+Math.random()*200, 0.05, 'sine', 0.05);
}
function playerJumpOrStruggle(){
  const p = chars[0];
  if(!p || !p.alive) return;
  if(p.trapped) doStruggle(p);
  else if(p.landed && p.group.position.y <= 0.01) p.vel.y = 12.5;
}
/* What the crosshair is actually sitting on.

   The old version aimed at a fixed 160m along the view ray. That ray slopes
   downward, so the point was tens of metres underground and every shot dived into
   the dirt a few metres out — the crosshair and the bubble disagreed. Now the ray
   is intersected with the world and the muzzle is aimed at the *hit*, so what the
   crosshair covers is what gets hit, at any range. */
/* AIM_MIN keeps the aim point in front of the player: the third-person camera sits
   ~9.5m behind him, so a steep look-down can meet the ground behind his heels. */
const AIM_FAR = 220, AIM_MIN = 13;
function crosshairAim(){
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const eye = camera.position;

  // how far the ray travels before it meets the ground
  let dist = AIM_FAR;
  if(dir.y < -1e-4){
    const tg = -eye.y / dir.y;
    if(tg > 1) dist = Math.min(dist, tg);
  }

  // an enemy under the crosshair wins over the ground behind them. the tolerance
  // is a touch wider than the hitbox: thumbs on glass are not mice.
  let best = null, bestAlong = Infinity;
  for(const c of chars){
    if(c.isPlayer || !c.alive || !c.landed) continue;
    const centre = (c.trapped && c.bubble ? c.bubble.position : c.group.position)
      .clone();
    if(!c.trapped) centre.y += 1.7 - 0.85*(c.crouch || 0);
    const to = centre.clone().sub(eye);
    const along = to.dot(dir);
    if(along < 3 || along > dist + 2 || along > bestAlong) continue;
    const miss = centre.distanceTo(eye.clone().addScaledVector(dir, along));
    if(miss < 1.4 + along*0.014){ best = centre; bestAlong = along; }
  }

  const point = best || eye.clone().addScaledVector(dir, Math.max(dist, AIM_MIN));

  // A bubble floats upward on the way there, so aiming straight at the crosshair
  // sails over anything far away — at 80m it clears a standing target by ~2.8m.
  // Aim low by exactly the rise the flight will undo.
  const flight = point.distanceTo(chars[0].group.position) / PROJ_SPEED;
  point.y = Math.max(0.2, point.y - 0.5*PROJ_RISE*flight*flight);
  return {dir, point};
}
function fireOnce(){
  const p = chars[0];
  if(!p || !p.alive || p.trapped) return;
  if(p.ammo > 0){
    const a = crosshairAim();
    shoot(p, a.dir, a.point);
  }else if(p.landed){
    showMessage('NO AMMO — FIND A BUBBLE GUN', 1500);
  }
}

addEventListener('keydown', e=>{
  keys[e.code] = true;
  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter','Space'].includes(e.code)) e.preventDefault();
  if(e.code === 'KeyM') toggleMusic();   // works on any screen, not just in a match
  if(gameState !== 'play' && gameState !== 'drop') return;
  const p = chars[0];
  if(e.code === 'Space'){
    e.preventDefault();
    playerJumpOrStruggle();
  }
  if((e.code === 'KeyF' || e.code === 'KeyE') && p.alive && !p.trapped){
    tryKick(p);
  }
  if(e.code === 'Enter' && p.alive && !p.trapped && p.landed && p.ammo <= 0){
    showMessage('NO AMMO — FIND A BUBBLE GUN', 1500);
  }
});
addEventListener('keyup', e=>{ keys[e.code] = false; });

/* keyboard-only controls: arrows rotate camera, Enter fires (hold to auto-fire) */
function updateKeyboardControls(dt){
  if(keys['ArrowLeft'])  addLook( 2.6*dt, 0);
  if(keys['ArrowRight']) addLook(-2.6*dt, 0);
  if(keys['ArrowUp'])    addLook(0, -1.6*dt);
  if(keys['ArrowDown'])  addLook(0,  1.6*dt);

  if(keys['Enter'] || touchFire){
    const p = chars[0];
    if(p.alive && !p.trapped && p.ammo > 0 && p.shootCd <= 0){
      const a = crosshairAim();
      shoot(p, a.dir, a.point);
    }
  }
}

canvas.addEventListener('click', ()=>{
  if(IS_TOUCH) return; // touch devices use on-screen buttons
  if(gameState !== 'play' && gameState !== 'drop') return;
  if(!pointerLocked){ canvas.requestPointerLock(); return; }
  const p = chars[0];
  if(p.alive && !p.trapped && p.ammo > 0){
    const a = crosshairAim();
    shoot(p, a.dir, a.point);
  }else if(p.alive && !p.trapped && p.ammo <= 0 && p.landed){
    showMessage('NO AMMO — FIND A BUBBLE GUN', 1500);
  }
});
document.addEventListener('pointerlockchange', ()=>{
  pointerLocked = document.pointerLockElement === canvas;
});

/* scope zoom: hold right mouse button or Shift */
let zoomHeld = false;
const BASE_FOV = 65, ZOOM_FOV = 20;
canvas.addEventListener('contextmenu', e=>e.preventDefault());
addEventListener('mousedown', e=>{ if(e.button === 2) zoomHeld = true; });
addEventListener('mouseup',   e=>{ if(e.button === 2) zoomHeld = false; });
function isZooming(){ return zoomHeld || touchZoom || keys['ShiftLeft'] || keys['ShiftRight']; }
function updateZoom(dt){
  const target = isZooming() ? ZOOM_FOV : BASE_FOV;
  camera.fov += (target - camera.fov)*Math.min(1, dt*12);
  camera.updateProjectionMatrix();
  el('crosshair').classList.toggle('scope', isZooming());
}

addEventListener('mousemove', e=>{
  if(!pointerLocked) return;
  addLook(-e.movementX * 0.0028, e.movementY * 0.0022);
});

/* ---------------- touch controls ---------------- */
const touchMove = {x:0, y:0};   // virtual joystick vector (y = forward)
let touchFire = false, touchZoom = false, touchCrouch = false;

// `try` so a missing control element can never leave the DEPLOY button unbound
if(IS_TOUCH) try{
  // touch-friendly instruction text
  el('struggleTxt').textContent = 'TRAPPED! TAP THE SCREEN TO STRUGGLE!';
  el('controlsBox').innerHTML =
    '<div><span class="k">JOYSTICK</span> move (steer while dropping)</div>'+
    '<div><span class="k">DRAG SCREEN</span> look around</div>'+
    '<div><span class="k">FIRE</span> hold to auto-fire the bubble gun</div>'+
    '<div><span class="k">SCOPE</span> hold to zoom — snipe far enemies</div>'+
    '<div><span class="k">KNEEL</span> tap to kneel — bubbles fly overhead!</div>'+
    '<div><span class="k">KICK</span> pop a trapped enemy up close</div>'+
    '<div><span class="k">JUMP / TAP</span> jump — tap fast to struggle when trapped</div>'+
    '<div><span class="k">COVER</span> trees &amp; rocks block bubbles — hide!</div>'+
    '<div><span class="k">&#9834; MUSIC</span> tap it in the top-left panel to mute</div>';

  const joyBase = el('joyBase'), joyKnob = el('joyKnob');
  let joyId = null;

  function joyUpdate(t){
    const r = joyBase.getBoundingClientRect();
    const cx = r.left + r.width/2, cy = r.top + r.height/2;
    let dx = t.clientX - cx, dy = t.clientY - cy;
    const max = r.width/2;
    const len = Math.hypot(dx, dy);
    if(len > max){ dx *= max/len; dy *= max/len; }
    touchMove.x = dx/max;
    touchMove.y = -dy/max;
    joyKnob.style.transform = 'translate('+dx+'px,'+dy+'px)';
  }
  function joyReset(){
    joyId = null;
    touchMove.x = 0; touchMove.y = 0;
    joyKnob.style.transform = '';
  }
  joyBase.addEventListener('touchstart', e=>{
    e.preventDefault();
    const t = e.changedTouches[0];
    joyId = t.identifier;
    joyUpdate(t);
  }, {passive:false});
  joyBase.addEventListener('touchmove', e=>{
    e.preventDefault();
    for(const t of e.changedTouches) if(t.identifier === joyId) joyUpdate(t);
  }, {passive:false});
  joyBase.addEventListener('touchend', e=>{
    for(const t of e.changedTouches) if(t.identifier === joyId) joyReset();
  });
  joyBase.addEventListener('touchcancel', joyReset);

  /* look: drag anywhere on the game canvas; tap also = struggle when trapped */
  let lookId = null, lookLast = null;
  canvas.addEventListener('touchstart', e=>{
    e.preventDefault();
    if(gameState !== 'play' && gameState !== 'drop') return;
    const p = chars[0];
    if(p && p.alive && p.trapped) doStruggle(p); // mash the screen!
    if(lookId === null){
      const t = e.changedTouches[0];
      lookId = t.identifier;
      lookLast = {x:t.clientX, y:t.clientY};
    }
  }, {passive:false});
  canvas.addEventListener('touchmove', e=>{
    e.preventDefault();
    for(const t of e.changedTouches){
      if(t.identifier !== lookId || !lookLast) continue;
      // vertical drag is a shorter travel than horizontal on a phone — match the feel
      addLook(-(t.clientX - lookLast.x) * 0.006, (t.clientY - lookLast.y) * 0.0062);
      lookLast = {x:t.clientX, y:t.clientY};
    }
  }, {passive:false});
  const lookEnd = e=>{
    for(const t of e.changedTouches) if(t.identifier === lookId){ lookId = null; lookLast = null; }
  };
  canvas.addEventListener('touchend', lookEnd);
  canvas.addEventListener('touchcancel', lookEnd);

  /* buttons */
  function bindBtn(id, down, up){
    const b = el(id);
    b.addEventListener('touchstart', e=>{ e.preventDefault(); down(); }, {passive:false});
    if(up){
      b.addEventListener('touchend', e=>{ e.preventDefault(); up(); }, {passive:false});
      b.addEventListener('touchcancel', up);
    }
  }
  bindBtn('btnFire',  ()=>{ touchFire = true; fireOnce(); }, ()=>{ touchFire = false; });
  bindBtn('btnScope', ()=>{ touchZoom = true; }, ()=>{ touchZoom = false; });
  bindBtn('btnJump',  ()=>{ playerJumpOrStruggle(); });
  bindBtn('btnKick',  ()=>{
    const p = chars[0];
    if(p && p.alive && !p.trapped) tryKick(p);
  });
  // crouch is a toggle on touch — no spare thumb to hold it
  el('btnCrouch').addEventListener('touchstart', e=>{
    e.preventDefault();
    touchCrouch = !touchCrouch;
    el('btnCrouch').classList.toggle('on', touchCrouch);
  }, {passive:false});
}catch(err){
  showLoadError('touch controls failed to init: ' + (err && err.message));
}

/* ---------------- movement helpers ---------------- */
function moveVector(yaw){
  const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const v = new THREE.Vector3();
  if(keys['KeyW']) v.add(f);
  if(keys['KeyS']) v.sub(f);
  if(keys['KeyD']) v.add(r);
  if(keys['KeyA']) v.sub(r);
  // virtual joystick (analog)
  v.addScaledVector(f, touchMove.y).addScaledVector(r, touchMove.x);
  if(v.lengthSq() > 1) v.normalize();
  return v;
}

function collideObstacles(pos){
  for(const o of obstacles){
    const dx = pos.x - o.x, dz = pos.z - o.z;
    const d2 = dx*dx + dz*dz, min = o.r + 0.6;
    if(d2 < min*min && d2 > 0.0001){
      const d = Math.sqrt(d2);
      pos.x = o.x + dx/d*min;
      pos.z = o.z + dz/d*min;
    }
  }
  const rd = Math.hypot(pos.x, pos.z);
  if(rd > ISLAND_R - 1.5){
    pos.x *= (ISLAND_R-1.5)/rd;
    pos.z *= (ISLAND_R-1.5)/rd;
  }
}

/* ---------------- bot AI ---------------- */
function nearestFreeGun(ch){
  let best = null, bd = 1e9;
  for(const g of guns){
    if(g.taken) continue;
    const d = (g.x-ch.group.position.x)**2 + (g.z-ch.group.position.z)**2;
    if(d < bd){ bd = d; best = g; }
  }
  return best;
}
function nearestEnemy(ch, wantTrapped){
  let best = null, bd = 1e9;
  for(const t of chars){
    if(t === ch || !t.alive || !t.landed) continue;
    if(wantTrapped !== t.trapped) continue;
    // grace period: bots busy themselves with each other first
    if(t.isPlayer && gameTime < PLAYER_GRACE) continue;
    const d = ch.group.position.distanceToSquared(t.group.position);
    if(d < bd){ bd = d; best = t; }
  }
  return best;
}

function botUpdate(ch, dt){
  const b = ch.brain, pos = ch.group.position;

  if(ch.trapped){
    // bots also struggle a bit
    if(Math.random() < dt*2.2){
      ch.trapTimer = Math.max(0.2, ch.trapTimer - 0.2);
      ch.lastStruggle = gameTime;
    }
    return;
  }
  if(!ch.landed) return;

  b.think -= dt;
  if(b.think <= 0){
    b.think = 0.4 + Math.random()*0.3;

    const distC = Math.hypot(pos.x, pos.z);
    const trappedFoe = nearestEnemy(ch, true);
    const freeFoe = nearestEnemy(ch, false);

    if(zoneStarted && distC > zoneRadius*0.82){
      b.mode = 'zone';
    }else if(trappedFoe && pos.distanceTo(trappedFoe.group.position) < 12){
      b.mode = 'kick'; b.target = trappedFoe;
    }else if(ch.ammo <= 0){
      b.targetGun = nearestFreeGun(ch);
      b.mode = b.targetGun ? 'gun' : 'wander';
    }else if(freeFoe && pos.distanceTo(freeFoe.group.position) < 26){
      b.mode = 'hunt'; b.target = freeFoe;
    }else{
      b.mode = 'wander';
    }
  }

  let mx = 0, mz = 0, speed = BOT_SPEED;

  if(b.mode === 'zone'){
    const d = Math.hypot(pos.x, pos.z) || 1;
    mx = -pos.x/d; mz = -pos.z/d; speed = BOT_SPEED*1.15;
  }
  else if(b.mode === 'gun' && b.targetGun && !b.targetGun.taken){
    const dx = b.targetGun.x-pos.x, dz = b.targetGun.z-pos.z;
    const d = Math.hypot(dx,dz) || 1;
    mx = dx/d; mz = dz/d;
  }
  else if(b.mode === 'kick' && b.target && b.target.alive && b.target.trapped && b.target.bubble){
    const bp = b.target.bubble.position;
    const dx = bp.x-pos.x, dz = bp.z-pos.z;
    const d = Math.hypot(dx,dz) || 1;
    if(d > KICK_RANGE*0.8){ mx = dx/d; mz = dz/d; }
    else if(ch.kickCd <= 0) tryKick(ch);
  }
  else if(b.mode === 'hunt' && b.target && b.target.alive && !b.target.trapped){
    const tp = b.target.group.position;
    const dx = tp.x-pos.x, dz = tp.z-pos.z;
    const d = Math.hypot(dx,dz) || 1;
    ch.yaw = Math.atan2(-dx, -dz);
    if(d > 18){ mx = dx/d; mz = dz/d; }
    else { // strafe
      mx = -dz/d*0.7; mz = dx/d*0.7;
    }
    if(d < 24 && ch.shootCd <= 0 && ch.ammo > 0){
      const aim = new THREE.Vector3(dx, (tp.y+2.2)-(pos.y+2.2), dz).normalize();
      const spread = 0.26 + d*0.006;   // worse aim at range
      aim.x += (Math.random()-0.5)*spread;
      aim.y += (Math.random()-0.5)*0.12;
      aim.z += (Math.random()-0.5)*spread;
      shoot(ch, aim.normalize());
      ch.shootCd = 3.0 + Math.random()*2.5;
    }
  }
  else { // wander
    b.dirTimer -= dt;
    if(b.dirTimer <= 0){
      b.dirTimer = 1.5 + Math.random()*2.5;
      const a = Math.random()*Math.PI*2;
      b.wx = Math.cos(a); b.wz = Math.sin(a);
    }
    mx = b.wx; mz = b.wz; speed = BOT_SPEED*0.6;
  }

  if(mx || mz){
    const len = Math.hypot(mx,mz) || 1;
    pos.x += mx/len*speed*dt;
    pos.z += mz/len*speed*dt;
    ch.yaw = Math.atan2(-mx, -mz);
    ch.moving = true;
  }else{
    ch.moving = false;
  }
  collideObstacles(pos);
}

/* ---------------- per-character update ---------------- */
function updateChar(ch, dt){
  const g = ch.group;

  // dying animation
  if(!ch.alive){
    if(ch.dying > 0){
      ch.dying -= dt;
      g.rotation.y += dt*14;
      g.scale.setScalar(Math.max(0.001, ch.dying/0.7));
      g.position.y += dt*6;
      if(ch.dying <= 0) g.visible = false;
    }
    return;
  }

  ch.shootCd = Math.max(0, ch.shootCd - dt);
  ch.kickCd  = Math.max(0, ch.kickCd - dt);
  ch.invuln  = Math.max(0, ch.invuln - dt);

  /* --- drop phase: descending inside a bubble --- */
  if(!ch.landed){
    g.position.y -= DROP_SPEED*dt;
    // steer
    if(ch.isPlayer){
      const v = moveVector(camYaw);
      g.position.x += v.x*7*dt;
      g.position.z += v.z*7*dt;
      ch.yaw = camYaw + Math.PI;
    }else{
      g.position.x += Math.cos(ch.yaw)*1.5*dt;
      g.position.z += Math.sin(ch.yaw)*1.5*dt;
    }
    const rd = Math.hypot(g.position.x, g.position.z);
    if(rd > ISLAND_R-6){ g.position.x *= (ISLAND_R-6)/rd; g.position.z *= (ISLAND_R-6)/rd; }
    if(ch.dropBubble){
      ch.dropBubble.position.copy(g.position).y += 1.6;
      ch.dropBubble.rotation.y += dt*0.5;
    }
    if(g.position.y <= 0){
      g.position.y = 0;
      ch.landed = true;
      if(ch.dropBubble){
        burst(ch.dropBubble.position, 0xbfe8ff, 14, 7);
        scene.remove(ch.dropBubble);
        ch.dropBubble = null;
        sPopS();
      }
      if(ch.isPlayer){
        gameState = 'play';
        zoneStarted = true;
        // the drop looks down at the island; on the ground you want the horizon
        camPitch = Math.min(camPitch, 0.12);
        showMessage('<span class="mark">GO!</span> FIND A BUBBLE GUN', 3000);
      }
    }
    // limb pose while dropping: tucked
    ch.parts.lLeg.rotation.x = 0.5; ch.parts.rLeg.rotation.x = 0.5;
    ch.parts.lArm.rotation.z = 0.9; ch.parts.rArm.rotation.z = -0.9;
    g.rotation.y = ch.yaw;
    return;
  }

  /* --- trapped in a bubble: float & drift --- */
  if(ch.trapped && ch.bubble){
    ch.trapTimer -= dt;
    const bp = ch.bubble.position;
    // rise to hover height, bob
    const targetY = 4.6 + Math.sin(gameTime*1.5 + g.id)*0.5;
    bp.y += (targetY - bp.y)*dt*1.5;
    // drift (random walk)
    ch.trapDrift.x += (Math.random()-0.5)*dt*3;
    ch.trapDrift.z += (Math.random()-0.5)*dt*3;
    ch.trapDrift.clampLength(0, 3);
    bp.x += ch.trapDrift.x*dt;
    bp.z += ch.trapDrift.z*dt;
    const rd = Math.hypot(bp.x, bp.z);
    if(rd > ISLAND_R-3){ bp.x *= (ISLAND_R-3)/rd; bp.z *= (ISLAND_R-3)/rd; ch.trapDrift.multiplyScalar(-0.5); }
    // character hangs inside
    g.position.set(bp.x, bp.y-1.6, bp.z);
    g.rotation.y += dt*0.8;
    // curled pose, wiggling
    const w = Math.sin(gameTime*10)* (gameTime - ch.lastStruggle < 0.4 ? 0.7 : 0.25);
    ch.parts.lLeg.rotation.x = 0.7+w; ch.parts.rLeg.rotation.x = 0.7-w;
    ch.parts.lArm.rotation.z = 1.2+w*0.5; ch.parts.rArm.rotation.z = -1.2-w*0.5;
    ch.bubble.rotation.y += dt*0.6;

    if(ch.isPlayer){
      el('struggleFill').style.width = Math.max(0,(ch.trapTimer/TRAP_TIME)*100)+'%';
    }
    if(ch.trapTimer <= 0) releaseChar(ch);
    return;
  }

  /* --- normal on-ground movement --- */
  if(ch.isPlayer){
    // kneel: hold C / Ctrl / the CROUCH button — can't kneel mid-air
    const wantCrouch = (keys['KeyC'] || keys['ControlLeft'] || keys['ControlRight'] || touchCrouch)
                       && g.position.y <= 0.01;
    ch.crouch += ((wantCrouch?1:0) - ch.crouch) * Math.min(1, dt*10);
    if(wantCrouch !== ch.crouchHud){
      ch.crouchHud = wantCrouch;
      el('stance').innerHTML = wantCrouch
        ? 'STANCE <b style="color:var(--accent)">KNEELING</b>'
        : 'STANCE <b style="color:var(--dim)">STANDING</b>';
    }
    const v = moveVector(camYaw);
    ch.moving = v.lengthSq() > 0;
    const spd = MOVE_SPEED * (1 - 0.55*ch.crouch);
    g.position.x += v.x*spd*dt;
    g.position.z += v.z*spd*dt;
    if(ch.moving) ch.yaw = Math.atan2(-v.x, -v.z);
    collideObstacles(g.position);
  }else{
    botUpdate(ch, dt);
  }

  // gravity / jump
  if(g.position.y > 0 || ch.vel.y !== 0){
    g.position.y += ch.vel.y*dt;
    ch.vel.y -= GRAVITY*dt;
    if(g.position.y <= 0){ g.position.y = 0; ch.vel.y = 0; }
  }

  // gun pickup
  for(const gun of guns){
    if(gun.taken) continue;
    const dx = gun.x-g.position.x, dz = gun.z-g.position.z;
    if(dx*dx+dz*dz < 9){
      gun.taken = true;
      gun.mesh.visible = false;
      ch.ammo += AMMO_PER_GUN;
      giveGunModel(ch);
      if(ch.isPlayer){
        sPickup();
        updateAmmoHud();
        showMessage('BUBBLE GUN ACQUIRED <span class="mark">+'+AMMO_PER_GUN+'</span>', 1800);
      }
    }
  }

  /* --- animation --- */
  const p = ch.parts;
  g.rotation.y = ch.yaw + Math.PI;
  // walk cycle kept in its own accumulator so the kneel offset can't pile up
  if(ch.moving && g.position.y <= 0.01){
    ch.walk += dt*10;
    const s = Math.sin(ch.walk);
    ch.poseLegL = s*0.8;  ch.poseLegR = -s*0.8;
    ch.poseArmL = -s*0.6; ch.poseArmR = s*0.6;
  }else{
    ch.poseLegL *= 0.8; ch.poseLegR *= 0.8;
    ch.poseArmL *= 0.8; ch.poseArmR *= 0.8;
  }
  p.lLeg.rotation.x = ch.poseLegL;
  p.rLeg.rotation.x = ch.poseLegR;
  p.lArm.rotation.x = ch.poseArmL;
  if(!ch.gunMesh) p.rArm.rotation.x = ch.poseArmR;
  p.lArm.rotation.z *= 0.7; p.rArm.rotation.z *= 0.7;
  // aim pose when armed, with a recoil snap on each shot
  if(ch.gunMesh){
    ch.recoil = Math.max(0, ch.recoil - dt*5);
    p.rArm.rotation.x = -1.3 + ch.recoil*0.55;
    ch.gunMesh.position.z = 0.35 - ch.recoil*0.28;
    ch.gunMesh.rotation.x = ch.recoil*0.5;
  }
  // kneeling pose: body sinks, legs fold under
  const cr = ch.crouch;
  if(cr > 0.001){
    const drop = 1.05*cr;
    p.torso.position.y = 1.8 - drop;
    p.head.position.y  = 2.85 - drop;
    p.lArm.position.y  = 2.3 - drop;
    p.rArm.position.y  = 2.3 - drop;
    p.lLeg.position.y  = 1.2 - drop;
    p.rLeg.position.y  = 1.2 - drop;
    p.lLeg.scale.y = p.rLeg.scale.y = 1 - 0.6*cr;
    p.lLeg.rotation.x = ch.poseLegL + 1.5*cr;
    p.rLeg.rotation.x = ch.poseLegR + 1.5*cr;
    p.torso.rotation.x = 0.25*cr;
  }else{
    p.torso.position.y = 1.8;  p.head.position.y = 2.85;
    p.lArm.position.y = 2.3;   p.rArm.position.y = 2.3;
    p.lLeg.position.y = 1.2;   p.rLeg.position.y = 1.2;
    p.lLeg.scale.y = p.rLeg.scale.y = 1;
    p.torso.rotation.x = 0;
  }

  // kick animation (left leg snap)
  if(ch.kickAnim > 0){
    ch.kickAnim -= dt;
    const k = Math.sin((0.35-ch.kickAnim)/0.35*Math.PI);
    p.lLeg.rotation.x = -k*1.7;
  }
  // invulnerable flicker
  g.visible = ch.invuln > 0 ? (Math.floor(gameTime*12)%2===0) : true;
}

/* ---------------- projectiles ---------------- */
function updateProjectiles(dt){
  for(let i=projectiles.length-1;i>=0;i--){
    const pr = projectiles[i];
    pr.life -= dt;
    pr.vel.y += PROJ_RISE*dt; // bubbles drift up slightly
    pr.mesh.position.addScaledVector(pr.vel, dt);
    pr.shell.rotation.y += dt*6;

    // point the comet tail back along the flight path
    const dirN = pr.vel.clone().normalize();
    pr.tail.quaternion.setFromUnitVectors(UP, dirN.clone().negate());
    pr.tail.position.copy(dirN).multiplyScalar(-2.2);

    // glowing foam trail that hangs in the air so the path is obvious
    pr.trailCd -= dt;
    if(pr.trailCd <= 0){
      pr.trailCd = 0.012;
      const t = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 6, 5),
        new THREE.MeshBasicMaterial({color:0xdaf6ff, transparent:true, opacity:0.9,
          blending:THREE.AdditiveBlending, depthWrite:false})
      );
      t.position.copy(pr.mesh.position);
      scene.add(t);
      particles.push({mesh:t, vel:new THREE.Vector3(0,0.35,0), life:0.7, maxLife:0.7,
        shrink:true, float:true});
    }
    let dead = pr.life <= 0 || pr.mesh.position.y < 0;
    // trees and rocks block bubbles — hide behind cover!
    if(!dead){
      const pp = pr.mesh.position;
      for(const o of obstacles){
        const dx = pp.x-o.x, dz = pp.z-o.z;
        const rr = o.r + 0.5;
        if(dx*dx + dz*dz < rr*rr && pp.y < o.h){ dead = true; break; }
      }
    }
    if(!dead){
      for(const t of chars){
        if(t === pr.owner || !t.alive || t.trapped || !t.landed || t.invuln > 0) continue;
        // kneeling shrinks the hitbox and drops it low — bubbles fly overhead
        const cr = t.crouch || 0;
        const c = t.group.position.clone(); c.y += 1.7 - 0.85*cr;
        const hitR = (t.isPlayer ? 1.6 : 2.2) - 0.8*cr;
        if(pr.mesh.position.distanceTo(c) < hitR){
          trapChar(t, pr.owner.name);
          if(pr.owner.isPlayer && t.trapped)
            showMessage(t.name+' IS BUBBLED! <span class="mark">KICK THEM! [F]</span>', 2500);
          dead = true;
          break;
        }
      }
    }
    if(dead){
      burst(pr.mesh.position, 0xbfe8ff, 4, 3, 0.1);
      scene.remove(pr.mesh);
      projectiles.splice(i,1);
    }
  }
}

/* ---------------- muzzle flashes ---------------- */
function updateFlashes(dt){
  for(let i=flashes.length-1;i>=0;i--){
    const f = flashes[i];
    f.life -= dt;
    if(f.life <= 0){
      scene.remove(f.mesh);
      flashes.splice(i,1);
      continue;
    }
    const t = 1 - f.life/f.maxLife;
    f.mesh.scale.setScalar(1 + t*2.6);
    f.mesh.material.opacity = 0.9*(1-t);
  }
}

/* ---------------- particles ---------------- */
function updateParticles(dt){
  for(let i=particles.length-1;i>=0;i--){
    const pt = particles[i];
    pt.life -= dt;
    if(pt.life <= 0){
      scene.remove(pt.mesh);
      particles.splice(i,1);
      continue;
    }
    if(!pt.float) pt.vel.y -= 6*dt;   // trail motes hang in the air instead of falling
    pt.mesh.position.addScaledVector(pt.vel, dt);
    const k = pt.life/pt.maxLife;
    pt.mesh.material.opacity = 0.9*k;
    if(pt.shrink) pt.mesh.scale.setScalar(0.35 + 0.65*k);
  }
}

/* ---------------- zone ---------------- */
let graceAnnounced = false;
function updateZone(dt){
  if(!zoneStarted) return;
  if(!graceAnnounced && gameTime > PLAYER_GRACE){
    graceAnnounced = true;
    if(chars[0] && chars[0].alive){
      showMessage('<span class="mark">&#9888;</span> THE ENEMIES HAVE SPOTTED YOU!', 3000);
      sZone();
    }
  }
  const info = el('zoneInfo');
  zoneTimer += dt;

  if(zonePhaseIdx < ZONE_PHASES.length){
    const ph = ZONE_PHASES[zonePhaseIdx];
    if(!zoneShrinking){
      const left = ph.hold - zoneTimer;
      info.textContent = 'ZONE SHRINKS IN '+Math.max(0,Math.ceil(left))+'s';
      info.className = 'panel' + (left < 5 ? ' warn' : '');
      if(left <= 0){
        zoneShrinking = true;
        zoneTimer = 0;
        zoneFrom = zoneRadius;
        sZone();
        showMessage('<span class="mark">&#9888; ZONE SHRINKING!</span>', 2500);
      }
    }else{
      const t = Math.min(1, zoneTimer/ph.dur);
      zoneRadius = zoneFrom + (ph.to - zoneFrom)*t;
      info.textContent = '⚠ ZONE SHRINKING — '+Math.round(zoneRadius)+'m';
      info.className = 'panel warn';
      if(t >= 1){
        zoneShrinking = false;
        zoneTimer = 0;
        zonePhaseIdx++;
      }
    }
  }else{
    info.textContent = 'FINAL ZONE — '+Math.round(zoneRadius)+'m';
    info.className = 'panel warn';
  }

  zoneWall.scale.set(zoneRadius, 1, zoneRadius);
  zoneTex.repeat.x = Math.max(8, Math.round(zoneRadius/2.2));
  zoneTex.offset.x = gameTime*0.05;
  zoneWall.material.opacity = (zoneShrinking ? 0.95 : 0.75) + Math.sin(gameTime*3)*0.08;

  zoneRing.scale.set(zoneRadius, zoneRadius, 1);
  zoneRing.material.opacity = 0.75 + Math.sin(gameTime*4)*0.22;

  // boundary contact = elimination
  for(const ch of chars){
    if(!ch.alive || !ch.landed) continue;
    const pos = ch.trapped && ch.bubble ? ch.bubble.position : ch.group.position;
    if(Math.hypot(pos.x, pos.z) > zoneRadius + 0.5){
      eliminate(ch, 'THE ZONE');
    }
  }
}

/* ---------------- minimap ---------------- */
const mapCv = el('minimap'), mapCtx = mapCv.getContext('2d');
function drawMinimap(){
  const s = 140, c = s/2, scale = (s/2-6)/ISLAND_R;
  mapCtx.clearRect(0,0,s,s);
  mapCtx.fillStyle = '#1a2a38';
  mapCtx.fillRect(0,0,s,s);
  // island
  mapCtx.fillStyle = '#3f6b34';
  mapCtx.beginPath(); mapCtx.arc(c,c,ISLAND_R*scale,0,Math.PI*2); mapCtx.fill();
  // zone
  if(zoneStarted){
    mapCtx.strokeStyle = '#ff3ca0';
    mapCtx.lineWidth = 2.5;
    mapCtx.beginPath(); mapCtx.arc(c,c,Math.min(ISLAND_R,zoneRadius)*scale,0,Math.PI*2); mapCtx.stroke();
  }
  // guns
  mapCtx.fillStyle = '#d9c94f';
  for(const g of guns){
    if(g.taken) continue;
    mapCtx.fillRect(c+g.x*scale-1, c+g.z*scale-1, 2, 2);
  }
  // fighters
  for(const ch of chars){
    if(!ch.alive) continue;
    const p = ch.group.position;
    mapCtx.fillStyle = ch.isPlayer ? '#FAF9F5' : (ch.trapped ? '#6fc3df' : '#d94f4f');
    mapCtx.beginPath();
    mapCtx.arc(c+p.x*scale, c+p.z*scale, ch.isPlayer?3:2.2, 0, Math.PI*2);
    mapCtx.fill();
  }
}

/* ---------------- guns idle animation ---------------- */
function updateGuns(dt){
  for(const g of guns){
    if(g.taken) continue;
    g.mesh.rotation.y += dt*1.5;
    g.mesh.position.y = 1.4 + Math.sin(gameTime*2 + g.x)*0.25;
  }
}

/* ---------------- camera ---------------- */
/* One rig for both views. The camera always *looks along* the aim direction — third
   person just pulls the eye back over the right shoulder, scoping slides it forward
   onto the eye. Because the view direction and the aim direction are the same vector,
   the crosshair never lies, and pitch behaves identically zoomed or not.

   The old rig orbited the player and looked *at* his chest, so the view ray always
   sloped into the ground past him and the upward half of the pitch range did nothing. */
function updateCamera(){
  const p = chars[0];
  const target = p.trapped && p.bubble ? p.bubble.position.clone() : p.group.position.clone();
  camKick *= 0.86;
  const pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, camPitch - camKick));
  const lift = p.trapped ? 0 : 1.05*(p.crouch||0);   // camera sinks with the kneel
  // how far into the scope we are, 0 = third person, 1 = down the sights
  const zoomT = p.trapped ? 0 : (BASE_FOV - camera.fov)/(BASE_FOV - ZOOM_FOV);

  const fwd = new THREE.Vector3(
    -Math.sin(camYaw)*Math.cos(pitch),
    -Math.sin(pitch),
    -Math.cos(camYaw)*Math.cos(pitch)
  );
  const right = new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw));
  const eye = new THREE.Vector3(target.x, target.y + 2.75 - lift, target.z);

  // third person: back along the aim ray, offset over the shoulder so the player's
  // own body isn't parked under the crosshair. pull in a little when looking up so
  // the camera doesn't scrape the ground behind him.
  const D = (p.landed ? 9.5 : 14) * (1 - 0.30*Math.max(0, -pitch));
  const tpPos = eye.clone().addScaledVector(fwd, -D).addScaledVector(right, 1.6);
  tpPos.y = Math.max(tpPos.y + 0.5, 0.9);

  const fpPos = eye.clone().addScaledVector(fwd, 0.8);
  camera.position.copy(tpPos).lerp(fpPos, zoomT);
  camera.lookAt(camera.position.clone().addScaledVector(fwd, 100));
  // your own head would fill the scope otherwise
  if(zoomT > 0.6 && p.alive) p.group.visible = false;
}

/* ---------------- game flow ---------------- */
function startGame(){
  if(gameState !== 'menu') return;
  if(document.activeElement && document.activeElement.blur) document.activeElement.blur();
  el('startScreen').classList.add('hidden');
  hud.classList.remove('hidden');
  spawnChar(true, 0);
  for(let i=0;i<BOT_COUNT;i++) spawnChar(false, i);
  spawnGuns();
  updateAliveHud();
  updateAmmoHud();
  gameState = 'drop';
  camYaw = 0;
  camPitch = 0.50;   // the camera aims where it looks now, so start tipped at the island
  if(IS_TOUCH){
    el('touchUI').classList.add('show');
    showMessage('STEER YOUR BUBBLE WITH THE <span class="mark">JOYSTICK</span>', 3500);
  }else{
    canvas.requestPointerLock();
    showMessage('STEER YOUR BUBBLE WITH <span class="mark">WASD</span>', 3500);
  }
}

function endGame(won, byName){
  if(gameState === 'end') return;
  gameState = 'end';
  document.exitPointerLock();
  // drop out of the scope so the final camera is the normal third-person view
  zoomHeld = touchZoom = touchFire = false;
  // hand the last few seconds over to a sting instead of the loop
  musicStop();
  if(won){
    sfx(392,0.20,'triangle',0.14);
    setTimeout(()=>sfx(523,0.20,'triangle',0.14), 170);
    setTimeout(()=>sfx(659,0.55,'triangle',0.14), 340);
  }else{
    sfx(330,0.28,'triangle',0.12);
    setTimeout(()=>sfx(247,0.55,'triangle',0.12), 220);
  }
  camera.fov = BASE_FOV;
  camera.updateProjectionMatrix();
  el('crosshair').classList.remove('scope');
  const p = chars[0];
  const placement = won ? 1 : aliveCount() + 1;
  const t = el('endTitle');
  if(won){
    t.textContent = '✱ WINNER WINNER BUBBLE DINNER ✱';
    t.className = 'win';
    burst(p.group.position.clone().setY(4), 0x7fb069, 40, 14, 0.25);
  }else{
    t.textContent = 'POPPED!';
    t.className = 'lose';
  }
  el('endStats').innerHTML =
    '# '+placement+' OF '+chars.length+'<br>'+
    'ENEMIES POPPED: '+p.kills+
    (byName && !won ? '<br>ELIMINATED BY: '+byName : '');
  setTimeout(()=>el('endScreen').classList.remove('hidden'), won ? 1200 : 800);
}

el('musicToggle').addEventListener('click', toggleMusic);
el('startBtn').addEventListener('click', startGame);
el('restartBtn').addEventListener('click', ()=>location.reload());

/* ---------------- main loop ---------------- */
let lastT = performance.now();
function animate(now){
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - lastT)/1000);
  lastT = now;

  if(gameState === 'drop' || gameState === 'play' || gameState === 'end'){
    gameTime += dt;
    if(gameState !== 'end'){
      updateKeyboardControls(dt);
      updateZoom(dt);
      for(const ch of chars) updateChar(ch, dt);
      updateProjectiles(dt);
      updateZone(dt);
    }
    updateParticles(dt);
    updateFlashes(dt);
    updateGuns(dt);
    updateCamera();
    drawMinimap();
  }else{
    // menu: slow orbit over the island
    const t = now/1000*0.08;
    camera.position.set(Math.cos(t)*130, 60, Math.sin(t)*130);
    camera.lookAt(0, 0, 0);
  }
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);
