// main.js — Starhold: Top-down Space Survival (HTML/CSS/JS using Phaser 3)
// MVP implementation: player movement, aim, shooting, asteroids, gem pickups,
// shop & placement (walls/turrets), turrets auto-fire, enemies + long randomized waves,
// shield/hull system, complete reset on death.

const CONFIG = {
  width: 1280,
  height: 720,
  backgroundColor: 0x071226,
  waveMinSec: 300, // 5 minutes
  waveMaxSec: 600, // 10 minutes
  // For quick testing you can toggle debugShortWaves to true (30-60s)
  debugShortWaves: false,
  debugMinSec: 15,
  debugMaxSec: 30,
  startingGems: 50,
  shieldMax: 100,
  shieldRegen: 6, // per sec
  shieldRegenDelay: 3, // seconds after last damage
  hullHits: 2,
  asteroidRates: { small: 10, medium: 30, large: 90 }, // seconds base spawn multipliers
  turretCap: 8, // soft cap
  difficultyMultipliers: {
    easy: { hp: 0.8, dmg: 0.8, spawn: 0.9, gems: 1.1 },
    medium: { hp: 1.0, dmg: 1.0, spawn: 1.0, gems: 1.0 },
    hard: { hp: 1.2, dmg: 1.25, spawn: 1.15, gems: 0.9 }
  }
};

let game, scene;

window.addEventListener('load', () => {
  const cfg = {
    type: Phaser.AUTO,
    width: CONFIG.width,
    height: CONFIG.height,
    backgroundColor: CONFIG.backgroundColor,
    parent: 'gameContainer',
    physics: {
      default: 'arcade',
      arcade: { debug: false, gravity: { y: 0 } }
    },
    scene: { preload, create, update }
  };
  game = new Phaser.Game(cfg);
});

function preload() {
  scene = this;
  // Create simple textures via Graphics for quick placeholders
  // Player texture
  const g = this.make.graphics({ x: 0, y: 0, add: false });
  g.fillStyle(0xff8b3d, 1);
  g.fillCircle(32, 32, 28);
  g.lineStyle(2, 0x222222);
  g.strokeCircle(32,32,28);
  g.generateTexture('playerShip', 64, 64);
  g.clear();

  // Bullet
  g.fillStyle(0xfff38a, 1);
  g.fillCircle(4,4,4);
  g.generateTexture('bullet', 8,8);
  g.clear();

  // Turret
  g.fillStyle(0x9ad3ff, 1);
  g.fillRect(0,0,28,28);
  g.lineStyle(2,0x223344);
  g.strokeRect(0,0,28,28);
  g.generateTexture('turret', 28,28);
  g.clear();

  // Wall
  g.fillStyle(0x7d7d7d, 1);
  g.fillRect(0,0,48,48);
  g.generateTexture('wall', 48,48);
  g.clear();

  // Gem
  g.fillStyle(0x57cc99, 1);
  g.fillTriangle(8,0, 0,16, 16,16);
  g.generateTexture('gem', 16,16);
  g.clear();

  // Enemy
  g.fillStyle(0xff3b3b, 1);
  g.fillCircle(16,16,14);
  g.generateTexture('enemy', 32,32);
  g.clear();

  // Asteroids (simple)
  g.fillStyle(0x9a8f73,1);
  g.fillCircle(16,16,14);
  g.generateTexture('asteroid', 32,32);
  g.clear();
}

