/**
 * Gera data.json com os números do painel a partir do Jira.
 * Roda na GitHub Action (diária 00:00 SP) — credenciais vêm de Secrets.
 *
 * RÉGUA "ESTEIRA": upstream fica FORA do total/funil.
 *   Upstream (excluído): BACKLOG, Em refinamento, Em prototipagem,
 *                        EM ANÁLISE TÉCNICA, PRONTO PARA DESENVOLVIMENTO
 */
import { writeFileSync } from 'node:fs';

const SITE = 'sottelli.atlassian.net';
const EMAIL = process.env.JIRA_EMAIL;
const TOKEN = process.env.JIRA_TOKEN;
if (!EMAIL || !TOKEN) { console.error('Faltam JIRA_EMAIL / JIRA_TOKEN'); process.exit(1); }

const AUTH = 'Basic ' + Buffer.from(`${EMAIL.trim()}:${TOKEN.trim()}`).toString('base64');

/** Valida credenciais antes de tudo — evita gerar data.json zerado silenciosamente. */
async function checarAcesso() {
  const me = await fetch(`https://${SITE}/rest/api/3/myself`, {
    headers: { Authorization: AUTH, Accept: 'application/json' },
  });
  if (!me.ok) {
    console.error(`\n❌ AUTENTICAÇÃO FALHOU (HTTP ${me.status}).`);
    console.error('   Verifique os secrets JIRA_EMAIL e JIRA_TOKEN.');
    console.error('   Dica: use um token CLÁSSICO (id.atlassian.com ▸ tokens de API), não "scoped".\n');
    console.error(await me.text());
    process.exit(1);
  }
  const u = await me.json();
  console.log(`✔ Autenticado como: ${u.displayName} <${u.emailAddress || EMAIL}>`);

  // O usuário enxerga os projetos?
  for (const pj of Object.values(PROJETOS)) {
    const r = await fetch(`https://${SITE}/rest/api/3/project/${pj}`, {
      headers: { Authorization: AUTH, Accept: 'application/json' },
    });
    if (!r.ok) {
      console.error(`\n❌ SEM ACESSO ao projeto ${pj} (HTTP ${r.status}).`);
      console.error('   A conta do token precisa ter permissão de "Procurar projetos" nele.\n');
      process.exit(1);
    }
    console.log(`✔ Acesso ao projeto ${pj} OK`);
  }
}

const IT = { testavel: ['10001', '10212'], habilitador: ['10005'], bug: '10004' };

// O veredito da homologação vem das ETIQUETAS (labels) do próprio card.
// Sem etiqueta = ainda não homologada, independente do status.
const CAMPO_CATEGORIA = 'labels';
const VALOR_REPROVADO = 'Reprovado(Bug)';
const VALOR_APROVADO  = 'Aprovado';
const VALOR_EM_HOMOL  = 'Em-Homologacao-Cliente'; // cliente está homologando agora

/**
 * Régua da esteira. Ficam FORA do funil e do total:
 *   upstream ....... BACKLOG, Em refinamento, Em prototipagem, EM ANÁLISE TÉCNICA,
 *                    PRONTO PARA DESENVOLVIMENTO, EM APROVAÇÃO DO CLIENTE
 *                    (esta última é o cliente aprovando a especificação, antes do dev)
 *   travadas ....... Em Espera/Bloqueado  (aparecem só no cartão de Bloqueadas)
 *   descartadas .... Cancelado
 */
const ST = {
  aDes:    ['Pronto para DEV', 'EM DESENVOLVIMENTO'],
  testes:  ['PRONTO PARA TESTES', 'Bug em Testes', 'Aguardando Review', 'Pós Review',
            'Realizando Deploy em QA', 'EM TESTE QA', 'Em Análise de PR'],
  // Disponível para homologar. "PRONTO PARA DEPLOY EM PROD" entrou em 31/07:
  // a US já passou por UAT e espera janela de deploy — está entregue, não em teste.
  liberadas: ['Liberado para deploy', 'PRONTO PARA DEPLOY EM PROD'],
  emprod:    ['Deploy em Prod. realizado', 'CONCLUÍDO'],       // já implantada
};
// Universo em UAT (denominador da homologação) = liberadas + em produção
const LIBERADAS = [...ST.liberadas, ...ST.emprod];

const PROJETOS = { 'Revenue': 'MVREV', 'Central de Projetos': 'MVPMO' };
const BLOQ = 'Em Espera/Bloqueado';
const CORR = 'Bug em Testes';

