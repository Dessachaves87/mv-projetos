# Painel de Acompanhamento de US — MV × Sotelli

Painel de acompanhamento das User Stories (Revenue **MVREV** + Central de Projetos **MVPMO**),
alimentado pelo **Jira** e publicado no **Netlify**, com **login único** e atualização **diária às 00:00 (SP)**.

```
GitHub Action (cron 03:00 UTC = 00:00 SP)
  └─ scripts/gerar.mjs  →  Jira REST  →  data.json  →  commit
                                                 │
                                                 ▼  (deploy automático)
                                    Netlify  →  index.html  →  fetch('data.json')
                                       └─ Edge Function "gate" = login único
```

## Arquivos
| Arquivo | Função |
|---|---|
| `index.html` | O painel (lê `data.json`) |
| `data.json` | Números gerados pela Action |
| `scripts/gerar.mjs` | Consulta o Jira e escreve o `data.json` |
| `netlify/edge-functions/gate.js` | Login único (senha em env var) |
| `netlify.toml` | Config do Netlify |
| `.github/workflows/atualizar.yml` | Agendamento diário |

---

## Setup (uma vez)

### 1. GitHub — Secrets
`Settings ▸ Secrets and variables ▸ Actions ▸ New repository secret`
| Nome | Valor |
|---|---|
| `JIRA_EMAIL` | seu e-mail Atlassian |
| `JIRA_TOKEN` | token de API (id.atlassian.com ▸ tokens de API) |

### 2. Netlify — conectar o repo
`Add new site ▸ Import an existing project ▸ GitHub ▸ mv-projetos`
- Build command: *(vazio)*
- Publish directory: `.`

### 3. Netlify — senha do login
`Site configuration ▸ Environment variables ▸ Add`
| Nome | Valor |
|---|---|
| `GATE_PASSWORD` | a senha genérica da equipe |

> Sem `GATE_PASSWORD` o site fica **aberto**. Com ela, aparece a tela de login (cookie dura 7 dias).

### 4. Testar
- Action: aba **Actions ▸ Atualizar painel (Jira) ▸ Run workflow** (roda na hora).
- Site: abra a URL do Netlify → tela de senha → painel.

---

## Régua dos números (esteira)

**Universo:** Histórias (10001) + Melhorias (10212) = *testáveis* · Habilitadores (10005) = *não testáveis*.

**Upstream fica FORA** do total/funil: `BACKLOG`, `Em refinamento`, `Em prototipagem`,
`EM ANÁLISE TÉCNICA`, `PRONTO PARA DESENVOLVIMENTO`.

| Fase | Status |
|---|---|
| A desenvolver | `Pronto para DEV`, `EM DESENVOLVIMENTO`, `Em Espera/Bloqueado` |
| Em testes internos | `PRONTO PARA TESTES`, `Bug em Testes`, `Aguardando Review`, `Pós Review`, `Realizando Deploy em QA`, `EM TESTE QA`, `Em Análise de PR` |
| Liberadas p/ UAT | `Liberado para deploy`, `Deploy em Prod. realizado`, `EM APROVAÇÃO DO CLIENTE`, `CONCLUÍDO` |

**Homologação** (subdivisão das liberadas):
- 🟢 **Aprovada** = `Liberado para deploy`
- 🟣 **Em produção** = `Deploy em Prod. realizado` + `CONCLUÍDO`
- 🔵 **Em homologação UAT** = `EM APROVAÇÃO DO CLIENTE`
- 🔴 **Reprovada** = card marcado como Bug — *a definir com o time* (hoje 0)

**Homologadas (de fato) = Aprovada + Em produção.**

---

## Manutenção
- **Mudar o horário:** `cron` em `.github/workflows/atualizar.yml` (UTC — 03:00 UTC = 00:00 SP).
- **Mudar a régua de status:** objeto `ST` em `scripts/gerar.mjs`.
- **Rodar local:** `JIRA_EMAIL=... JIRA_TOKEN=... node scripts/gerar.mjs`