function create() {
  scene = this;

  // State
  this.state = {
    running: false,
    gems: CONFIG.startingGems,
    shield: CONFIG.shieldMax,
    hullHits: CONFIG.hullHits,
    lastDamageTime: 0,
    waveNumber: 0,
    nextWaveAt: null,
    difficulty: 'medium',
    turretCount: 0,
  };

  // HUD elements references
  this.hud = {
    gemsEl: document.getElementById('gems'),
    waveEl: document.getElementById('wave'),
    countdownEl: document.getElementById('countdown'),
    shieldFillEl: document.getElementById('shield-fill'),
    hullEl: document.getElementById('hull'),
    messageEl: document.getElementById('message'),
    startBtn: document.getElementById('startBtn'),
    shopOverlay: document.getElementById('shopOverlay')
  };

  // Add starfield background using particles
  this.addStarfield();

  // Groups
  this.bullets = this.physics.add.group({ classType: Phaser.GameObjects.Image, runChildUpdate: true, maxSize: 200 });
  this.enemies = this.physics.add.group();
  this.asteroids = this.physics.add.group();
  this.walls = this.physics.add.group();
  this.turrets = this.add.group();
  this.gems = this.physics.add.group();

  // Player
  this.player = this.physics.add.image(CONFIG.width/2, CONFIG.height/2, 'playerShip');
  this.player.setDepth(2);
  this.player.setCollideWorldBounds(true);
  this.player.speed = 180;
  this.player.fireRate = 250; // ms
  this.player.lastShot = 0;

  // Camera world bounds
  this.physics.world.setBounds(0,0, CONFIG.width, CONFIG.height);

  // Input
  this.keys = this.input.keyboard.addKeys('W,A,S,D,E,ESC');
  this.input.mouse.capture = true;

  // Collisions
  this.physics.add.overlap(this.bullets, this.enemies, onBulletHitEnemy, null, this);
  this.physics.add.overlap(this.bullets, this.asteroids, onBulletHitAsteroid, null, this);
  this.physics.add.overlap(this.player, this.gems, onPickupGem, null, this);
  this.physics.add.overlap(this.enemies, this.walls, onEnemyHitWall, null, this);
  this.physics.add.overlap(this.enemies, this.player, onEnemyHitPlayer, null, this);

  // Shop / UI
  setupShopUI(this);

  // Start button
  this.hud.startBtn.addEventListener('click', () => startRun(this));

  // Spawn some initial asteroids for the player to farm
  spawnAsteroid(this, 'medium', { x: 150, y: 120 });
  spawnAsteroid(this, 'small', { x: 400, y: 80 });
  spawnAsteroid(this, 'large', { x: 900, y: 200 });

  // Wave timer scheduling (not active until start)
  this.nextWaveTimer = null;

  // Message
  this.hud.messageEl.textContent = 'Press Start to begin';

  // Show difficulty on startup (use medium)
  showGemsWaveShield(this);
}

function update(time, delta) {
  if (!scene) return;
  const s = scene;
  const st = s.state;

  // Input: toggle shop
  if (Phaser.Input.Keyboard.JustDown(s.keys.E)) {
    toggleShop(s);
  }
  if (Phaser.Input.Keyboard.JustDown(s.keys.ESC)) {
    if (s.placing) cancelPlacement(s);
    hideShop(s);
  }

  if (!st.running) return;

  // Movement WASD
  let vx = 0, vy = 0;
  if (s.keys.A.isDown) vx -= 1;
  if (s.keys.D.isDown) vx += 1;
  if (s.keys.W.isDown) vy -= 1;
  if (s.keys.S.isDown) vy += 1;
  const len = Math.hypot(vx, vy) || 1;
  vx = (vx/len) * s.player.speed;
  vy = (vy/len) * s.player.speed;
  s.player.body.setVelocity(vx, vy);

  // Aim towards pointer
  const pointer = s.input.activePointer;
  const angle = Phaser.Math.Angle.Between(s.player.x, s.player.y, pointer.worldX, pointer.worldY);
  s.player.setRotation(angle + Math.PI/2);

  // Shooting (left click)
  if (pointer.isDown) {
    if (time - s.player.lastShot > s.player.fireRate) {
      firePlayerBullet(s, angle);
      s.player.lastShot = time;
    }
  }

  // Turret behavior
  updateTurrets(s, time);

  // Asteroid periodic spawn (simple random spawn)
  maybeSpawnAsteroid(s, delta);

  // Update shield regen
  updateShieldRegen(s, delta);

  // Update HUD
  showGemsWaveShield(s);

  // Placement ghost follow pointer
  if (s.placing) {
    updatePlacementGhost(s);
  }
}