const list = (f, a) => `${f} in (${a.map(s => `"${s}"`).join(',')})`;

// Universo de User Stories: História + Melhoria + Habilitador (usado nos alertas)
const US = list('issuetype', [...IT.testavel, ...IT.habilitador]);

async function count(jql) {
  const r = await fetch(`https://${SITE}/rest/api/3/search/approximate-count`, {
    method: 'POST',
    headers: { Authorization: AUTH, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ jql }),
  });
  if (!r.ok) throw new Error(`Jira ${r.status}: ${await r.text()}`);
  return (await r.json()).count || 0;
}

async function issues(jql, max = 50) {
  const r = await fetch(`https://${SITE}/rest/api/3/search/jql`, {
    method: 'POST',
    headers: { Authorization: AUTH, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ jql, maxResults: max, fields: ['summary'] }),
  });
  if (!r.ok) { console.warn(`aviso: busca de issues falhou (HTTP ${r.status}) — lista de alertas ficará vazia`); return []; }
  return ((await r.json()).issues || []).map(i => ({ k: i.key, t: i.fields.summary }));
}

async function funil(pj, it) {
  const base = `project = ${pj} AND ${list('issuetype', it)}`;
  const [aDes, testes, lib, prod] = await Promise.all([
    count(`${base} AND ${list('status', ST.aDes)}`),
    count(`${base} AND ${list('status', ST.testes)}`),
    count(`${base} AND ${list('status', ST.liberadas)}`),
    count(`${base} AND ${list('status', ST.emprod)}`),
  ]);
  return { aDes, testes, lib, prod, total: aDes + testes + lib + prod };
}

/** Chaves das US (testáveis) em cada estágio da homologação. */
async function chaves(pj, statuses) {
  const jql = `project = ${pj} AND ${list('issuetype', IT.testavel)} AND ${list('status', statuses)}`;
  const out = [];
  let token = null;
  do {
    const body = { jql, maxResults: 100, fields: ['status'] };
    if (token) body.nextPageToken = token;
    const r = await fetch(`https://${SITE}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { Authorization: AUTH, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`Jira ${r.status} ao listar chaves: ${await r.text()}`);
    const d = await r.json();
    out.push(...(d.issues || []).map(i => i.key));
    token = d.nextPageToken || null;
  } while (token);
  return out;
}

/**
 * US com uma dada etiqueta (campo "Categorias" no Jira = `labels`).
 * NÃO filtra status: a partir de 31/07 quem manda na homologação é a etiqueta,
 * e as US etiquetadas estão espalhadas por vários status do board.
 */
async function chavesPorEtiqueta(pj, etiqueta) {
  const jql = `project = ${pj} AND ${list('issuetype', IT.testavel)}` +
              ` AND ${CAMPO_CATEGORIA} = "${etiqueta}"`;
  const out = [];
  let token = null;
  do {
    const body = { jql, maxResults: 100, fields: ['status'] };
    if (token) body.nextPageToken = token;
    const r = await fetch(`https://${SITE}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { Authorization: AUTH, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      console.warn(`aviso: não consegui ler a etiqueta "${etiqueta}" em ${pj} (HTTP ${r.status})`);
      console.warn(await r.text());
      return out;
    }
    const d = await r.json();
    out.push(...(d.issues || []).map(i => i.key));
    token = d.nextPageToken || null;
  } while (token);
  return out;
}

/**
 * Homologação — quem manda é a ETIQUETA do card, não o status (regra de 31/07).
 *   🟢 Aprovada  = etiqueta "Aprovado"  (+ habilitadores em UAT, que não passam por teste)
 *   🔴 Reprovada = etiqueta "Reprovado(Bug)"
 *   🔵 Aguardando = etiqueta "Em-Homologacao-Cliente" e ainda sem veredito
 * Precedência: um veredito (Aprovado/Reprovado) vence "Em homologação" na mesma US.
 * Homologadas = apenas a fatia Aprovada.
 */
