// src/app/admin/(app)/stories/_a6/download.ts — T3.10.U1: how Export hands the zip to the browser. A signed link
// (staging, production) is opened in place: its Content-Disposition makes it a download, so the page stays. A zip
// answered inline (the prototype) is saved through an object URL.

export function openLink(url: string): void {
  window.location.assign(url);
}

export function saveFile(blob: Blob, name: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 0);
}