// ---------- Helper functions ----------

function startRun(s) {
  // reset session state completely
  s.state.running = true;
  s.state.gems = CONFIG.startingGems;
  s.state.shield = CONFIG.shieldMax;
  s.state.hullHits = CONFIG.hullHits;
  s.state.lastDamageTime = 0;
  s.state.waveNumber = 0;
  s.state.turretCount = 0;
  // destroy existing entities
  s.enemies.clear(true, true);
  s.asteroids.clear(true, true);
  s.gems.clear(true, true);
  s.walls.clear(true, true);
  s.turrets.clear(true);
  s.player.setPosition(CONFIG.width/2, CONFIG.height/2);
  s.player.speed = 180; s.player.fireRate = 250;
  s.hud.messageEl.textContent = 'Survive. Build your base. Waves come every 5-10 minutes.';
  scheduleNextWave(s);
  // refill some asteroids
  for (let i=0;i<4;i++) spawnAsteroid(s, 'small');
  spawnAsteroid(s, 'medium');
  spawnAsteroid(s, 'large');
}

function scheduleNextWave(s) {
  if (s.nextWaveTimer) s.nextWaveTimer.remove(false);
  const min = s.debugShortWaves ? CONFIG.debugMinSec : CONFIG.waveMinSec;
  const max = s.debugShortWaves ? CONFIG.debugMaxSec : CONFIG.waveMaxSec;
  const sec = Phaser.Math.Between(min, max);
  const ms = sec * 1000;
  const now = s.time.now;
  s.state.nextWaveAt = now + ms;
  s.nextWaveTimer = s.time.addEvent({
    delay: ms,
    callback: () => startWave(s),
    callbackScope: s
  });
  // provide countdown by updating DOM every second
  updateCountdownInterval(s);
}

function updateCountdownInterval(s) {
  if (s.countdownInterval) clearInterval(s.countdownInterval);
  s.countdownInterval = setInterval(() => {
    if (!s.state.running || !s.state.nextWaveAt) {
      s.hud.countdownEl.textContent = 'Next wave in: --:--';
      clearInterval(s.countdownInterval);
      return;
    }
    const msLeft = Math.max(0, s.state.nextWaveAt - s.time.now);
    const sec = Math.ceil(msLeft/1000);
    const mm = Math.floor(sec/60).toString().padStart(2,'0');
    const ss = (sec%60).toString().padStart(2,'0');
    s.hud.countdownEl.textContent = `Next wave in: ${mm}:${ss}`;
    // audio or visual cue could be added at 60s/10s
  }, 900);
}

function startWave(s) {
  s.state.waveNumber += 1;
  const w = s.state.waveNumber;
  s.hud.waveEl.textContent = `Wave: ${w}`;
  s.hud.messageEl.textContent = `Wave ${w} incoming!`;
  // spawn enemies according to wave composition and difficulty
  const diff = CONFIG.difficultyMultipliers[s.state.difficulty];
  const baseCount = Math.max(3, Math.floor(4 + (w * 1.25) * diff.spawn));
  // every 2nd wave choose a global upgrade
  let globalUpgrade = null;
  if (w % 2 === 0) {
    const choices = ['speed','health','firerate','armor','newtype'];
    globalUpgrade = Phaser.Utils.Array.GetRandom(choices);
    s.hud.messageEl.textContent += ` (Wave upgrade: ${globalUpgrade})`;
  }
  for (let i=0;i<baseCount;i++) {
    const pos = randomEdgePosition();
    spawnEnemy(s, pos.x, pos.y, globalUpgrade, diff);
  }
  // schedule next wave after current one completes + randomized delay
  scheduleNextWave(s);
}

