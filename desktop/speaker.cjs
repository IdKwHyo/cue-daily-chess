const { spawn } = require('node:child_process');
function createSpeaker({ spawnImpl = spawn } = {}) {
  let process;
  return {
    stop() { process?.kill(); process = null; return { stopped: true }; },
    speak(text) {
      if (typeof text !== 'string' || !text.trim() || text.length > 60000) throw new Error('Select an answer of up to 60,000 characters to read.');
      this.stop();
      return new Promise((resolve, reject) => {
        // Text goes over stdin, never shell interpolation or command-line arguments.
        const child = spawnImpl('/usr/bin/say', [], { stdio: ['pipe', 'ignore', 'ignore'] });
        process = child;
        child.on('error', () => { if (process === child) process = null; reject(new Error('System voice is unavailable. Check your Mac’s voice settings.')); });
        child.on('exit', (code, signal) => { if (process === child) process = null; if (code && !signal) reject(new Error('The system voice could not read this answer.')); else resolve({ finished: !signal }); });
        child.stdin.on('error', () => {}); child.stdin.end(text);
      });
    }
  };
}
module.exports = { createSpeaker };
