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
  return '<div class="empty-answer"><div class="empty-symbol" aria-hidden="true">✳</div><h3>A clearer way forward.</h3><p>Your answer, explanation, and things to double-check will appear here.</p><div class="empty-steps"><span>01 &nbsp; Bring in a question</span><span>02 &nbsp; Get a useful perspective</span><span>03 &nbsp; Review and make it yours</span></div></div>';
}
