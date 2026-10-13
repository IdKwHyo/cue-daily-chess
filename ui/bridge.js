let token;
export async function call(action, payload) {
  if (window.desktop) return window.desktop.call(action, payload);
  if (!token) token = (await (await fetch('/api/bootstrap')).json()).token;
  const response = await fetch('/api/call', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cue-token': token }, body: JSON.stringify({ action, payload }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
export async function scan() {
  if (window.desktop) return window.desktop.scan();
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('One-button capture requires the Cue desktop app. You can still paste an image here.');
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  const video = document.createElement('video');
  try {
    video.srcObject = stream; video.muted = true; await video.play();
    await new Promise(resolve => video.requestVideoFrameCallback ? video.requestVideoFrameCallback(resolve) : setTimeout(resolve, 250));
    const scale = Math.min(1, 2880 / video.videoWidth);
    const canvas = document.createElement('canvas'); canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return { name: 'Screen capture', dataUrl: canvas.toDataURL('image/png') };
  } finally { stream.getTracks().forEach(t => t.stop()); video.srcObject = null; }
}
export function mediaFromUrl(dataUrl, name = 'Screenshot') {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl);
  if (!match) throw new Error('Unsupported image. Use PNG, JPEG or WebP.');
  return { mimeType: match[1], data: match[2], dataUrl, name };
}
export async function fileImage(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Use a PNG, JPEG, or WebP image.');
  if (file.size > 8 * 1024 * 1024) throw new Error('Each image must be under 8 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2880 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return mediaFromUrl(canvas.toDataURL('image/png'), file.name || 'Pasted image');
  } finally { bitmap.close(); }
}