function randomEdgePosition() {
  // spawn near one edge randomly
  const margin = 40;
  const side = Phaser.Math.Between(0,3);
  if (side === 0) return { x: Phaser.Math.Between(margin, CONFIG.width-margin), y: margin }; // top
  if (side === 1) return { x: Phaser.Math.Between(margin, CONFIG.width-margin), y: CONFIG.height - margin }; // bottom
  if (side === 2) return { x: margin, y: Phaser.Math.Between(margin, CONFIG.height-margin) };
  return { x: CONFIG.width-margin, y: Phaser.Math.Between(margin, CONFIG.height-margin) };
}

function spawnEnemy(s, x, y, globalUpgrade, diff) {
  const en = s.physics.add.image(x,y,'enemy');
  en.setCircle(14);
  en.hp = Math.round(40 * diff.hp * (globalUpgrade === 'health' ? 1.25 : 1.0));
  en.damage = Math.round(12 * diff.dmg * (globalUpgrade === 'firerate' ? 1.0 : 1.0));
  en.speed = 40 * (globalUpgrade === 'speed' ? 1.3 : 1);
  en.setData('target', 'base_or_player');
  en.setData('value', Math.round(12 * diff.gems));
  en.setCollideWorldBounds(true);
  s.enemies.add(en);
  // simple seeker towards either walls or player
  en.update = function(time, delta) {
    const target = findNearestWallOrPlayer(s, en);
    if (target) {
      s.physics.moveToObject(en, target, en.speed);
    } else {
      // move toward player if nothing else
      s.physics.moveToObject(en, s.player, en.speed);
    }
  };
}

function findNearestWallOrPlayer(s, en) {
  let nearest = null;
  let nd = Infinity;
  s.walls.getChildren().forEach(w => {
    const d = Phaser.Math.Distance.Between(en.x,en.y,w.x,w.y);
    if (d < nd) { nd = d; nearest = w; }
  });
  // if a wall is closer than player, attack wall
  const dPlayer = Phaser.Math.Distance.Between(en.x,en.y,s.player.x,s.player.y);
  if (dPlayer < nd) return s.player;
  return nearest || s.player;
}

function onBulletHitEnemy(bullet, enemy) {
  if (!enemy || !bullet) return;
  const dmg = bullet.damage || 12;
  enemy.hp -= dmg;
  bullet.destroy();
  showSmallEffect(scene, enemy.x, enemy.y);
  if (enemy.hp <= 0) {
    // drop gems
    const val = enemy.getData('value') || 10;
    spawnGem(scene, enemy.x, enemy.y, val);
    enemy.destroy();
    scene.hud.messageEl.textContent = `Enemy destroyed +${val}g`;
  }
}

function onBulletHitAsteroid(bullet, ast) {
  if (!ast || !bullet) return;
  ast.hp = (ast.hp || ast.initialHp) - (bullet.damage || 8);
  bullet.destroy();
  if (ast.hp <= 0) {
    spawnGem(scene, ast.x, ast.y, ast.dropValue || 5);
    ast.destroy();
    showSmallEffect(scene, ast.x, ast.y);
  }
}

function onPickupGem(player, gem) {
  const val = gem.getData('value') || 1;
  scene.state.gems += val;
  gem.destroy();
  scene.hud.messageEl.textContent = `Picked up ${val}g`;
}

function onEnemyHitWall(enemy, wall) {
  // damage wall and enemy gets destroyed on impact (kamikaze like)
  wall.hp = (wall.hp || 100) - 30;
  if (wall.hp <= 0) {
    wall.destroy();
  }
  // enemy takes self-damage
  if (enemy) enemy.destroy();
  showSmallEffect(scene, wall.x, wall.y);
}

function onEnemyHitPlayer(player, enemy) {
  // If shield is up, absorb; else hull hit
  const now = scene.time.now / 1000;
  const dmg = enemy.damage || 10;
  applyDamageToPlayer(scene, dmg);
  // destroy enemy on collision
  if (enemy) enemy.destroy();
}

