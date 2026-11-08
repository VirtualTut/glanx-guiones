import re, time
root = 'F:/Glanx/glanx-guiones'
V = time.strftime('%Y%m%d%H%M')
# index.html: versión en los enlaces para que el navegador no use el archivo viejo
p = root + '/index.html'; s = open(p, encoding='utf-8').read()
s = re.sub(r'href="styles\.css(\?v=\w+)?"', f'href="styles.css?v={V}"', s)
s = re.sub(r'src="app\.js(\?v=\w+)?"', f'src="app.js?v={V}"', s)
open(p, 'w', encoding='utf-8', newline='\n').write(s)
p = root + '/app.js'; s = open(p, encoding='utf-8').read()
if 'const APP_V' not in s:
    s = s.replace("'use strict';", """'use strict';
const APP_V = '0';""", 1)
    s = s.replace("\ncloudInit();\n", r"""
/* ---- aviso de versión nueva: compara con la que hay publicada ---- */
async function checkVersion() {
  try {
    const h = await (await fetch('index.html?_=' + Date.now(), { cache: 'no-store' })).text();
    const v = /app\.js\?v=(\w+)/.exec(h)?.[1];
    if (v && v !== APP_V && !$('#newver')) {
      const b = document.createElement('div'); b.id = 'newver'; b.className = 'newver';
      b.innerHTML = 'Hay una versión nueva de la app. <button class="btn sm pri">Actualizar</button>';
      b.querySelector('button').onclick = () => { syncNow(); flushSave(); location.reload(); };
      document.body.appendChild(b);
    }
  } catch {}
}
setInterval(checkVersion, 5 * 60e3);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkVersion(); });
setTimeout(checkVersion, 8000);
cloudInit();
""", 1)
    # menciones: también por la primera parte del correo («@mapu.img»)
    a = "const mentionsIn = body => (CL.people || []).filter(p => p.email !== CL.user.email.toLowerCase() && body.includes('@' + p.name)).map(p => p.email);"
    assert a in s
    s = s.replace(a, "const mentionsIn = body => (CL.people || []).filter(p => p.email !== CL.user.email.toLowerCase() && (body.includes('@' + p.name) || fold(body).includes('@' + fold(p.email.split('@')[0])))).map(p => p.email);")
s = re.sub(r"const APP_V = '\w+';", f"const APP_V = '{V}';", s)
open(p, 'w', encoding='utf-8', newline='\n').write(s)
p = root + '/styles.css'; s = open(p, encoding='utf-8').read()
if '.newver' not in s:
    s += "\n.newver{position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:95;background:var(--acc);color:var(--accink);font-weight:700;padding:8px 10px 8px 16px;border-radius:99px;display:flex;gap:10px;align-items:center;box-shadow:0 10px 30px rgba(0,0,0,.5)}\n.newver .btn{background:var(--accink);color:var(--acc);border-color:var(--accink)}\n"
    open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('version', V)
