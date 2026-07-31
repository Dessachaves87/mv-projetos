/**
 * Move US de status em massa via API do Jira.
 *
 * COMO USAR (PowerShell):
 *   $env:JIRA_EMAIL = "seu.email@sottelli.com"
 *   $env:JIRA_TOKEN = "seu_token_da_api"
 *
 *   node scripts/mover-status.mjs                 # simulação (NÃO altera nada)
 *   node scripts/mover-status.mjs --aplicar       # executa de verdade
 *
 * Por padrão roda em modo simulação: mostra o que faria, sem tocar no Jira.
 * Só altera quando receber --aplicar.
 */
import { argv, env, exit } from 'node:process';

const SITE = 'sottelli.atlassian.net';
const APLICAR = argv.includes('--aplicar');

// ---------------------------------------------------------------- o que mover
const DESTINO = 'Liberado para deploy';

const LOTES = [
  {
    de: 'PRONTO PARA TESTES',
    chaves: ['MVREV-93', 'MVREV-94', 'MVREV-116', 'MVREV-149', 'MVREV-192',
             'MVREV-213', 'MVREV-219', 'MVREV-230', 'MVREV-261', 'MVREV-262'],
  },
  {
    de: 'Pós Review',
    chaves: ['MVREV-159', 'MVREV-160', 'MVREV-161', 'MVREV-162',
             'MVREV-163', 'MVREV-189', 'MVREV-206', 'MVREV-207'],
  },
];

// ------------------------------------------------------------------- conexão
const EMAIL = env.JIRA_EMAIL, TOKEN = env.JIRA_TOKEN;
if (!EMAIL || !TOKEN) {
  console.error('❌ Faltam as variáveis JIRA_EMAIL e JIRA_TOKEN.');
  console.error('   $env:JIRA_EMAIL = "voce@sottelli.com"');
  console.error('   $env:JIRA_TOKEN = "seu_token"');
  exit(1);
}
const AUTH = 'Basic ' + Buffer.from(`${EMAIL.trim()}:${TOKEN.trim()}`).toString('base64');
const H = { Authorization: AUTH, 'Content-Type': 'application/json', Accept: 'application/json' };

async function api(caminho, opts = {}) {
  const r = await fetch(`https://${SITE}/rest/api/3${caminho}`, { headers: H, ...opts });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${caminho}\n${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

// --------------------------------------------------------------------- passos
async function conferir(chave, statusEsperado) {
  const i = await api(`/issue/${chave}?fields=status,issuetype`);
  return { status: i.fields.status.name, tipo: i.fields.issuetype.name };
}

async function transicaoPara(chave, destino) {
  const { transitions } = await api(`/issue/${chave}/transitions`);
  const t = transitions.find(x => x.to?.name?.toLowerCase() === destino.toLowerCase());
  return { achou: t, disponiveis: transitions.map(x => x.to?.name) };
}

// ----------------------------------------------------------------------- main
const me = await api('/myself');
console.log(`✔ Autenticado como ${me.displayName}`);
console.log(APLICAR ? '\n⚠️  MODO APLICAR — vai alterar o Jira\n'
                    : '\n🔍 MODO SIMULAÇÃO — nada será alterado (use --aplicar para valer)\n');

let ok = 0, pulados = 0, erros = 0;

for (const lote of LOTES) {
  console.log(`\n── ${lote.de}  →  ${DESTINO}   (${lote.chaves.length} cards)`);

  for (const chave of lote.chaves) {
    try {
      const { status, tipo } = await conferir(chave);

      // trava 1: só move quem está no status de origem esperado
      if (status !== lote.de) {
        console.log(`   ⏭  ${chave.padEnd(11)} já está em "${status}" — pulando`);
        pulados++; continue;
      }
      // trava 2: nunca move habilitador (só História e Melhoria)
      if (!['História', 'Melhoria'].includes(tipo)) {
        console.log(`   ⏭  ${chave.padEnd(11)} é ${tipo} — pulando`);
        pulados++; continue;
      }

      const { achou, disponiveis } = await transicaoPara(chave, DESTINO);
      if (!achou) {
        console.log(`   ❌ ${chave.padEnd(11)} sem transição para "${DESTINO}"`);
        console.log(`      workflow oferece: ${disponiveis.join(' · ') || '(nenhuma)'}`);
        erros++; continue;
      }

      if (APLICAR) {
        await api(`/issue/${chave}/transitions`, {
          method: 'POST',
          body: JSON.stringify({ transition: { id: achou.id } }),
        });
        console.log(`   ✅ ${chave.padEnd(11)} movido`);
      } else {
        console.log(`   ✅ ${chave.padEnd(11)} moveria (transição "${achou.name}")`);
      }
      ok++;
    } catch (e) {
      console.log(`   ❌ ${chave.padEnd(11)} ${e.message.split('\n')[0]}`);
      erros++;
    }
  }
}

console.log(`\n── Resumo: ${ok} ${APLICAR ? 'movidos' : 'a mover'} · ${pulados} pulados · ${erros} com erro`);
if (!APLICAR && erros === 0) console.log('   Se estiver certo, rode de novo com --aplicar');
