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

const AUTH = 'Basic ' + Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64');

const IT = { testavel: ['10001', '10212'], habilitador: ['10005'] };

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
  if (!r.ok) return [];
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

async function homologacao(pj) {
  const base = `project = ${pj} AND ${list('issuetype', IT.testavel)}`;
  const [emhomol, aprovada, emprod] = await Promise.all([
    count(`${base} AND ${list('status', ST.emhomol)}`),
    count(`${base} AND ${list('status', ST.aprovada)}`),
    count(`${base} AND ${list('status', ST.emprod)}`),
  ]);
  return { emhomol, aprovada, emprod, reprovada: 0 }; // reprovada: card c/ Bug (a definir)
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

const rev = await montarView('Revenue');
const cen = await montarView('Central de Projetos');

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
console.log('Revenue  testáveis:', rev.total[0], '| liberadas:', rev.libUAT[0], '| homologadas:', rev.hom.aprovada[0] + rev.hom.emprod[0]);
console.log('Central  testáveis:', cen.total[0], '| liberadas:', cen.libUAT[0], '| homologadas:', cen.hom.aprovada[0] + cen.hom.emprod[0]);