async function homologacao(pj) {
  const [kApr, kRep, kEmHomol, habUAT] = await Promise.all([
    chavesPorEtiqueta(pj, VALOR_APROVADO),
    chavesPorEtiqueta(pj, VALOR_REPROVADO),
    chavesPorEtiqueta(pj, VALOR_EM_HOMOL),
    // Habilitadores não passam por teste: ao chegarem à UAT já contam como aprovados.
    count(`project = ${pj} AND ${list('issuetype', IT.habilitador)} AND ${list('status', ST.liberadas)}`),
  ]);
  const apr = new Set(kApr), rep = new Set(kRep);
  const aguardando = kEmHomol.filter(k => !apr.has(k) && !rep.has(k)).length;

  console.log(`   ${pj}: aprovadas = ${kApr.length} | reprovadas = ${kRep.length}` +
              ` | habilitadores = ${habUAT} | aguardando = ${aguardando}`);
  return {
    aprovada: kApr.length,
    aprovadaHab: habUAT,
    reprovada: kRep.length,
    aguardando,
  };
}

async function montarView(nome) {
  const pj = PROJETOS[nome];
  const [t, h, hom, bloq, corr, alBloq, alCorr] = await Promise.all([
    funil(pj, IT.testavel),
    funil(pj, IT.habilitador),
    homologacao(pj),
    // só User Stories (História, Melhoria, Habilitador) — Épico/Tarefa/Subtarefa/Bug ficam fora
    count(`project = ${pj} AND ${US} AND status = "${BLOQ}"`),
    count(`project = ${pj} AND ${US} AND status = "${CORR}"`),
    issues(`project = ${pj} AND ${US} AND status = "${BLOQ}" ORDER BY key DESC`),
    issues(`project = ${pj} AND ${US} AND status = "${CORR}" ORDER BY key DESC`),
  ]);
  return {
    total: [t.total, h.total], aDes: [t.aDes, h.aDes],
    desenv: [t.testes + t.lib + t.prod, h.testes + h.lib + h.prod],
    testes: [t.testes, h.testes], libUAT: [t.lib, h.lib], emprod: [t.prod, h.prod],
    hom: {
      aprovada: [hom.aprovada, hom.aprovadaHab], emprod: [t.prod, h.prod],
      aguardando: [hom.aguardando, 0], reprovada: [hom.reprovada, 0],
    },
    bloq: [bloq, 0], corr,
    alerts: [...alBloq.map(a => ({ ...a, type: 'bloq' })), ...alCorr.map(a => ({ ...a, type: 'corr' }))],
  };
}

const pair = (x, y) => [x[0] + y[0], x[1] + y[1]];
const consolidar = (a, b) => ({
  total: pair(a.total, b.total), aDes: pair(a.aDes, b.aDes), desenv: pair(a.desenv, b.desenv),
  testes: pair(a.testes, b.testes), libUAT: pair(a.libUAT, b.libUAT),
  emprod: pair(a.emprod, b.emprod),
  hom: {
    aprovada: pair(a.hom.aprovada, b.hom.aprovada), emprod: pair(a.hom.emprod, b.hom.emprod),
    aguardando: pair(a.hom.aguardando, b.hom.aguardando), reprovada: pair(a.hom.reprovada, b.hom.reprovada),
  },
  bloq: pair(a.bloq, b.bloq), corr: a.corr + b.corr, alerts: [...a.alerts, ...b.alerts],
});

await checarAcesso();

const rev = await montarView('Revenue');
const cen = await montarView('Central de Projetos');

// Trava de segurança: nunca publicar um painel zerado.
if (rev.total[0] === 0 && cen.total[0] === 0) {
  console.error('\n❌ Nenhuma US encontrada nos dois projetos — data.json NÃO foi atualizado.');
  console.error('   Causa provável: token sem permissão de leitura, ou nomes de status mudaram no Jira.\n');
  process.exit(1);
}

const ts = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
}).format(new Date()).replace(',', ' ·');

const payload = {
  ts,
  regra: 'esteira (upstream fora) · fonte Jira por status',
  data: { 'Consolidado': consolidar(rev, cen), 'Revenue': rev, 'Central de Projetos': cen },
};

writeFileSync('data.json', JSON.stringify(payload, null, 2) + '\n');
console.log('data.json gerado —', ts);
for (const [nome, v] of [['Revenue', rev], ['Central', cen]]) {
  const h = v.hom;
  console.log(`${nome.padEnd(8)} testáveis ${v.total[0]} | a desenvolver ${v.aDes[0]} | testes ${v.testes[0]}` +
    ` | liberadas ${v.libUAT[0]} | em produção ${v.emprod[0]}` +
    ` || homologadas ${h.aprovada[0] + h.aprovada[1]} (${h.aprovada[0]} etiqueta + ${h.aprovada[1]} habilitadores)` +
    ` | aguardando ${h.aguardando[0]} | reprovada ${h.reprovada[0]}`);
}
