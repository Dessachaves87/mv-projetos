/**
 * Login único (genérico) — protege o site inteiro.
 * A senha fica na env var GATE_PASSWORD do Netlify (nunca no código/repo).
 * Fluxo: sem cookie válido -> mostra tela de senha; POST correto -> grava cookie -> libera.
 */
const COOKIE = 'mvp_auth';
const DIAS = 7;

async function tokenEsperado(senha) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`mv-painel::${senha}`));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function telaLogin(erro = false) {
  return new Response(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Painel de US — Acesso</title>
<style>
  :root{--ink:#e8eefb;--ink2:#9fb0cc;--menta:#35D6A4;--stroke:rgba(120,170,255,.16)}
  *{box-sizing:border-box} html,body{margin:0;height:100%}
  body{display:grid;place-items:center;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    color:var(--ink);background:radial-gradient(1000px 500px at 20% -10%,rgba(53,214,164,.12),transparent 60%),
    radial-gradient(900px 500px at 100% 0,rgba(34,211,238,.10),transparent 55%),#070b16}
  .card{width:min(92vw,380px);background:rgba(148,180,235,.05);border:1px solid var(--stroke);
    border-radius:18px;padding:34px 30px;backdrop-filter:blur(8px)}
  .eyebrow{font-family:ui-monospace,Consolas,monospace;font-size:10.5px;letter-spacing:.28em;
    text-transform:uppercase;color:var(--menta);margin-bottom:10px}
  h1{font-size:20px;margin:0 0 6px;font-weight:650}
  p{margin:0 0 22px;font-size:13px;color:var(--ink2)}
  input{width:100%;padding:13px 15px;border-radius:11px;border:1px solid var(--stroke);
    background:rgba(255,255,255,.04);color:var(--ink);font-size:15px;outline:none}
  input:focus{border-color:var(--menta);box-shadow:0 0 0 3px rgba(53,214,164,.15)}
  button{width:100%;margin-top:12px;padding:13px;border:0;border-radius:11px;cursor:pointer;
    font-size:14.5px;font-weight:650;color:#04211a;background:linear-gradient(180deg,#4ee9b5,#21b98d)}
  button:hover{filter:brightness(1.06)}
  .err{margin-top:14px;font-size:12.5px;color:#fca5a5;text-align:center}
  .foot{margin-top:20px;font-size:11px;color:#63728e;text-align:center;
    font-family:ui-monospace,Consolas,monospace}
</style></head><body>
  <form class="card" method="POST" action="/__login">
    <div class="eyebrow">Projeto Nexus</div>
    <h1>Painel de Acompanhamento de US</h1>
    <p>Acesso restrito — informe a senha de equipe.</p>
    <input type="password" name="senha" placeholder="Senha" autofocus required autocomplete="current-password">
    <button type="submit">Entrar</button>
    ${erro ? '<div class="err">Senha incorreta. Tente novamente.</div>' : ''}
    <div class="foot">MV × Sotelli</div>
  </form>
</body></html>`, {
    status: erro ? 401 : 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export default async (request, context) => {
  const senha = Netlify.env.get('GATE_PASSWORD');
  if (!senha) return context.next();               // sem senha configurada => site aberto

  const url = new URL(request.url);
  const esperado = await tokenEsperado(senha);

  // submissão do formulário
  if (request.method === 'POST' && url.pathname === '/__login') {
    const form = await request.formData();
    if (form.get('senha') === senha) {
      return new Response(null, {
        status: 303,
        headers: {
          location: '/',
          'set-cookie': `${COOKIE}=${esperado}; Path=/; Max-Age=${DIAS * 86400}; HttpOnly; Secure; SameSite=Lax`,
        },
      });
    }
    return telaLogin(true);
  }

  // já autenticado?
  const cookie = request.headers.get('cookie') || '';
  const atual = cookie.split(';').map(c => c.trim()).find(c => c.startsWith(`${COOKIE}=`))?.split('=')[1];
  if (atual === esperado) return context.next();

  return telaLogin();
};

export const config = { path: '/*' };
