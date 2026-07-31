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

const ST = {
  // esteira (upstream fora)
  aDes:     ['Pronto para DEV', 'EM DESENVOLVIMENTO', 'Em Espera/Bloqueado'],
  testes:   ['PRONTO PARA TESTES', 'Bug em Testes', 'Aguardando Review', 'Pós Review',
             'Realizando Deploy em QA', 'EM TESTE QA', 'Em Análise de PR'],
  emhomol:  ['EM APROVAÇÃO DO CLIENTE'],
  aprovada: ['Liberado para deploy'],
  emprod:   ['Deploy em Prod. realizado', 'CONCLUÍDO'],
};
const LIBERADAS = [...ST.emhomol, ...ST.aprovada, ...ST.emprod];

const PROJETOS = { 'Revenue': 'MVREV', 'Central de Projetos': 'MVPMO' };
const BLOQ = 'Em Espera/Bloqueado';
const CORR = 'Bug em Testes';

const list = (f, a) => `${f} in (${a.map(s => `"${s}"`).join(',')})`;

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
  const [aDes, testes, lib] = await Promise.all([
    count(`${base} AND ${list('status', ST.aDes)}`),
    count(`${base} AND ${list('status', ST.testes)}`),
    count(`${base} AND ${list('status', LIBERADAS)}`),
  ]);
  return { aDes, testes, lib, total: aDes + testes + lib };
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
 * US com Bug apontado — a fatia "Reprovada".
 * Pega os Bugs do projeto (exceto cancelados) e coleta a qual US eles se referem,
 * tanto por item-filho (parent) quanto por vínculo (issue link).
 */
async function usComBug(pj) {
  const jql = `project = ${pj} AND issuetype = ${IT.bug} AND status != "Cancelado"`;
  const marcadas = new Set();
  let token = null;
  do {
    const body = { jql, maxResults: 100, fields: ['parent', 'issuelinks'] };
    if (token) body.nextPageToken = token;
    const r = await fetch(`https://${SITE}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { Authorization: AUTH, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) { console.warn(`aviso: não consegui ler os bugs de ${pj} (HTTP ${r.status})`); return marcadas; }
    const d = await r.json();
    for (const bug of d.issues || []) {
      if (bug.fields.parent) marcadas.add(bug.fields.parent.key);          // bug como item-filho do card
      for (const l of bug.fields.issuelinks || []) {                        // bug vinculado ao card
        const alvo = l.outwardIssue || l.inwardIssue;
        if (alvo) marcadas.add(alvo.key);
      }
    }
    token = d.nextPageToken || null;
  } while (token);
  return marcadas;
}

/**
 * Homologação por status, com precedência: Bug (Reprovada) vence os demais estágios.
 * Assim uma US com bug sai de "Aprovada"/"Em produção" e entra em "Reprovada".
 */
async function homologacao(pj) {
  const [kHomol, kAprov, kProd, comBug] = await Promise.all([
    chaves(pj, ST.emhomol),
    chaves(pj, ST.aprovada),
    chaves(pj, ST.emprod),
    usComBug(pj),
  ]);
  const semBug = ks => ks.filter(k => !comBug.has(k)).length;
  const reprovada = [...kHomol, ...kAprov, ...kProd].filter(k => comBug.has(k)).length;
  return {
    emhomol: semBug(kHomol),
    aprovada: semBug(kAprov),
    emprod: semBug(kProd),
    reprovada,
  };
}

async function montarView(nome) {
  const pj = PROJETOS[nome];
  const [t, h, hom, bloq, corr, alBloq, alCorr] = await Promise.all([
    funil(pj, IT.testavel),
    funil(pj, IT.habilitador),
    homologacao(pj),
    count(`project = ${pj} AND status = "${BLOQ}"`),
    count(`project = ${pj} AND status = "${CORR}"`),
    issues(`project = ${pj} AND status = "${BLOQ}" ORDER BY key DESC`),
    issues(`project = ${pj} AND status = "${CORR}" ORDER BY key DESC`),
  ]);
  return {
    total: [t.total, h.total], aDes: [t.aDes, h.aDes],
    desenv: [t.testes + t.lib, h.testes + h.lib],
    testes: [t.testes, h.testes], libUAT: [t.lib, h.lib],
    hom: {
      aprovada: [hom.aprovada, 0], emprod: [hom.emprod, 0],
      emhomol: [hom.emhomol, 0], reprovada: [hom.reprovada, 0],
    },
    bloq: [bloq, 0], corr,
    alerts: [...alBloq.map(a => ({ ...a, type: 'bloq' })), ...alCorr.map(a => ({ ...a, type: 'corr' }))],
  };
}

const pair = (x, y) => [x[0] + y[0], x[1] + y[1]];
const consolidar = (a, b) => ({
  total: pair(a.total, b.total), aDes: pair(a.aDes, b.aDes), desenv: pair(a.desenv, b.desenv),
  testes: pair(a.testes, b.testes), libUAT: pair(a.libUAT, b.libUAT),
  hom: {
    aprovada: pair(a.hom.aprovada, b.hom.aprovada), emprod: pair(a.hom.emprod, b.hom.emprod),
    emhomol: pair(a.hom.emhomol, b.hom.emhomol), reprovada: pair(a.hom.reprovada, b.hom.reprovada),
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
  console.log(`${nome.padEnd(8)} testáveis ${v.total[0]} | liberadas ${v.libUAT[0]} | homologadas ${h.aprovada[0] + h.emprod[0]}` +
    ` (aprovada ${h.aprovada[0]}, produção ${h.emprod[0]}, em homolog ${h.emhomol[0]}, reprovada ${h.reprovada[0]})`);
}
