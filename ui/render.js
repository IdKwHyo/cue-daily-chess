export const escape = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function inline(text) {
  return escape(text).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}
export function markdown(text) {
  const lines = String(text).split('\n');
  let output = '', code = null, list = null;
  const endList = () => { if (list) output += `</${list}>`; list = null; };
  for (const line of lines) {
    if (line.startsWith('```')) { endList(); if (code !== null) { output += `<pre><code>${escape(code.join('\n'))}</code></pre>`; code = null; } else code = []; continue; }
    if (code !== null) { code.push(line); continue; }
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) { endList(); output += `<h3>${inline(heading[1])}</h3>`; continue; }
    const bullet = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/);
    if (bullet) { const type = /^\s*\d/.test(line) ? 'ol' : 'ul'; if (list !== type) { endList(); output += `<${type}>`; list = type; } output += `<li>${inline(bullet[1])}</li>`; continue; }
    endList(); if (line.trim()) output += `<p>${inline(line)}</p>`;
  }
  endList(); if (code !== null) output += `<pre><code>${escape(code.join('\n'))}</code></pre>`;
  return output;
}
export function emptyAnswer() {
  return '<div class="empty-answer"><h3>What’s on your mind?</h3><p>Type a message, use the mic, or capture your screen.</p></div>';
}
