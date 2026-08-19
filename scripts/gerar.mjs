/**
 * Gera data.json com os números do painel a partir do Jira.
 * Roda na GitHub Action (diária 00:00 SP) — credenciais vêm de Secrets.
 *
 * RÉGUA "ESTEIRA": upstream fica FORA do total/funil.
 *   Upstream (excluído): BACKLOG, Em refinamento, Em prototipagem,
 *                        EM ANÁLISE TÉCNICA, PRONTO PARA DESENVOLVIMENTO
 */
import { writeFileSync, readFileSync } from 'node:fs';
import fetch from 'node-fetch';

// A régua vive em regua.json — editável pelo GitHub sem mexer neste arquivo.
// Ver COMO-EDITAR.md.
const R = JSON.parse(readFileSync(new URL('../regua.json', import.meta.url), 'utf8'));

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

/** Listas de status das fases, ignorando as chaves `_leia` (comentários do JSON). */
const fasesStatus = () =>
  Object.entries(R.fases).filter(([k]) => !k.startsWith('_')).map(([, v]) => v);

/**
 * Confere se todo status citado em regua.json existe mesmo no Jira.
 * Sem isso, um nome digitado errado faz a US sumir do painel em silêncio —
 * a consulta devolve 0 e ninguém percebe.
 */
async function checarRegua() {
  const r = await fetch(`https://${SITE}/rest/api/3/status`, {
    headers: { Authorization: AUTH, Accept: 'application/json' },
  });
  if (!r.ok) { console.warn(`aviso: não consegui listar os status (HTTP ${r.status}) — pulando validação da régua`); return; }

  const existentes = new Set((await r.json()).map(s => s.name.toLowerCase()));
  const usados = [
    ...fasesStatus().flat(),
    R.alertas.bloqueada, R.alertas.emCorrecao,
  ];
  const invalidos = [...new Set(usados)].filter(s => !existentes.has(s.toLowerCase()));

  if (invalidos.length) {
    console.error('\n❌ regua.json tem status que não existem no Jira:\n');
    for (const s of invalidos) console.error(`   • "${s}"`);
    console.error('\n   Confira acentos, maiúsculas e espaços — o nome precisa ser idêntico ao do Jira.');
    console.error('   Nada foi publicado. Veja COMO-EDITAR.md.\n');
    process.exit(1);
  }
  console.log(`✔ Régua validada — ${[...new Set(usados)].length} status conferidos`);

  // Um status em duas fases faria a mesma US ser contada duas vezes.
  const todas = fasesStatus().flat().map(s => s.toLowerCase());
  const dup = todas.filter((s, i) => todas.indexOf(s) !== i);
  if (dup.length) {
    console.error(`\n❌ Status repetido em mais de uma fase: ${[...new Set(dup)].join(', ')}`);
    console.error('   Isso quebraria o total do funil. Nada foi publicado.\n');
    process.exit(1);
  }
}

const IT = { testavel: R.tipos.testavel, habilitador: R.tipos.habilitador, bug: '10004' };

// O veredito da homologação vem das ETIQUETAS (labels) do próprio card.
// Sem etiqueta = ainda não homologada, independente do status.
const CAMPO_CATEGORIA = 'labels';
const VALOR_REPROVADO = R.etiquetas.reprovado;
const VALOR_APROVADO  = R.etiquetas.aprovado;
const VALOR_EM_HOMOL  = R.etiquetas.emHomologacao;   // cliente está homologando agora

/**
 * Régua da esteira. Ficam FORA do funil e do total:
 *   upstream ....... BACKLOG, Em refinamento, Em prototipagem, EM ANÁLISE TÉCNICA,
 *                    PRONTO PARA DESENVOLVIMENTO, EM APROVAÇÃO DO CLIENTE
 *                    (esta última é o cliente aprovando a especificação, antes do dev)
 *   travadas ....... Em Espera/Bloqueado  (aparecem só no cartão de Bloqueadas)
 *   descartadas .... Cancelado
 */
const ST = {
  aDes:      R.fases.aDesenvolver,
  testes:    R.fases.emTestesInternos,
  liberadas: R.fases.liberadasUAT,     // disponível para homologar
  emprod:    R.fases.emProducao,       // já implantada
};
// Universo em UAT (denominador da homologação) = liberadas + em produção
const LIBERADAS = [...ST.liberadas, ...ST.emprod];

