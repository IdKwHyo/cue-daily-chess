export const STORAGE_KEY = 'cue.daily.session.v1';
export const KIND_LABELS = { auto: 'Auto-detect', 'multiple-choice': 'Multiple choice', written: 'Written response', numerical: 'Numerical reasoning', coding: 'Coding problem', situational: 'Situational judgment' };
export function question(text = '', kind = 'auto') {
  return { id: crypto.randomUUID(), text, kind, draft: '', answer: '', followups: [], flagged: false, reviewed: false, sample: false, stale: false, usage: 0 };
}
export function freshWorkspace() { const q = question(); return { title: '', items: [q], selected: q.id }; }
export function initialState() {
  return { version: 1, mode: 'daily', context: '', preferences: { language: 'English', codeLanguage: 'Python', autoAnswer: true }, workspaces: { daily: freshWorkspace(), chess: freshWorkspace() } };
}
export function parseSession(value) {
  if (!value || value.version !== 1 || !value.workspaces) throw new Error('This is not a Cue Daily session export.');
  const state = initialState();
  state.mode = value.mode === 'chess' ? 'chess' : 'daily';
  state.context = typeof value.context === 'string' ? value.context.slice(0, 12000) : '';
  for (const key of ['language', 'codeLanguage']) if (typeof value.preferences?.[key] === 'string') state.preferences[key] = value.preferences[key].slice(0, 40);
  state.preferences.autoAnswer = value.preferences?.autoAnswer !== false;
  for (const mode of ['daily', 'chess']) {
    const w = value.workspaces[mode];
    if (!w || !Array.isArray(w.items) || w.items.length > 100) throw new Error('Invalid session: each workspace supports up to 100 questions.');
    const oldIndex = w.items.findIndex(q => q.id === w.selected);
    const items = w.items.map(q => {
      if (!q || typeof q.text !== 'string') throw new Error('Invalid question in session.');
      const clean = question(q.text.slice(0, 30000), Object.hasOwn(KIND_LABELS, q.kind) ? q.kind : 'auto');
      for (const key of ['draft', 'answer']) clean[key] = typeof q[key] === 'string' ? q[key].slice(0, 60000) : '';
      clean.flagged = q.flagged === true; clean.reviewed = q.reviewed === true; clean.sample = q.sample === true;
      clean.stale = q.stale === true;
      clean.followups = (Array.isArray(q.followups) ? q.followups : []).slice(-20).filter(f => typeof f?.question === 'string' && typeof f?.answer === 'string').map(f => ({ question: f.question.slice(0, 3000), answer: f.answer.slice(0, 30000) }));
      clean.usage = Number.isFinite(q.usage) ? Math.max(0, q.usage) : 0;
      return clean;
    });
    if (!items.length) items.push(question());
    state.workspaces[mode] = { title: typeof w.title === 'string' ? w.title.slice(0, 100) : '', items, selected: items[Math.max(0, oldIndex)]?.id || items[0].id };
  }
  return state;
}
export function exportSession(state) {
  const safe = parseSession(state);
  return JSON.stringify({ ...safe, exportedAt: new Date().toISOString() }, null, 2);
}
export function samples() {
  const q = question('Help me write a short message asking to reschedule dinner to tomorrow.', 'written');
  q.sample = true;
  q.answer = 'Hey, could we move dinner to tomorrow? Something came up tonight. Let me know what time works for you.';
  return [q];
}
