// ============================================================
// Blobby Run — Split-Screen Multiplayer Infinite Runner
// WebRTC peer-to-peer via PeerJS (no server required)
// ============================================================
(function () {
'use strict';

// --- Config ---
const GRAVITY = 2400;
const JUMP_VEL = -680;
const DOUBLE_JUMP_VEL = -580;
const BASE_SPEED = 260;
const SPEED_INC = 0.12;
const MAX_SPEED = 650;
const GROUND_RATIO = 0.30;
const PLAYER_SIZE = 40;
const OBS_GAP_MIN = 290;
const OBS_GAP_MAX = 460;
const COLLECT_CHANCE = 0.6;
const STAR_VAL = 10;
const GEM_VAL = 25;
const GEM_CHANCE = 0.25;
const CLOUD_N = 5;

const C = {
  skyTop:'#7ec8e3', skyBot:'#c9e8f5', cloud:'rgba(255,255,255,0.8)',
  hillFar:'#90d98c', hillNear:'#6abf69', ground:'#6abf69',
  groundDk:'#4a9e49', groundPat:'#5eae5d',
  p1:'#e0509e', p1Dk:'#c93d8e', p1Cheek:'#ffb3d0',
  p2:'#6ba4ff', p2Dk:'#4580e0', p2Cheek:'#b3d4ff',
  eyeW:'#fff', eyeP:'#2d1b4e',
  star:'#ffd700', starGlow:'rgba(255,215,0,0.3)',
  gem:'#a855f7', gemGlow:'rgba(168,85,247,0.3)',
  obsBase:'#8b5e3c', obsDk:'#6b4423', obsTop:'#4ade80',
  partLand:'#c5e8c4', partStar:'#ffd700', partGem:'#c084fc',
};

// --- Seeded RNG ---
function mulberry32(s){return function(){s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t^=t+Math.imul(t^t>>>7,61|t);return((t^t>>>14)>>>0)/4294967296;};}

// --- DOM ---
const $ = id => document.getElementById(id);
const menuScreen = $('menu-screen');
const lobbyScreen = $('lobby-screen');
const gameArea = $('game-area');
const gameOverScreen = $('game-over-screen');
const menuBgCanvas = $('menuBgCanvas');
const menuBgCtx = menuBgCanvas.getContext('2d');
const canvasTop = $('canvas-top');
const ctxTop = canvasTop.getContext('2d');
const canvasBot = $('canvas-bottom');
const ctxBot = canvasBot.getContext('2d');
const splitDiv = $('split-divider');
const splitBottom = $('split-bottom');

// --- Audio ---
let audioCtx = null, soundEnabled = true;
function initAudio(){if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume();}
function sfx(f,d,t='square',v=0.12){if(!soundEnabled||!audioCtx)return;try{const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type=t;o.frequency.setValueAtTime(f,audioCtx.currentTime);g.gain.setValueAtTime(v,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(0.001,audioCtx.currentTime+d);o.connect(g).connect(audioCtx.destination);o.start();o.stop(audioCtx.currentTime+d);}catch(e){}}
function sfxJump(){sfx(380,0.12,'sine',0.1);setTimeout(()=>sfx(520,0.08,'sine',0.08),40);}
function sfxDJump(){sfx(520,0.1,'sine',0.1);setTimeout(()=>sfx(700,0.1,'sine',0.08),50);}
function sfxCollect(){sfx(800,0.08,'sine',0.1);setTimeout(()=>sfx(1200,0.12,'sine',0.1),60);}
function sfxGem(){sfx(600,0.06,'sine',0.1);setTimeout(()=>sfx(900,0.06,'sine',0.08),50);setTimeout(()=>sfx(1400,0.15,'sine',0.1),100);}
function sfxHit(){sfx(200,0.2,'sawtooth',0.1);sfx(120,0.3,'square',0.06);}

// --- Utilities ---
function lerp(a,b,t){return a+(b-a)*t;}
function randRange(r,a,b){return r()*(b-a)+a;}
function randInt(r,a,b){return Math.floor(r()*(b-a+1))+a;}

// === GAME INSTANCE ===
class GameInstance {
  constructor(canvas, ctx, playerColor, rng) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.pColor = playerColor;
    this.rng = rng;
    this.W = 0; this.H = 0; this.groundY = 0; this.dpr = 1;
    this.reset();
  }

  reset() {
    const r = this.rng;
    this.score = 0; this.distance = 0; this.speed = BASE_SPEED;
    this.time = 0; this.alive = true;
    this.groundOff = 0; this.shakeT = 0; this.shakeI = 0; this.flashT = 0;
    this.player = this.makePlayer();
    this.obstacles = []; this.collectibles = []; this.particles = [];
    this.clouds = []; this.hills = [];
    for(let i=0;i<CLOUD_N;i++) this.clouds.push(this.makeCloud(randRange(r,0,this.W||800)));
    for(let i=0;i<3;i++){this.hills.push(this.makeHill(i*300,true));this.hills.push(this.makeHill(i*300+100,false));}
    let ox=(this.W||800)+500;
    for(let i=0;i<4;i++){
      this.obstacles.push(this.makeObs(ox));
      if(r()<COLLECT_CHANCE) this.collectibles.push(this.makeCol(ox+randRange(r,-40,40)));
      ox+=randRange(r,OBS_GAP_MIN,OBS_GAP_MAX);
    }
    this.opponentData = null;
  }

  resize(w, h) {
    this.dpr = Math.min(window.devicePixelRatio||1, 2);
    this.W = w; this.H = h;
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(this.dpr,0,0,this.dpr,0,0);
    this.groundY = h * (1 - GROUND_RATIO);
  }

  makePlayer(){return{x:0,y:0,w:PLAYER_SIZE,h:PLAYER_SIZE,vy:0,grounded:true,jumps:0,squash:1,stretch:1,eyeOff:0,runFrame:0,runT:0};}
  makeObs(x){const r=this.rng;const t=r()<0.4?'tall':'short';const w=t==='tall'?randInt(r,26,34):randInt(r,34,48);const h=t==='tall'?randInt(r,55,85):randInt(r,32,46);return{x,y:0,w,h,passed:false};}
  makeCol(x){const r=this.rng;const isG=r()<GEM_CHANCE;const floatH=60+r()*80;return{x,y:0,floatH,r:isG?13:11,type:isG?'gem':'star',collected:false,bob:r()*Math.PI*2,sparkle:0};}
  makeCloud(x){const r=this.rng;return{x,y:randRange(r,15,this.groundY?this.groundY*0.35:80),w:randRange(r,70,150),h:randRange(r,25,45),spd:randRange(r,0.15,0.4),op:randRange(r,0.5,0.85)};}
  makeHill(x,far){const r=this.rng;return{x,w:randRange(r,200,400),h:randRange(r,50,far?100:150),far};}

  spawnPart(x,y,n,col,sp,spd,life){for(let i=0;i<n;i++)this.particles.push({x,y,vx:(Math.random()-0.5)*sp,vy:-Math.random()*spd-spd*0.3,life:life+Math.random()*life*0.5,maxL:life+life*0.5,col,sz:3+Math.random()*4});}

  positionEntities() {
    this.player.x = this.W * 0.16;
    if (this.player.grounded) this.player.y = this.groundY - this.player.h;
    for (const o of this.obstacles) o.y = this.groundY - o.h;
  }

  jump() {
    const p = this.player;
    if (!this.alive) return;
    if (p.jumps < 2) {
      const dbl = p.jumps === 1;
      p.vy = dbl ? DOUBLE_JUMP_VEL : JUMP_VEL;
      p.grounded = false; p.jumps++;
      p.squash = 0.7; p.stretch = 1.3;
      if(dbl){sfxDJump();this.spawnPart(p.x+p.w/2,p.y+p.h,5,this.pColor==='p1'?C.p1Cheek:C.p2Cheek,120,80,0.3);}
      else{sfxJump();this.spawnPart(p.x+p.w/2,p.y+p.h,3,C.partLand,100,60,0.25);}
    }
  }

  update(dt) {
    if (!this.alive) return;
    const p = this.player;
    const r = this.rng;
    this.time += dt;
    this.speed = Math.min(BASE_SPEED + this.time * SPEED_INC * 60, MAX_SPEED);
    this.distance += this.speed * dt / 10;
    this.score = Math.floor(this.distance);

    if(!p.grounded) p.vy += GRAVITY * dt;
    p.y += p.vy * dt;
    if(p.y + p.h >= this.groundY){
      if(!p.grounded){p.squash=1.2;p.stretch=0.8;this.spawnPart(p.x+p.w/2,this.groundY,3,C.partLand,80,30,0.2);}
      p.y = this.groundY - p.h; p.vy = 0; p.grounded = true; p.jumps = 0;
    }
    p.squash = lerp(p.squash,1,dt*10);
    p.stretch = lerp(p.stretch,1,dt*10);
    if(p.grounded){p.runT+=dt*(this.speed/BASE_SPEED);if(p.runT>0.12){p.runT=0;p.runFrame=(p.runFrame+1)%4;}}
    p.eyeOff = p.grounded?2:(p.vy<0?-1:3);

    this.groundOff = (this.groundOff + this.speed*dt) % 40;

    for(const c of this.clouds){c.x-=(this.speed*0.1+c.spd*20)*dt;if(c.x+c.w<-50){c.x=this.W+randRange(r,50,200);c.y=randRange(r,15,this.groundY*0.35);c.w=randRange(r,70,150);}}
    for(const h of this.hills){h.x-=this.speed*(h.far?0.2:0.4)*dt;if(h.x+h.w<-50){h.x=this.W+randRange(r,50,300);h.h=randRange(r,50,h.far?100:150);h.w=randRange(r,200,400);}}

    for(const o of this.obstacles){o.x-=this.speed*dt;o.y=this.groundY-o.h;if(!o.passed&&o.x+o.w<p.x)o.passed=true;}
    this.obstacles=this.obstacles.filter(o=>o.x+o.w>-60);
    const last=this.obstacles[this.obstacles.length-1];
    if(!last||last.x<this.W){
      const nx=last?last.x+randRange(r,OBS_GAP_MIN,OBS_GAP_MAX):this.W+200;
      this.obstacles.push(this.makeObs(nx));
      if(r()<COLLECT_CHANCE)this.collectibles.push(this.makeCol(nx+randRange(r,-40,40)));
    }

    for(const col of this.collectibles){
      col.x-=this.speed*dt;col.bob+=dt*3;col.sparkle+=dt;
      col.y=this.groundY-col.floatH;
      if(!col.collected){
        const cy=col.y+Math.sin(col.bob)*6;
        if(this.circHit(col.x,cy,col.r,p.x+4,p.y+4,p.w-8,p.h-8)){
          col.collected=true;const v=col.type==='gem'?GEM_VAL:STAR_VAL;this.score+=v;
          if(col.type==='gem'){sfxGem();this.spawnPart(col.x,cy,10,C.partGem,180,150,0.5);}
          else{sfxCollect();this.spawnPart(col.x,cy,8,C.partStar,150,120,0.4);}
        }
      }
    }
    this.collectibles=this.collectibles.filter(c=>c.x>-30&&!c.collected);

    // collision
    for(const o of this.obstacles){
      const hb={x:p.x+5,y:p.y+3,w:p.w-10,h:p.h-5};
      const ob={x:o.x+3,y:o.y+3,w:o.w-6,h:o.h-3};
      if(hb.x<ob.x+ob.w&&hb.x+hb.w>ob.x&&hb.y<ob.y+ob.h&&hb.y+hb.h>ob.y){
        this.die(); return;
      }
    }

    for(const pt of this.particles){pt.x+=pt.vx*dt;pt.y+=pt.vy*dt;pt.vy+=400*dt;pt.life-=dt;}
    this.particles=this.particles.filter(p=>p.life>0);
    if(this.shakeT>0)this.shakeT-=dt;
    if(this.flashT>0)this.flashT-=dt;
  }

  die() {
    this.alive = false;
    sfxHit();
    this.shakeT = 0.35; this.shakeI = 8; this.flashT = 0.12;
    const p = this.player;
    this.spawnPart(p.x+p.w/2,p.y+p.h/2,10,this.pColor==='p1'?C.p1:C.p2,250,180,0.5);
  }

  circHit(cx,cy,cr,rx,ry,rw,rh){const nx=Math.max(rx,Math.min(cx,rx+rw)),ny=Math.max(ry,Math.min(cy,ry+rh));return(cx-nx)**2+(cy-ny)**2<cr*cr;}

  getState(){
    const p=this.player;
    return{x:Math.round(p.x),y:Math.round(p.y),vy:Math.round(p.vy),grounded:p.grounded,alive:this.alive,score:this.score,distance:Math.floor(this.distance)};
  }

  // === DRAWING ===
  draw() {
    const ctx = this.ctx;
    const W = this.W, H = this.H;
    ctx.save();
    if(this.shakeT>0){const i=this.shakeI*(this.shakeT/0.35);ctx.translate((Math.random()-0.5)*i*2,(Math.random()-0.5)*i*2);}

    // Sky
    const gr=ctx.createLinearGradient(0,0,0,this.groundY);gr.addColorStop(0,C.skyTop);gr.addColorStop(1,C.skyBot);ctx.fillStyle=gr;ctx.fillRect(0,0,W,H);

    // Clouds
    for(const c of this.clouds){ctx.globalAlpha=c.op;ctx.fillStyle=C.cloud;ctx.beginPath();ctx.ellipse(c.x+c.w*0.3,c.y+c.h*0.6,c.w*0.25,c.h*0.5,0,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.ellipse(c.x+c.w*0.55,c.y+c.h*0.35,c.w*0.3,c.h*0.55,0,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.ellipse(c.x+c.w*0.75,c.y+c.h*0.55,c.w*0.22,c.h*0.45,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;}

    // Hills
    for(const h of this.hills.filter(h=>h.far)){ctx.fillStyle=C.hillFar;ctx.beginPath();ctx.moveTo(h.x,this.groundY);ctx.quadraticCurveTo(h.x+h.w/2,this.groundY-h.h,h.x+h.w,this.groundY);ctx.fill();}
    for(const h of this.hills.filter(h=>!h.far)){ctx.fillStyle=C.hillNear;ctx.beginPath();ctx.moveTo(h.x,this.groundY);ctx.quadraticCurveTo(h.x+h.w/2,this.groundY-h.h,h.x+h.w,this.groundY);ctx.fill();}

    // Ground
    ctx.fillStyle=C.ground;ctx.fillRect(0,this.groundY,W,H-this.groundY);
    ctx.fillStyle=C.groundDk;ctx.fillRect(0,this.groundY,W,3);
    const off=this.groundOff;
    for(let x=-off;x<W+40;x+=40){ctx.beginPath();ctx.moveTo(x-4,this.groundY);ctx.lineTo(x,this.groundY-7);ctx.lineTo(x+4,this.groundY);ctx.fill();}
    ctx.fillStyle=C.groundPat;
    for(let x=-off;x<W+40;x+=40)ctx.fillRect(x,this.groundY+12,18,2);

    // Obstacles
    for(const o of this.obstacles) this.drawObs(ctx, o);

    // Collectibles
    for(const col of this.collectibles){if(!col.collected){if(col.type==='gem')this.drawGem(ctx,col);else this.drawStar(ctx,col);}}

    // Opponent ghost (if nearby)
    if(this.opponentData && this.opponentData.alive) {
      this.drawBlob(ctx, this.opponentData.x, this.opponentData.y, PLAYER_SIZE, this.pColor==='p1'?'p2':'p1', 0.4, 0);
    }

    // Player
    if(this.alive || this.flashT > 0)
      this.drawBlob(ctx, this.player.x, this.player.y, PLAYER_SIZE, this.pColor, 1, this.player.eyeOff, this.player.squash, this.player.stretch, this.player.grounded, this.player.runFrame);

    // Particles
    for(const pt of this.particles){const a=pt.life/pt.maxL;ctx.globalAlpha=a;ctx.fillStyle=pt.col;ctx.beginPath();ctx.arc(pt.x,pt.y,pt.sz*a,0,Math.PI*2);ctx.fill();}
    ctx.globalAlpha=1;

    if(this.flashT>0){ctx.fillStyle=`rgba(255,255,255,${this.flashT/0.12*0.25})`;ctx.fillRect(0,0,W,H);}
    ctx.restore();
  }

  drawBlob(ctx,bx,by,sz,pCol,alpha,eyeOff,sq=1,st=1,grounded=false,rf=0){
    const col = pCol==='p1' ? {body:C.p1,dk:C.p1Dk,cheek:C.p1Cheek} : {body:C.p2,dk:C.p2Dk,cheek:C.p2Cheek};
    const cx=bx+sz/2, cy=by+sz/2, bW=sz/2, bH=sz/2;
    ctx.save(); ctx.globalAlpha=alpha; ctx.translate(cx,cy); ctx.scale(sq,st);
    ctx.fillStyle='rgba(0,0,0,0.08)';ctx.beginPath();ctx.ellipse(1,bH+3,bW*0.75,3,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=col.body;ctx.beginPath();ctx.ellipse(0,2,bW,bH,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='rgba(255,255,255,0.25)';ctx.beginPath();ctx.ellipse(-bW*0.25,-bH*0.3,bW*0.3,bH*0.22,-0.3,0,Math.PI*2);ctx.fill();
    const es=8,ey=-2+(eyeOff||0)*0.3;
    ctx.fillStyle=C.eyeW;ctx.beginPath();ctx.ellipse(-es,ey,6,7,0,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.ellipse(es,ey,6,7,0,0,Math.PI*2);ctx.fill();
    const po=(eyeOff||0)*0.5;
    ctx.fillStyle=C.eyeP;ctx.beginPath();ctx.ellipse(-es+1.2,ey+po,3,3.5,0,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.ellipse(es+1.2,ey+po,3,3.5,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(-es-0.8,ey-2,1.5,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(es-0.8,ey-2,1.5,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=col.cheek;ctx.globalAlpha*=0.45;ctx.beginPath();ctx.ellipse(-es-4,ey+7,4,2.5,0,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.ellipse(es+4,ey+7,4,2.5,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=alpha;
    ctx.strokeStyle=col.dk;ctx.lineWidth=1.2;ctx.beginPath();ctx.arc(0,ey+8,3.5,0.15,Math.PI-0.15);ctx.stroke();
    if(grounded){const lo=[[- 6,0],[6,0],[-6,-3],[6,3]][rf];ctx.fillStyle=col.dk;ctx.beginPath();ctx.ellipse(-7+(lo[0]||0)*0.3,bH-2+(lo[1]||0)*0.2,4,3,0,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.ellipse(7-(lo[0]||0)*0.3,bH-2-(lo[1]||0)*0.2,4,3,0,0,Math.PI*2);ctx.fill();}
    ctx.restore();
  }

  drawObs(ctx,o){
    const gr=ctx.createLinearGradient(o.x,o.y,o.x+o.w,o.y);gr.addColorStop(0,C.obsBase);gr.addColorStop(0.5,'#a0724e');gr.addColorStop(1,C.obsDk);
    ctx.fillStyle=gr;ctx.beginPath();ctx.roundRect(o.x,o.y,o.w,o.h,[3,3,0,0]);ctx.fill();
    const br=o.w*0.65;ctx.fillStyle=C.obsTop;ctx.beginPath();ctx.ellipse(o.x+o.w/2,o.y-1,br,br*0.65,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='rgba(255,255,255,0.18)';ctx.beginPath();ctx.ellipse(o.x+o.w/2-2,o.y-br*0.25,br*0.35,br*0.25,0,0,Math.PI*2);ctx.fill();
  }

  drawStar(ctx,col){
    const cx=col.x,cy=col.y+Math.sin(col.bob)*5,r=col.r;
    ctx.fillStyle=C.starGlow;ctx.beginPath();ctx.arc(cx,cy,r*1.8,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=C.star;ctx.beginPath();
    for(let i=0;i<5;i++){const a1=(i*72-90)*Math.PI/180,a2=((i*72)+36-90)*Math.PI/180;ctx.lineTo(cx+Math.cos(a1)*r,cy+Math.sin(a1)*r);ctx.lineTo(cx+Math.cos(a2)*r*0.45,cy+Math.sin(a2)*r*0.45);}
    ctx.closePath();ctx.fill();
    const sp=(col.sparkle*3)%1;ctx.fillStyle=`rgba(255,255,255,${0.5*(1-sp)})`;ctx.beginPath();ctx.arc(cx+r*0.35,cy-r*0.35,1.5+sp*2,0,Math.PI*2);ctx.fill();
  }

  drawGem(ctx,col){
    const cx=col.x,cy=col.y+Math.sin(col.bob)*5,r=col.r;
    ctx.fillStyle=C.gemGlow;ctx.beginPath();ctx.arc(cx,cy,r*1.8,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=C.gem;ctx.beginPath();ctx.moveTo(cx,cy-r);ctx.lineTo(cx+r*0.7,cy);ctx.lineTo(cx,cy+r*0.8);ctx.lineTo(cx-r*0.7,cy);ctx.closePath();ctx.fill();
    ctx.fillStyle='rgba(255,255,255,0.35)';ctx.beginPath();ctx.moveTo(cx,cy-r);ctx.lineTo(cx+r*0.3,cy-r*0.2);ctx.lineTo(cx,cy);ctx.lineTo(cx-r*0.3,cy-r*0.2);ctx.closePath();ctx.fill();
  }
}


// === WEBRTC PEER-TO-PEER VIA PEERJS ===
let peer = null;       // PeerJS instance
let conn = null;       // DataConnection to the other player
let isHost = false;    // Did we create the room?
let myPlayer = 1;
let roomCode = '';
let peerReady = false;

// Generate a short 4-letter room code and derive a PeerJS id from it
const PEER_PREFIX = 'blobbyrun-';
function codeToPeerId(code) { return PEER_PREFIX + code.toUpperCase(); }

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O to avoid confusion
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function destroyPeer() {
  if (conn) { try { conn.close(); } catch(e){} conn = null; }
  if (peer) { try { peer.destroy(); } catch(e){} peer = null; }
  peerReady = false;
}

function peerSend(obj) {
  if (conn && conn.open) {
    conn.send(obj);
  }
}

function handlePeerData(raw) {
  let msg;
  try { msg = (typeof raw === 'string') ? JSON.parse(raw) : raw; } catch(e){ return; }

  switch(msg.type) {
    case 'game_start':
      seed = msg.seed;
      startMultiGame();
      break;
    case 'state':
      if (localInstance) localInstance.opponentData = msg.data;
      updateRemoteHUD(msg.data);
      break;
    case 'died':
      if (localInstance && localInstance.opponentData) localInstance.opponentData.alive = false;
      break;
    case 'restart':
      seed = msg.seed;
      startMultiGame();
      break;
  }
}

function setupConnection(c) {
  conn = c;
  conn.on('data', handlePeerData);
  conn.on('close', () => {
    conn = null;
    if (gameRunning) {
      if (localInstance) localInstance.opponentData = null;
      showMenuError('Opponent disconnected');
    }
  });
  conn.on('error', (err) => {
    showMenuError('Connection error: ' + (err.message || err));
  });
}

function createRoom() {
  destroyPeer();
  roomCode = generateCode();
  const peerId = codeToPeerId(roomCode);
  isHost = true;
  myPlayer = 1;

  showLobby(roomCode);
  $('lobby-status').textContent = 'Connecting...';

  peer = new Peer(peerId, { debug: 0 });

  peer.on('open', () => {
    peerReady = true;
    $('lobby-status').textContent = 'Waiting for Player 2';
  });

  peer.on('connection', (c) => {
    setupConnection(c);
    // Wait for connection to fully open before starting
    if (c.open) {
      startAsHost();
    } else {
      c.on('open', () => startAsHost());
    }
  });

  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      // Code collision — try another
      roomCode = generateCode();
      destroyPeer();
      createRoom();
    } else {
      showMenuError('Connection failed. Try again.');
      showScreen(menuScreen);
    }
  });
}

function startAsHost() {
  seed = Math.floor(Math.random() * 999999);
  $('lobby-status').textContent = 'Player 2 joined! Starting...';
  setTimeout(() => {
    peerSend({ type: 'game_start', seed });
    startMultiGame();
  }, 500);
}

function joinRoom(code) {
  destroyPeer();
  roomCode = code.toUpperCase();
  isHost = false;
  myPlayer = 2;

  const hostPeerId = codeToPeerId(roomCode);

  showLobby(roomCode);
  $('lobby-status').textContent = 'Connecting...';
  $('lobby-instruction').textContent = 'Joining room:';

  peer = new Peer(undefined, { debug: 0 }); // auto-generated id for joiner

  peer.on('open', () => {
    peerReady = true;
    const c = peer.connect(hostPeerId, { reliable: true });
    setupConnection(c);
    c.on('open', () => {
      // Connected — waiting for host to send game_start
      $('lobby-status').textContent = 'Connected! Waiting for host...';
    });
  });

  peer.on('error', (err) => {
    showScreen(menuScreen);
    if (err.type === 'peer-unavailable') {
      showMenuError('Room not found. Check the code.');
    } else {
      showMenuError('Connection failed. Try again.');
    }
  });
}


// === GAME MANAGER ===
let mode = 'solo';
let bestScore = 0;
let gameRunning = false;
let localInstance = null;
let remoteInstance = null;
let seed = 42;

// Menu bg clouds
let menuClouds = [];
for(let i=0;i<CLOUD_N;i++){menuClouds.push({x:Math.random()*800,y:10+Math.random()*100,w:60+Math.random()*120,h:20+Math.random()*35,spd:0.15+Math.random()*0.3,op:0.5+Math.random()*0.3});}

function resizeMenuBg(){
  const dpr=Math.min(devicePixelRatio||1,2);
  menuBgCanvas.width=innerWidth*dpr;menuBgCanvas.height=innerHeight*dpr;
  menuBgCanvas.style.width=innerWidth+'px';menuBgCanvas.style.height=innerHeight+'px';
  menuBgCtx.setTransform(dpr,0,0,dpr,0,0);
}

function drawMenuBg(dt){
  const ctx=menuBgCtx,W=innerWidth,H=innerHeight,gY=H*(1-GROUND_RATIO);
  const gr=ctx.createLinearGradient(0,0,0,gY);gr.addColorStop(0,C.skyTop);gr.addColorStop(1,C.skyBot);ctx.fillStyle=gr;ctx.fillRect(0,0,W,H);
  for(const c of menuClouds){c.x-=c.spd*20*dt;if(c.x+c.w<-50)c.x=W+50+Math.random()*150;ctx.fillStyle=C.cloud;ctx.globalAlpha=c.op;ctx.beginPath();ctx.ellipse(c.x+c.w*0.5,c.y+c.h*0.5,c.w*0.3,c.h*0.4,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;}
  ctx.fillStyle=C.ground;ctx.fillRect(0,gY,W,H-gY);ctx.fillStyle=C.groundDk;ctx.fillRect(0,gY,W,3);
}


// === UI Flow ===
function showScreen(screen) {
  menuScreen.classList.add('hidden');
  lobbyScreen.classList.add('hidden');
  gameArea.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
  screen.classList.remove('hidden');
}

function showMenuError(msg) {
  const el = $('menu-error');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

function showLobby(code) {
  $('room-code').textContent = code;
  showScreen(lobbyScreen);
}

function updateRemoteHUD(data) {
  if(!data) return;
  $('score-bottom').textContent = data.score || 0;
  $('dist-bottom').textContent = (data.distance||0) + 'm';
}

// === Start Game ===
function startSoloGame() {
  mode = 'solo';
  seed = Math.floor(Math.random()*999999);
  gameArea.classList.remove('hidden');
  gameArea.classList.add('solo-mode');
  menuScreen.classList.add('hidden');
  lobbyScreen.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
  splitDiv.classList.add('hidden');
  splitBottom.classList.add('hidden');

  const rng = mulberry32(seed);
  localInstance = new GameInstance(canvasTop, ctxTop, 'p1', rng);
  remoteInstance = null;
  gameRunning = true;
  resizeGame();
  localInstance.positionEntities();
}

function startMultiGame() {
  mode = 'multi';
  gameArea.classList.remove('hidden', 'solo-mode');
  menuScreen.classList.add('hidden');
  lobbyScreen.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
  splitDiv.classList.remove('hidden');
  splitBottom.classList.remove('hidden');

  const rng1 = mulberry32(seed);
  localInstance = new GameInstance(canvasTop, ctxTop, myPlayer===1?'p1':'p2', rng1);
  localInstance.opponentData = null;
  gameRunning = true;
  resizeGame();
  localInstance.positionEntities();

  // Update local HUD labels
  const topBadge = document.querySelector('#split-top .hud-badge');
  const topPLabel = document.querySelector('#split-top .hud-pill .hud-label');
  if(topBadge) { topBadge.textContent = 'YOU'; topBadge.className = `hud-badge ${myPlayer===1?'p1-badge':'p2-badge'}`; }
  if(topPLabel) topPLabel.textContent = myPlayer===1?'P1':'P2';
  const botBadge = document.querySelector('#split-bottom .hud-badge');
  const botPLabel = document.querySelector('#split-bottom .hud-pill .hud-label');
  if(botBadge) { botBadge.textContent = 'OPP'; botBadge.className = `hud-badge ${myPlayer===1?'p2-badge':'p1-badge'}`; }
  if(botPLabel) botPLabel.textContent = myPlayer===1?'P2':'P1';
}

function resizeGame() {
  const W = innerWidth;
  const fullH = innerHeight;
  if(mode === 'solo') {
    localInstance.resize(W, fullH);
  } else {
    const halfH = Math.floor((fullH - 3) / 2);
    localInstance.resize(W, halfH);
    const dpr = Math.min(devicePixelRatio||1,2);
    canvasBot.width = W * dpr; canvasBot.height = halfH * dpr;
    canvasBot.style.width = W+'px'; canvasBot.style.height = halfH+'px';
    ctxBot.setTransform(dpr,0,0,dpr,0,0);
  }
  if(localInstance) localInstance.positionEntities();
}

window.addEventListener('resize', () => {
  resizeMenuBg();
  if(gameRunning) resizeGame();
});
resizeMenuBg();

// === Input ===
function handleInput() {
  if(!gameRunning || !localInstance) return;
  if(gameOverScreen.classList.contains('hidden') === false) return;
  localInstance.jump();
}

document.addEventListener('keydown', (e) => {
  if(e.code==='Space'||e.code==='ArrowUp'){e.preventDefault();handleInput();}
});

canvasTop.addEventListener('touchstart',(e)=>{e.preventDefault();handleInput();},{passive:false});
canvasTop.addEventListener('mousedown',()=>handleInput());
canvasBot.addEventListener('touchstart',(e)=>{e.preventDefault();handleInput();},{passive:false});
canvasBot.addEventListener('mousedown',()=>handleInput());

// Sound toggle
$('sound-toggle').addEventListener('click',()=>{
  soundEnabled=!soundEnabled;
  $('sound-on-icon').classList.toggle('hidden',!soundEnabled);
  $('sound-off-icon').classList.toggle('hidden',soundEnabled);
});

// === Menu Buttons ===
$('solo-btn').addEventListener('click',()=>{initAudio();startSoloGame();});

$('create-btn').addEventListener('click',()=>{
  initAudio();
  createRoom();
});

$('join-btn').addEventListener('click',()=>{
  const code=$('code-input').value.trim().toUpperCase();
  if(code.length!==4){showMenuError('Enter a 4-letter code');return;}
  initAudio();
  joinRoom(code);
});

$('code-input').addEventListener('keydown',(e)=>{
  if(e.key==='Enter'){$('join-btn').click();}
});

$('lobby-cancel').addEventListener('click',()=>{
  destroyPeer();
  $('lobby-instruction').textContent = 'Share this code with a friend:';
  showScreen(menuScreen);
});

$('restart-btn').addEventListener('click',()=>{
  gameOverScreen.classList.add('hidden');
  if(mode==='multi'){
    seed = Math.floor(Math.random() * 999999);
    peerSend({type:'restart', seed});
    startMultiGame();
  } else {
    startSoloGame();
  }
});

$('back-menu-btn').addEventListener('click',()=>{
  gameRunning=false;
  destroyPeer();
  gameOverScreen.classList.add('hidden');
  gameArea.classList.add('hidden');
  showScreen(menuScreen);
});

// === Game Over ===
function showGameOver() {
  const s = localInstance;
  $('final-score').textContent = s.score;
  $('final-distance').textContent = Math.floor(s.distance)+'m';
  if(s.score > bestScore) bestScore = s.score;
  $('best-score').textContent = bestScore;

  if(mode==='multi' && s.opponentData) {
    $('opp-score-row').classList.remove('hidden');
    $('final-opp-score').textContent = s.opponentData.score || '?';
    const won = s.score >= (s.opponentData.score||0);
    $('gameover-title').textContent = won ? 'You Win!' : 'You Lost';
  } else {
    $('opp-score-row').classList.add('hidden');
    $('gameover-title').textContent = 'Game Over';
  }

  gameOverScreen.classList.remove('hidden');
}

// === Draw Remote Half ===
function drawRemoteHalf() {
  const ctx = ctxBot;
  const W = canvasBot.width / (Math.min(devicePixelRatio||1,2));
  const H = canvasBot.height / (Math.min(devicePixelRatio||1,2));
  const gY = H * (1 - GROUND_RATIO);

  const gr=ctx.createLinearGradient(0,0,0,gY);gr.addColorStop(0,C.skyTop);gr.addColorStop(1,C.skyBot);ctx.fillStyle=gr;ctx.fillRect(0,0,W,H);

  ctx.fillStyle=C.cloud;ctx.globalAlpha=0.6;
  ctx.beginPath();ctx.ellipse(W*0.15,30,60,20,0,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.ellipse(W*0.6,50,80,25,0,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.ellipse(W*0.85,20,50,18,0,0,Math.PI*2);ctx.fill();
  ctx.globalAlpha=1;

  ctx.fillStyle=C.hillFar;ctx.beginPath();ctx.moveTo(0,gY);ctx.quadraticCurveTo(W*0.3,gY-80,W*0.6,gY);ctx.fill();
  ctx.fillStyle=C.hillNear;ctx.beginPath();ctx.moveTo(W*0.4,gY);ctx.quadraticCurveTo(W*0.7,gY-60,W,gY);ctx.fill();

  ctx.fillStyle=C.ground;ctx.fillRect(0,gY,W,H-gY);
  ctx.fillStyle=C.groundDk;ctx.fillRect(0,gY,W,3);

  const oppData = localInstance ? localInstance.opponentData : null;
  if(oppData) {
    const oppCol = myPlayer===1?'p2':'p1';
    const bx = W*0.16;
    const by = oppData.grounded ? gY - PLAYER_SIZE : Math.min(oppData.y * (H / (localInstance.H||H)), gY - PLAYER_SIZE);
    const inst = new GameInstance(canvasBot, ctxBot, oppCol, mulberry32(1));
    inst.drawBlob(ctx, bx, by, PLAYER_SIZE, oppCol, oppData.alive ? 1 : 0.3, 0, 1, 1, oppData.grounded, 0);
  } else {
    ctx.fillStyle='rgba(45,27,78,0.3)';ctx.font='500 14px General Sans, sans-serif';ctx.textAlign='center';
    ctx.fillText('Waiting for opponent...', W/2, H/2);
  }
}

// === Main Loop ===
let lastTime = 0;
let stateTimer = 0;

function loop(ts) {
  const dt = Math.min((ts - lastTime)/1000, 0.1);
  lastTime = ts;

  if(!gameRunning) {
    if(!menuScreen.classList.contains('hidden')) {
      drawMenuBg(dt);
    }
    requestAnimationFrame(loop);
    return;
  }

  // Update local
  if(localInstance && localInstance.alive) {
    localInstance.update(dt);

    // Send state to peer periodically
    if(mode==='multi') {
      stateTimer += dt;
      if(stateTimer > 0.05) { // 20fps sync
        stateTimer = 0;
        peerSend({type:'state', data: localInstance.getState()});
      }
    }

    // Update local HUD
    $('score-top').textContent = localInstance.score;
    $('dist-top').textContent = Math.floor(localInstance.distance)+'m';
  }

  // Check death
  if(localInstance && !localInstance.alive && gameOverScreen.classList.contains('hidden')) {
    if(mode==='multi') peerSend({type:'died'});
    setTimeout(showGameOver, 500);
  }

  // Draw
  if(localInstance) localInstance.draw();
  if(mode==='multi') drawRemoteHalf();

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

// === Test hooks ===
window.render_game_to_text = function(){
  if(!localInstance) return JSON.stringify({phase:'menu'});
  return JSON.stringify({phase:gameRunning?(localInstance.alive?'playing':'dead'):'menu',mode,score:localInstance.score,distance:Math.floor(localInstance.distance),alive:localInstance.alive,opponent:localInstance.opponentData});
};
window.advanceTime = function(ms){if(!localInstance)return;const steps=Math.max(1,Math.round(ms/(1000/60)));for(let i=0;i<steps;i++)localInstance.update(1/60);localInstance.draw();};

})();
