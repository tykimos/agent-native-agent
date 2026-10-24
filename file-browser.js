'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream');
const MAX_UPLOAD = 25 * 1024 * 1024;
const fail = (status, message) => Object.assign(new Error(message), { status });

// roots: a folder path (one writable root), or { key: { dir, label, write, deny: ['.ana', …], mkdir } }.
// The first key is the default. Requests pick one with ?root=key.
function createFileBrowser(rootsIn, core, hooks = {}) {
  const roots = typeof rootsIn === 'string' ? { files: { dir: rootsIn, write: true } } : rootsIn;
  const keys = Object.keys(roots);
  // dir는 문자열 또는 함수(요청마다 정해지는 폴더 — 예: 지금 워크스페이스의 files)
  const rootOf = (key) => {
    const k = key && roots[key] ? key : keys[0], r = roots[k], dir = typeof r.dir === 'function' ? r.dir() : r.dir;
    if (r.mkdir) fs.mkdirSync(dir, { recursive: true });
    return { key: k, ...r, dir, base: fs.realpathSync(dir) };
  };
  if (typeof rootsIn === 'string') rootOf(keys[0]);   // a missing single root still fails at start-up, as before
  let base;
  // Reject links at every component, including links that currently point inside.
  function resolve(relative = '') {
    if (typeof relative !== 'string' || relative.includes('\\') || relative.includes('\0') || path.isAbsolute(relative)) throw fail(403, 'Access outside the designated folder is not allowed.');
    const parts = relative ? relative.split('/') : [];
    if (parts.some(p => !p || p === '.' || p === '..')) throw fail(403, 'Invalid path.');
    let target = base;
    for (const part of parts) {
      target = path.join(target, part);
      if (fs.lstatSync(target).isSymbolicLink()) throw fail(403, 'Symbolic links cannot be accessed.');
    }
    return target;
  }
  return async function fileApi(req, res, url) {
    if (!['/api/files', '/api/files/download', '/api/files/upload'].includes(url.pathname)) return false;
    const reply = (status, data) => { core.sendJson(res, status, data); return true; };
    try {
      res.setHeader('Cache-Control', 'no-store');
      const root = rootOf(url.searchParams.get('root')); base = root.base;
      if (hooks.allow && !hooks.allow(req, root.key)) throw fail(403, 'Only the admin can open this folder.');
      const relative = url.searchParams.get('path') || '';
      if (url.pathname === '/api/files' && req.method === 'GET') {
        const dir = resolve(relative);
        if (!fs.statSync(dir).isDirectory()) throw fail(400, 'Not a folder.');
        const entries = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory() || e.isFile()).flatMap(e => {
          try { const st = fs.lstatSync(path.join(dir, e.name)); return st.isSymbolicLink() ? [] : [{ name: e.name, directory: st.isDirectory(), size: st.size, modified: st.mtime.toISOString() }]; } catch { return []; }
        }).sort((a,b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
        return reply(200, { root: root.label || path.basename(base), rootKey: root.key, writable: !!root.write && !(root.deny || []).includes(relative.split('/')[0]),
          roots: keys.filter((k) => !hooks.allow || hooks.allow(req, k)).map((k) => ({ key: k, label: roots[k].label || (typeof roots[k].dir === 'string' ? path.basename(roots[k].dir) : k), writable: !!roots[k].write })), path: relative, entries, maxUpload: MAX_UPLOAD });
      }
      if (url.pathname === '/api/files/download' && ['GET', 'HEAD'].includes(req.method)) {
        const target = resolve(relative);
        const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
        const st = fs.fstatSync(fd);
        if (!st.isFile()) { fs.closeSync(fd); throw fail(400, 'Only regular files can be downloaded.'); }
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': st.size, 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': "attachment; filename=\"download\"; filename*=UTF-8''" + encodeURIComponent(path.basename(target)).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16)) });
        if (req.method === 'HEAD') { fs.closeSync(fd); res.end(); }
        else pipeline(fs.createReadStream(target, { fd, autoClose: true }), res, () => {});
        return true;
      }
      if (url.pathname === '/api/files/upload' && req.method === 'POST') {
        if (!core.csrfOk(req)) return reply(403, { error: 'Request not allowed.' });
        if (!root.write) throw fail(403, 'This folder is read-only.');
        if ((root.deny || []).includes(relative.split('/')[0])) throw fail(403, `Uploads into ${relative.split('/')[0]}/ are not allowed.`);
        const body = await core.jsonBody(req, res, Math.ceil(MAX_UPLOAD * 4 / 3) + 8192);
        if (!body) return true;
        if (typeof body.name !== 'string' || !body.name || body.name === '.' || body.name === '..' || /[\\/\x00-\x1f\x7f]/.test(body.name)) throw fail(400, 'Invalid file name.');
        if (typeof body.data !== 'string' || (body.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.data))) throw fail(400, 'Invalid file data.');
        const data = Buffer.from(body.data, 'base64');
        if (data.length > MAX_UPLOAD) throw fail(413, 'The maximum file size is 25 MB.');
        const dir = resolve(relative);
        if (!fs.statSync(dir).isDirectory()) throw fail(400, 'Not a folder.');
        const target = path.join(dir, body.name);
        const fd = fs.openSync(target, 'wx', 0o600);
        try { fs.writeFileSync(fd, data); } catch (e) { try { fs.unlinkSync(target); } catch {} throw e; } finally { fs.closeSync(fd); }
        try { if (hooks.onUpload) hooks.onUpload(req, root.key, data.length); } catch {}
        return reply(201, { ok: true, name: body.name, size: data.length });
      }
      return reply(405, { error: 'Unsupported request.' });
    } catch (e) {
      const status = e.status || ({ ENOENT: 404, EEXIST: 409, EACCES: 403, EPERM: 403, ENOTDIR: 400, ELOOP: 403, ENAMETOOLONG: 400 }[e.code]) || 500;
      return reply(status, { error: e.status ? e.message : status === 409 ? 'A file with this name already exists. Rename it before uploading.' : status === 404 ? 'File or folder not found.' : 'Could not complete the file operation.' });
    }
  };
}
module.exports = { createFileBrowser };