function applyDamageToPlayer(s, dmg) {
  s.state.lastDamageTime = s.time.now / 1000;
  if (s.state.shield > 0) {
    s.state.shield -= dmg;
    if (s.state.shield < 0) s.state.shield = 0;
    s.hud.messageEl.textContent = `Shield hit -${dmg}`;
    if (s.state.shield <= 0) {
      s.hud.messageEl.textContent = `Shield down! Hull exposed.`;
    }
  } else {
    // hull hit
    s.state.hullHits -= 1;
    s.hud.messageEl.textContent = `Hull hit! ${s.state.hullHits} left`;
    if (s.state.hullHits <= 0) {
      // death and full reset
      s.hud.messageEl.textContent = 'You died. Restarting...';
      setTimeout(() => {
        fullReset(s);
      }, 900);
    }
  }
}

function fullReset(s) {
  // Reset everything and stop timers
  s.state.running = false;
  if (s.nextWaveTimer) s.nextWaveTimer.remove(false);
  if (s.countdownInterval) clearInterval(s.countdownInterval);
  s.enemies.clear(true, true);
  s.asteroids.clear(true, true);
  s.gems.clear(true, true);
  s.walls.clear(true, true);
  s.turrets.clear(true);
  s.player.setPosition(CONFIG.width/2, CONFIG.height/2);
  s.hud.gemsEl.textContent = `Gems: ${CONFIG.startingGems}`;
  s.hud.messageEl.textContent = 'You died. Press Start to play again.';
  s.hud.countdownEl.textContent = 'Next wave in: --:--';
  s.hud.waveEl.textContent = 'Wave: 0';
  // reset state values
  s.state.gems = CONFIG.startingGems;
  s.state.shield = CONFIG.shieldMax;
  s.state.hullHits = CONFIG.hullHits;
  s.state.waveNumber = 0;
  s.state.turretCount = 0;
}

// Fire player bullet
function firePlayerBullet(s, angle) {
  const b = s.bullets.get();
  if (!b) return;
  b.setActive(true);
  b.setVisible(true);
  b.setTexture('bullet');
  b.setPosition(s.player.x, s.player.y);
  b.rotation = angle + Math.PI/2;
  s.physics.velocityFromRotation(angle, 600, b.body.velocity);
  b.damage = 12;
  // destroy after some time
  scene.time.addEvent({ delay: 2000, callback: () => { if (b && b.destroy) b.destroy(); } });
}

// Turret logic, very basic
function updateTurrets(s, time) {
  s.turrets.getChildren().forEach(t => {
    if (!t.active) return;
    if (!t.lastShot) t.lastShot = 0;
    if (time - t.lastShot < t.fireRate) return;
    // find nearest enemy in range
    let target = null, nd = t.range + 1;
    s.enemies.getChildren().forEach(e => {
      const d = Phaser.Math.Distance.Between(t.x,t.y,e.x,e.y);
      if (d < nd) { nd = d; target = e; }
    });
    if (target) {
      // shoot
      t.lastShot = time;
      const angle = Phaser.Math.Angle.Between(t.x,t.y,target.x,target.y);
      const b = s.bullets.get();
      if (!b) return;
      b.setActive(true); b.setVisible(true);
      b.setTexture('bullet');
      b.setPosition(t.x, t.y);
      b.rotation = angle + Math.PI/2;
      s.physics.velocityFromRotation(angle, 420, b.body.velocity);
      b.damage = t.damage;
      scene.time.addEvent({ delay: 2000, callback: () => { if (b && b.destroy) b.destroy(); } });
    }
  });
}

// Asteroid spawn logic (simple periodic spurts)
let asteroidSpawnAccumulator = 0;
function maybeSpawnAsteroid(s, delta) {
  asteroidSpawnAccumulator += delta;
  const interval = 2500; // every ~2.5s try spawn small chance
  if (asteroidSpawnAccumulator < interval) return;
  asteroidSpawnAccumulator = 0;
  // spawn small chance of an asteroid; spawn rarer medium & large
  const r = Phaser.Math.Between(1,100);
  if (r <= 30) spawnAsteroid(s, 'small');
  if (r > 90) spawnAsteroid(s, 'medium');
  if (r === 100) spawnAsteroid(s, 'large');
}

