# Painel de Acompanhamento de US — MV × Sotelli

Painel de acompanhamento das User Stories (Revenue **MVREV** + Central de Projetos **MVPMO**),
alimentado pelo **Jira** e publicado no **GitHub Pages**, com atualização **diária às 00:00 (SP)**.

> **Site:** https://dessachaves87.github.io/mv-projetos/ — **sem senha** (acesso público).
> Migrado do Netlify em 20/08/2026 (créditos do plano free esgotados). A pasta `netlify/`
> e o `netlify.toml` ficaram no repo só como referência caso volte pro Netlify um dia —
> **não são usados** no deploy atual.

```
GitHub Action (cron 03:00 UTC = 00:00 SP)
  └─ scripts/gerar.mjs  →  Jira REST  →  data.json  →  commit
                                                 │
                                                 ▼  (dispara .github/workflows/pages.yml)
                                    GitHub Pages  →  index.html  →  fetch('data.json')
```

## Por onde começar

| Você quer | Leia |
|---|---|
| Ajustar status, etiquetas ou projetos — **sem código** | [`COMO-EDITAR.md`](COMO-EDITAR.md) |
| Mexer no código (layout, cálculo, textos) | [`GUIA-DEV.md`](GUIA-DEV.md) |
| Entender de onde vem cada número | [metodologia](https://dessachaves87.github.io/mv-projetos/metodologia.html) |
| Montar o ambiente do zero | este arquivo, seção *Setup* |

## Arquivos
| Arquivo | Função |
|---|---|
| `index.html` | O painel (lê `data.json`) |
| `regua.json` | Régua de negócio — status, etiquetas, projetos |
| `data.json` | Números gerados pela Action |
| `scripts/gerar.mjs` | Consulta o Jira e escreve o `data.json` |
| `.github/workflows/pages.yml` | Deploy no GitHub Pages |
| `.github/workflows/atualizar.yml` | Agendamento diário |
| `netlify/edge-functions/gate.js` | *(legado, não usado)* Login único do Netlify |
| `netlify.toml` | *(legado, não usado)* Config do Netlify |

---

## Setup (uma vez)

### 1. GitHub — Secrets
`Settings ▸ Secrets and variables ▸ Actions ▸ New repository secret`
| Nome | Valor |
|---|---|
| `JIRA_EMAIL` | seu e-mail Atlassian |
| `JIRA_TOKEN` | token de API (id.atlassian.com ▸ tokens de API) |

### 2. GitHub Pages — habilitar
`Settings ▸ Pages ▸ Source: GitHub Actions` (já habilitado; o deploy roda via `.github/workflows/pages.yml`).
Repo precisa ser **público** — GitHub Pages grátis não funciona em repo privado.

> O site é **público, sem senha**. O antigo login único (Netlify Edge Function `gate.js`)
> não tem equivalente em GitHub Pages (hospedagem 100% estática, sem código server-side).

### 3. Testar
- Action: aba **Actions ▸ Atualizar painel (Jira) ▸ Run workflow** (roda na hora).
- Deploy: aba **Actions ▸ Deploy Pages** dispara sozinho quando `data.json`/os HTMLs mudam, ou rode manual (`Run workflow`).
- Site: abra https://dessachaves87.github.io/mv-projetos/ direto — sem tela de login.

---

## Régua dos números (esteira)

**Universo:** Histórias (10001) + Melhorias (10212) = *testáveis* · Habilitadores (10005) = *não testáveis*.

**Upstream fica FORA** do total e do funil: `BACKLOG`, `Em refinamento`, `Em prototipagem`,
`EM ANÁLISE TÉCNICA`, `PRONTO PARA DESENVOLVIMENTO`, `EM APROVAÇÃO DO CLIENTE`
(esta última é o cliente aprovando a *especificação*, antes do dev).

As quatro fases — `aDesenvolver`, `emTestesInternos`, `liberadasUAT`, `emProducao` — e os
status de cada uma vivem em **[`regua.json`](regua.json)**, editável pelo navegador.
A lista não é repetida aqui de propósito: duas cópias de uma régua sempre divergem.

**Homologação — quem manda é a ETIQUETA do card, não o status** (regra de 31/07):

| Fatia | Origem |
|---|---|
| 🟢 Aprovada | etiqueta `Aprovado` + habilitadores em UAT (não passam por teste) |
| 🔵 Aguardando | etiqueta `Em-Homologacao-Cliente` ainda sem veredito |
| 🔴 Reprovada | etiqueta `Reprovado(Bug)` |

Um veredito (`Aprovado` ou `Reprovado(Bug)`) tira a US de "Aguardando". Entre os dois vereditos **não
há precedência**: card com as duas etiquetas é contado duas vezes — deixe só uma por card.

**Homologadas = a fatia Aprovada.** Estar em produção não conta — só o carimbo da etiqueta vale.

No funil, o balde de UAT aparece dividido em três barras que somam as liberadas:
**Em UAT para homologar · Homologadas · Reprovadas**. "Em produção" continua dentro do
total, mas não tem barra própria (01/08).

> A explicação completa, com os JQLs de cada número, é a página pública
> [metodologia](https://dessachaves87.github.io/mv-projetos/metodologia.html) — é ela que o
> cliente usa para auditar a conta. **Mexeu em número? Atualize ela junto.**

---

## Manutenção
- **Mudar o horário:** `cron` em `.github/workflows/atualizar.yml` (UTC — 03:00 UTC = 00:00 SP).
- **Mudar a régua de status/etiquetas:** [`regua.json`](regua.json) — ver [`COMO-EDITAR.md`](COMO-EDITAR.md).
- **Mexer no código:** ver [`GUIA-DEV.md`](GUIA-DEV.md).
- **Rodar local:** `JIRA_EMAIL=... JIRA_TOKEN=... node scripts/gerar.mjs`
