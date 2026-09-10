import { Hono } from "hono";
import type { AppEnv } from "../app.js";

const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>Maester dev upload</title>
<style>body{font:14px system-ui;margin:2rem;max-width:720px}pre{background:#f4f4f4;padding:.5rem;overflow:auto}label{display:block;margin:.5rem 0}</style>
<h1>Maester dev upload</h1>
<fieldset><legend>1. Session</legend>
<label>Email <input id="email" value="dev@example.com"></label>
<label>Password <input id="password" type="password" value="correct-horse-battery"></label>
<button id="signup">Sign up</button> <button id="signin">Sign in</button> <span id="who"></span>
</fieldset>
<fieldset><legend>2. Upload</legend>
<input type="file" id="file" accept="application/pdf"> <button id="upload">Upload and verify</button>
</fieldset>
<h3>Log</h3><pre id="log"></pre>
<script>
const log = (m) => { document.getElementById('log').textContent += m + "\\n"; };
const j = async (url, body) => {
  const res = await fetch(url, { method: body ? 'POST' : 'GET', credentials: 'include',
    headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(res.status + ' ' + JSON.stringify(data));
  return data;
};
let workspaceId = null;
async function me() { const m = await j('/v1/me'); workspaceId = m.workspaces[0].id; document.getElementById('who').textContent = m.user.email + ' / ' + workspaceId; }
document.getElementById('signup').onclick = async () => {
  await j('/api/auth/sign-up/email', { name: 'Dev', email: email.value, password: password.value }); await me(); log('signed up');
};
document.getElementById('signin').onclick = async () => {
  await j('/api/auth/sign-in/email', { email: email.value, password: password.value }); await me(); log('signed in');
};
document.getElementById('upload').onclick = async () => {
  const f = document.getElementById('file').files[0]; if (!f) return log('choose a file');
  const created = await j('/v1/workspaces/' + workspaceId + '/documents/uploads', { originalName: f.name, size: f.size, mimeType: 'application/pdf' });
  log('document ' + created.document.id);
  const put = await fetch(created.upload.url, { method: 'PUT', headers: created.upload.headers, body: f });
  if (!put.ok) return log('PUT failed ' + put.status);
  const fin = await j('/v1/workspaces/' + workspaceId + '/documents/' + created.document.id + '/finalize', {});
  log('job ' + fin.job.id + ' ' + fin.job.state);
  const es = new EventSource('/v1/workspaces/' + workspaceId + '/jobs/' + fin.job.id + '/events', { withCredentials: true });
  es.addEventListener('job', (e) => { const job = JSON.parse(e.data); log('job ' + job.state + ' ' + JSON.stringify(job.progress)); });
  es.addEventListener('done', async () => { es.close(); const d = await j('/v1/workspaces/' + workspaceId + '/documents/' + created.document.id); log('document ' + d.state + ' sha256=' + d.contentSha256 + ' rejection=' + d.rejectionCode); });
};
</script>`;

export function devRoutes() {
  const r = new Hono<AppEnv>();
  r.get("/upload", (c) => c.html(PAGE));
  return r;
}