const PROJETOS = R.projetos;
const BLOQ = R.alertas.bloqueada;
const CORR = R.alertas.emCorrecao;

const list = (f, a) => `${f} in (${a.map(s => `"${s}"`).join(',')})`;
const listNums = (f, a) => `${f} in (${a.join(',')})`;  // sem aspas para números

// Universo de User Stories: História + Melhoria + Habilitador (usado nos alertas)
const US = listNums('issuetype', [...IT.testavel, ...IT.habilitador]);

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
  const base = `project = ${pj} AND ${listNums('issuetype', it)}`;
  // Central de Projetos (MVPMO) usa apenas "Liberado para deploy"
  const liberadasQuery = pj === 'MVPMO'
    ? `${base} AND status in ("Liberado para deploy")`
    : `${base} AND ${list('status', ST.liberadas)}`;

  const [aDes, testes, lib, prod] = await Promise.all([
    count(`${base} AND ${list('status', ST.aDes)}`),
    count(`${base} AND ${list('status', ST.testes)}`),
    count(liberadasQuery),
    count(`${base} AND ${list('status', ST.emprod)}`),
  ]);
  return { aDes, testes, lib, prod, total: aDes + testes + lib + prod };
}

/** Chaves das US (testáveis) em cada estágio da homologação. */
async function chaves(pj, statuses) {
  const jql = `project = ${pj} AND ${listNums('issuetype', IT.testavel)} AND ${list('status', statuses)}`;
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
  const jql = `project = ${pj} AND ${listNums('issuetype', IT.testavel)}` +
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
  const isMVPMO = pj === 'MVPMO';

  if (isMVPMO) {
    // Central de Projetos: busca por STATUS em UAT sem veredito
    const [kApr, kRep, aguardandoCount, habUAT] = await Promise.all([
      chavesPorEtiqueta(pj, VALOR_APROVADO),
      chavesPorEtiqueta(pj, VALOR_REPROVADO),
      count(`project = ${pj} AND ${listNums('issuetype', IT.testavel)} AND status in ("Liberado para deploy","PRONTO PARA DEPLOY EM PROD") AND (labels is EMPTY OR (labels != "Aprovado" AND labels != "Reprovado(Bug)"))`),
      count(`project = ${pj} AND ${listNums('issuetype', IT.habilitador)} AND ${list('status', ST.liberadas)}`),
    ]);
    console.log(`   ${pj}: aprovadas = ${kApr.length} | reprovadas = ${kRep.length}` +
                ` | habilitadores = ${habUAT} | aguardando = ${aguardandoCount}`);
    return {
      aprovada: kApr.length,
      aprovadaHab: habUAT,
      reprovada: kRep.length,
      aguardando: aguardandoCount,
    };
  } else {
    // Revenue: busca por ETIQUETA
    const [kApr, kRep, kEmHomol, habUAT] = await Promise.all([
      chavesPorEtiqueta(pj, VALOR_APROVADO),
      chavesPorEtiqueta(pj, VALOR_REPROVADO),
      chavesPorEtiqueta(pj, VALOR_EM_HOMOL),
      count(`project = ${pj} AND ${listNums('issuetype', IT.habilitador)} AND ${list('status', ST.liberadas)}`),
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
}

async function montarView(nome) {
  const pj = PROJETOS[nome];
  const [t, h, hom, bloq, corr, alBloq, alCorr] = await Promise.all([
    funil(pj, IT.testavel),
    funil(pj, IT.habilitador),
    homologacao(pj),
    // só User Stories (História, Melhoria, Habilitador) — Épico/Tarefa/Subtarefa/Bug ficam fora
    count(`project = ${pj} AND ${US} AND status = "${BLOQ}"`),
    count(`project = ${pj} AND ${listNums('issuetype', [...IT.testavel, ...IT.habilitador])} AND labels IN ("BugEmTestes")`),
    issues(`project = ${pj} AND ${US} AND status = "${BLOQ}" ORDER BY key DESC`),
    issues(`project = ${pj} AND ${listNums('issuetype', [...IT.testavel, ...IT.habilitador])} AND labels IN ("BugEmTestes") ORDER BY key DESC`),
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
await checarRegua();

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
