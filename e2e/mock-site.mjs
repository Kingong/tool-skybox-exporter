import http from 'node:http';

export const PORT = 18777;
// 最小合法 JPEG（1x1 红像素）
export const FAKE_JPG_B64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wgARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQBAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhADEAAAAT8f/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=';

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Mock Skybox</title></head><body>
<div id="app">Mock Skybox Viewer</div>
<script>
  fetch('/api/proxy?url=' + encodeURIComponent('https://backend.blockadelabs.com/api/v1/imagine/requests/123456'))
    .then(function (r) { return r.json(); })
    .then(function (j) { var img = new Image(); img.src = j.request.file_url; document.body.appendChild(img); });
</script>
</body></html>`;

export function startMockSite() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
    if (u.pathname === '/') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(page);
    } else if (u.pathname === '/api/proxy') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        request: {
          id: 123456,
          obfuscated_id: 'mockobfuscated',
          title: 'Mock Panorama',
          status: 'complete',
          file_url: `http://127.0.0.1:${PORT}/fake-image.jpg`,
          thumb_url: `http://127.0.0.1:${PORT}/fake-image.jpg`,
        },
      }));
    } else if (u.pathname === '/fake-image.jpg') {
      res.setHeader('content-type', 'image/jpeg');
      res.end(Buffer.from(FAKE_JPG_B64, 'base64'));
    } else {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startMockSite().then(() => console.log(`mock site on http://127.0.0.1:${PORT}`));
}