function spawnAsteroid(s, type='small', coords) {
  const pos = coords || { x: Phaser.Math.Between(50, CONFIG.width-50), y: Phaser.Math.Between(50, CONFIG.height-50) };
  const ast = s.physics.add.image(pos.x, pos.y, 'asteroid');
  ast.setCircle(14);
  if (type === 'small') { ast.initialHp = 2; ast.dropValue = Phaser.Math.Between(1,5); }
  if (type === 'medium') { ast.initialHp = 6; ast.dropValue = Phaser.Math.Between(10,20); }
  if (type === 'large') { ast.initialHp = 12; ast.dropValue = Phaser.Math.Between(25,36); }
  ast.hp = ast.initialHp;
  s.asteroids.add(ast);
}

// Spawn gem object
function spawnGem(s, x, y, val) {
  const g = s.physics.add.image(x, y, 'gem');
  g.setData('value', val);
  s.gems.add(g);
  // small float then allow pickup
  scene.time.addEvent({ delay: 10000, callback: () => { if (g && g.body) g.body.setEnable(false); } });
}

// Shield regen
function updateShieldRegen(s, delta) {
  const now = s.time.now / 1000;
  if (now - s.state.lastDamageTime > CONFIG.shieldRegenDelay) {
    if (s.state.shield < CONFIG.shieldMax) {
      s.state.shield += CONFIG.shieldRegen * (delta/1000);
      if (s.state.shield > CONFIG.shieldMax) s.state.shield = CONFIG.shieldMax;
    }
  }
}

// HUD update
function showGemsWaveShield(s) {
  s.hud.gemsEl.textContent = `Gems: ${Math.max(0, Math.floor(s.state.gems))}`;
  s.hud.waveEl.textContent = `Wave: ${s.state.waveNumber}`;
  const pct = (s.state.shield / CONFIG.shieldMax) * 100;
  s.hud.shieldFillEl.style.width = `${Math.max(0,Math.min(100,pct))}%`;
  s.hud.hullEl.textContent = `Hull: ${'♥'.repeat(Math.max(0,s.state.hullHits))}`;
}

// Small visual effect placeholder
function showSmallEffect(s, x, y) {
  const p = s.add.particles('bullet');
  const emitter = p.createEmitter({ x, y, speed: { min: 20, max: 80 }, angle: { min: 0, max: 360 }, lifespan: 300, scale: { start: 0.5, end: 0 }, quantity: 6 });
  s.time.addEvent({ delay: 300, callback: () => { p.destroy(); } });
}

// Shop UI setup and logic
function setupShopUI(s) {
  const overlay = document.getElementById('shopOverlay');
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) {
      hideShop(s);
    }
  });
  // Bind item buttons
  document.querySelectorAll('.shop-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const item = btn.getAttribute('data-item');
      attemptBuyItem(s, item);
    });
  });
  // Keyboard E toggle
  s.input.keyboard.on('keydown-E', () => toggleShop(s));
}

function toggleShop(s) {
  const overlay = s.hud.shopOverlay;
  if (!overlay) return;
  if (overlay.classList.contains('hidden')) {
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
  } else {
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
  }
}

function hideShop(s) {
  const overlay = s.hud.shopOverlay;
  if (!overlay) return;
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden', 'true');
}

// Attempt to buy an item and go into placement mode
function attemptBuyItem(s, item) {
  const costs = { wall:10, repair:5, turret:50, shipup:40, newship:100 };
  const cost = costs[item] || 0;
  if (s.state.gems < cost) {
    s.hud.messageEl.textContent = 'Not enough gems';
    return;
  }
  // Deduct immediately and enter placing mode
  s.state.gems -= cost;
  s.placing = { type: item, cost };
  createPlacementGhost(s, item);
  hideShop(s);
}

