/**
 * Multiplayer connection tests for Blobby Run.
 *
 * Uses jsdom (via jest) + jest-canvas-mock so game.js can be eval'd in a
 * browser-like environment. Each test gets a fresh DOM + fresh Peer mock.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const GAME_JS = fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8');

// ---------------------------------------------------------------------------
// Mock Peer class returned to each test
// ---------------------------------------------------------------------------
class MockConnection {
  constructor() {
    this.open = false;
    this._handlers = {};
    this.sent = [];
  }
  on(event, fn) { this._handlers[event] = fn; return this; }
  send(data) { this.sent.push(data); }
  close() { this.open = false; }
  // Test helpers
  triggerOpen() { this.open = true; this._handlers.open?.(); }
  triggerData(data) { this._handlers.data?.(data); }
  triggerClose() { this._handlers.close?.(); }
}

class MockPeer {
  constructor(id, opts) {
    this.id = id;
    this.opts = opts;
    this._handlers = {};
    this.destroyed = false;
    MockPeer.instances.push(this);
  }
  on(event, fn) { this._handlers[event] = fn; return this; }
  connect(peerId) {
    this.lastConn = new MockConnection();
    this.lastConn.peer = peerId;
    return this.lastConn;
  }
  destroy() { this.destroyed = true; }
  // Test helpers
  triggerOpen() { this._handlers.open?.(this.id); }
  triggerConnection(conn) { this._handlers.connection?.(conn); }
  triggerError(err) { this._handlers.error?.(err); }
}

// ---------------------------------------------------------------------------
// Helper: reset DOM and load game.js fresh for each test
// ---------------------------------------------------------------------------
function loadGame() {
  // Re-parse the full HTML into jsdom
  document.documentElement.innerHTML =
    HTML.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1];

  MockPeer.instances = [];
  window.Peer = MockPeer;

  // Stub requestAnimationFrame so the game loop doesn't spin
  window.requestAnimationFrame = jest.fn();

  // Stub Web Audio API (not supported by jsdom)
  const mockAudioNode = { connect: () => mockAudioNode };
  const mockAudioCtx = {
    state: 'running',
    currentTime: 0,
    resume: jest.fn(),
    createOscillator: () => ({ type: '', frequency: { setValueAtTime: jest.fn() }, connect: () => mockAudioNode, start: jest.fn(), stop: jest.fn() }),
    createGain: () => ({ gain: { setValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() }, connect: () => mockAudioNode }),
    destination: {},
  };
  window.AudioContext = jest.fn(() => mockAudioCtx);
  window.webkitAudioContext = window.AudioContext;

  // eval runs the IIFE in the current jsdom window context
  // eslint-disable-next-line no-eval
  eval(GAME_JS);
}

// ---------------------------------------------------------------------------
// 1. DOM STRUCTURE
// ---------------------------------------------------------------------------
describe('DOM structure', () => {
  beforeEach(loadGame);

  test('lobby-instruction has an id so getElementById can find it', () => {
    const el = document.getElementById('lobby-instruction');
    expect(el).not.toBeNull();
  });

  test('all required element ids are present', () => {
    const ids = [
      'menu-screen', 'lobby-screen', 'game-area', 'game-over-screen',
      'lobby-status', 'lobby-instruction', 'room-code', 'lobby-cancel',
      'solo-btn', 'create-btn', 'join-btn', 'code-input',
      'menu-error', 'score-top', 'dist-top',
    ];
    ids.forEach(id => {
      expect(document.getElementById(id)).not.toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// 2. PURE FUNCTIONS (via window._testExports set at end of IIFE)
// ---------------------------------------------------------------------------
describe('generateCode', () => {
  beforeEach(loadGame);

  const { VALID_CHARS_REGEX } = { VALID_CHARS_REGEX: /^[ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/ };

  test('returns exactly 4 characters', () => {
    const code = window._testExports.generateCode();
    expect(code).toHaveLength(4);
  });

  test('contains only valid uppercase letters (no I or O)', () => {
    for (let i = 0; i < 50; i++) {
      const code = window._testExports.generateCode();
      expect(code).toMatch(VALID_CHARS_REGEX);
      expect(code).not.toMatch(/[IO]/);
    }
  });

  test('produces different codes across calls', () => {
    const codes = new Set(Array.from({ length: 20 }, () => window._testExports.generateCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe('codeToPeerId', () => {
  beforeEach(loadGame);

  test('prepends the blobbyrun- prefix', () => {
    const id = window._testExports.codeToPeerId('ABCD');
    expect(id).toBe('blobbyrun-ABCD');
  });

  test('uppercases the code', () => {
    const id = window._testExports.codeToPeerId('abcd');
    expect(id).toBe('blobbyrun-ABCD');
  });

  test('PEER_PREFIX matches what codeToPeerId uses', () => {
    const code = 'TEST';
    expect(window._testExports.codeToPeerId(code)).toBe(
      window._testExports.PEER_PREFIX + code
    );
  });
});

// ---------------------------------------------------------------------------
// 3. createRoom flow
// ---------------------------------------------------------------------------
describe('createRoom', () => {
  beforeEach(loadGame);

  test('shows lobby screen immediately', () => {
    document.getElementById('create-btn').click();
    const lobby = document.getElementById('lobby-screen');
    expect(lobby.classList.contains('hidden')).toBe(false);
  });

  test('creates a Peer with a blobbyrun- prefixed id', () => {
    document.getElementById('create-btn').click();
    expect(MockPeer.instances).toHaveLength(1);
    expect(MockPeer.instances[0].id).toMatch(/^blobbyrun-[A-Z]{4}$/);
  });

  test('displays a 4-letter room code in the lobby', () => {
    document.getElementById('create-btn').click();
    const code = document.getElementById('room-code').textContent;
    expect(code).toMatch(/^[A-Z]{4}$/);
  });

  test('shows "Waiting for Player 2" after peer opens', () => {
    document.getElementById('create-btn').click();
    MockPeer.instances[0].triggerOpen();
    expect(document.getElementById('lobby-status').textContent).toBe('Waiting for Player 2');
  });
});

// ---------------------------------------------------------------------------
// 4. joinRoom flow — this is where the lobby-instruction bug lived
// ---------------------------------------------------------------------------
describe('joinRoom', () => {
  beforeEach(loadGame);

  function triggerJoin(code = 'ABCD') {
    document.getElementById('code-input').value = code;
    document.getElementById('join-btn').click();
  }

  test('does NOT throw when clicking join (lobby-instruction id bug)', () => {
    expect(() => triggerJoin()).not.toThrow();
  });

  test('shows lobby screen immediately', () => {
    triggerJoin();
    expect(document.getElementById('lobby-screen').classList.contains('hidden')).toBe(false);
  });

  test('sets lobby-instruction text to joining message', () => {
    triggerJoin();
    expect(document.getElementById('lobby-instruction').textContent).toBe('Joining room:');
  });

  test('creates a Peer (peer is actually constructed)', () => {
    triggerJoin();
    expect(MockPeer.instances).toHaveLength(1);
  });

  test('connects to the correct host peer id after peer opens', () => {
    triggerJoin('ABCD');
    MockPeer.instances[0].triggerOpen();
    expect(MockPeer.instances[0].lastConn.peer).toBe('blobbyrun-ABCD');
  });

  test('updates status when connection opens', () => {
    triggerJoin();
    MockPeer.instances[0].triggerOpen();
    MockPeer.instances[0].lastConn.triggerOpen();
    expect(document.getElementById('lobby-status').textContent).toContain('Waiting for host');
  });

  test('shows menu and error when room not found', () => {
    triggerJoin();
    MockPeer.instances[0].triggerError({ type: 'peer-unavailable' });
    expect(document.getElementById('menu-screen').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('menu-error').textContent).toMatch(/not found/i);
  });

  test('shows menu and error on generic connection failure', () => {
    triggerJoin();
    MockPeer.instances[0].triggerError({ type: 'network' });
    expect(document.getElementById('menu-screen').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('menu-error').textContent).toMatch(/failed/i);
  });

  test('rejects codes shorter than 4 characters', () => {
    triggerJoin('AB');
    // No Peer should be created — validation should bail out first
    expect(MockPeer.instances).toHaveLength(0);
    expect(document.getElementById('lobby-screen').classList.contains('hidden')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Cancel button
// ---------------------------------------------------------------------------
describe('cancel button', () => {
  beforeEach(loadGame);

  test('does NOT throw (lobby-instruction id bug)', () => {
    // First open the lobby
    document.getElementById('create-btn').click();
    expect(() => document.getElementById('lobby-cancel').click()).not.toThrow();
  });

  test('returns to the menu screen', () => {
    document.getElementById('create-btn').click();
    document.getElementById('lobby-cancel').click();
    expect(document.getElementById('menu-screen').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('lobby-screen').classList.contains('hidden')).toBe(true);
  });

  test('destroys the peer', () => {
    document.getElementById('create-btn').click();
    const peer = MockPeer.instances[0];
    document.getElementById('lobby-cancel').click();
    expect(peer.destroyed).toBe(true);
  });

  test('resets lobby-instruction text for next use', () => {
    // Join first so instruction text changes
    document.getElementById('code-input').value = 'ABCD';
    document.getElementById('join-btn').click();
    expect(document.getElementById('lobby-instruction').textContent).toBe('Joining room:');

    document.getElementById('lobby-cancel').click();
    document.getElementById('create-btn').click();
    // Should be back to host message
    expect(document.getElementById('lobby-instruction').textContent).toBe('Share this code with a friend:');
  });
});
