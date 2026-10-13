const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
async function nativeCapture(target) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cue-scan-'));
  try {
    const file = path.join(dir, 'screen.png');
    const { x, y, width, height } = target.bounds;
    await execFile('/usr/sbin/screencapture', ['-x', '-R', `${x},${y},${width},${height}`, file], { timeout: 15000 });
    const data = await fs.readFile(file);
    if (!data.length) throw new Error('Native capture returned an empty image.');
    return { name: 'Screen capture', dataUrl: `data:image/png;base64,${data.toString('base64')}` };
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
function createCapture({ capturer, screen, windows, permission, platform = process.platform, fallback = nativeCapture, log = () => {}, delay = () => new Promise(r => setTimeout(r, 250)) }) {
  let active = false;
  return async function scan() {
    if (active) throw new Error('A screen capture is already in progress.');
    active = true;
    const visible = [];
    let target;
    let status = 'unknown';
    try {
      status = platform === 'darwin' ? permission() : 'not-applicable';
      target = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      log({ event: 'scan-start', permission: status, displayId: target.id, bounds: target.bounds, platform });
      for (const win of windows()) if (!win.isDestroyed() && win.isVisible()) { visible.push(win); win.hide(); }
      await delay();
      try {
        const sources = await capturer.getSources({ types: ['screen'], thumbnailSize: { width: 2880, height: 1800 } });
        log({ event: 'scan-sources', count: sources.length, displayIds: sources.map(s => s.display_id) });
        const source = sources.find(s => s.display_id === String(target.id)) || (sources.length === 1 ? sources[0] : null);
        if (!source || source.thumbnail.isEmpty()) throw new Error('No usable thumbnail for the selected display.');
        log({ event: 'scan-success', method: 'electron' });
        return { name: source.name, dataUrl: source.thumbnail.toDataURL() };
      } catch (error) {
        log({ event: 'scan-electron-failed', message: error.message, stack: error.stack });
        if (platform !== 'darwin' || status === 'denied' || status === 'restricted') throw error;
        const image = await fallback(target);
        log({ event: 'scan-success', method: 'screencapture' });
        return image;
      }
    } catch (error) {
      log({ event: 'scan-failed', permission: status, message: error.message, stack: error.stack });
      const guidance = platform === 'darwin'
        ? 'Open System Settings → Privacy & Security → Screen & System Audio Recording (or Screen Recording). Enable Cue; when running from source, the entry may be Electron. Fully quit and reopen it. If already enabled, toggle the permission off and on, then restart.'
        : 'Check screen-capture permissions and your desktop session. Linux Wayland may require a working screen-sharing portal.';
      throw new Error(`Screen capture failed (permission: ${status}). ${guidance} Technical reason: ${error.message}. Open the capture log in Cue settings for details.`);
    } finally {
      active = false;
      for (const win of visible) if (!win.isDestroyed()) win.showInactive();
    }
  };
}
module.exports = { createCapture, nativeCapture };