function createPlacementGhost(s, item) {
  cancelPlacement(s);
  const tex = (item === 'wall') ? 'wall' : (item === 'turret') ? 'turret' : 'wall';
  const ghost = s.add.image(s.input.activePointer.worldX, s.input.activePointer.worldY, tex).setAlpha(0.6);
  ghost.setDepth(50);
  s.placementGhost = ghost;
  // listen to pointer click to place
  s.input.once('pointerdown', (pointer) => {
    // right click to cancel
    if (pointer.rightButtonDown()) {
      cancelPlacement(s); return;
    }
    attemptPlace(s, pointer.worldX, pointer.worldY);
  });
  // allow cancel via ESC
  s.input.keyboard.once('keydown-ESC', () => cancelPlacement(s));
}

function updatePlacementGhost(s) {
  if (!s.placementGhost || !s.placing) return;
  const p = s.input.activePointer;
  s.placementGhost.setPosition(p.worldX, p.worldY);
  // basic validity: inside map and not overlapping walls
  const valid = isPlacementValid(s, p.worldX, p.worldY, s.placing.type);
  s.placementGhost.setTint(valid ? 0xffffff : 0xff8888);
}

function isPlacementValid(s, x, y, type) {
  // simple bounds check
  if (x < 30 || x > CONFIG.width-30 || y < 30 || y > CONFIG.height-30) return false;
  // do not allow placing too close to player
  if (Phaser.Math.Distance.Between(x,y,s.player.x,s.player.y) < 60) return false;
  // don't overlap other walls
  let ok = true;
  s.walls.getChildren().forEach(w => {
    if (Phaser.Math.Distance.Between(x,y,w.x,w.y) < 40) ok = false;
  });
  return ok;
}

function attemptPlace(s, x, y) {
  if (!s.placing) return;
  const type = s.placing.type;
  if (!isPlacementValid(s, x, y, type)) {
    s.hud.messageEl.textContent = 'Invalid placement';
    cancelPlacement(s);
    return;
  }
  if (type === 'wall') {
    const w = s.add.image(x,y,'wall');
    s.physics.world.enable(w);
    w.setInteractive();
    w.hp = 100;
    s.walls.add(w);
    s.hud.messageEl.textContent = 'Wall placed';
  } else if (type === 'turret') {
    if (s.state.turretCount >= CONFIG.turretCap) {
      s.hud.messageEl.textContent = 'Turret cap reached';
      cancelPlacement(s);
      return;
    }
    const t = s.add.image(x,y,'turret');
    t.range = 160;
    t.fireRate = 900; // ms
    t.damage = 18;
    t.setDepth(5);
    s.turrets.add(t);
    s.state.turretCount += 1;
    s.hud.messageEl.textContent = 'Turret placed';
  } else if (type === 'repair') {
    // repair nearest wall within range
    let nearest = null; let nd = 9999;
    s.walls.getChildren().forEach(w => {
      const d = Phaser.Math.Distance.Between(x,y,w.x,w.y);
      if (d < nd) { nd = d; nearest = w; }
    });
    if (nearest && nd < 60) {
      nearest.hp = Math.min(100, nearest.hp + 25);
      s.hud.messageEl.textContent = 'Repaired wall';
    } else s.hud.messageEl.textContent = 'No wall nearby to repair';
  } else {
    s.hud.messageEl.textContent = 'Placed item';
  }
  cancelPlacement(s);
}

function cancelPlacement(s) {
  if (s.placementGhost) {
    s.placementGhost.destroy();
    s.placementGhost = null;
  }
  s.placing = null;
}

// Utility: fire a small debug particle
function showTextFloating(s, x, y, text) {
  const t = s.add.text(x,y,text,{fontSize:'14px', color:'#ffffff'}).setDepth(60).setOrigin(0.5);
  s.tweens.add({ targets: t, y: y-30, alpha:0, duration:900, onComplete: () => t.destroy() });
}

// ---------- End of file ----------
