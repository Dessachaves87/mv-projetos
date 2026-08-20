# Guia de desenvolvimento — Painel de US

Para quem vai **mexer no código** do painel (layout, cálculo, textos).

Se você só precisa ajustar status ou etiquetas, **não é aqui** — é o
[`COMO-EDITAR.md`](COMO-EDITAR.md), que se resolve pelo navegador, sem instalar nada.

---

## O que você precisa saber antes de tudo

**Este repositório se move sozinho.** Todo dia às 00:00 uma GitHub Action consulta o
Jira, reescreve o `data.json` e **commita na `main`**. Além disso somos três pessoas
com permissão de push direto.

A consequência prática é uma só, e é a causa de quase todo problema aqui:

> **O seu clone local está desatualizado quase toda manhã.**
> Se você editar sem atualizar antes, o push é recusado.

Por isso o passo 1 do fluxo é sempre o mesmo.

---

## Setup (uma vez)

```bash
git clone https://github.com/Dessachaves87/mv-projetos.git
cd mv-projetos
```

Faça o rebase virar o padrão neste repo — evita commits de merge inúteis
poluindo o histórico a cada `pull`:

```bash
git config pull.rebase true
```

Não precisa instalar dependência nenhuma. O painel é HTML puro; o gerador usa
só Node (v20+) e nada de `npm install`.

---

## O fluxo, do começo ao fim

### 1. Atualizar — sempre, antes de escrever qualquer linha

```bash
git pull --rebase
```

Isso traz o `data.json` da madrugada e o que os outros empurraram, e recoloca
seus commits por cima. **Pegue o hábito de rodar isso ao sentar**, não na hora
de subir — descobrir conflito depois de duas horas de trabalho é bem pior.

### 2. Rodar local

O painel busca `data.json` via `fetch`, então **não funciona abrindo o arquivo
com dois cliques** (`file://` bloqueia a requisição). Suba um servidor:

```bash
python -m http.server 8899
```

E abra http://localhost:8899

> Ao recarregar, use **Ctrl + F5**. Localmente o navegador segura o HTML antigo
> e você jura que sua alteração não funcionou.

### 3. Editar

| Quero mudar | Arquivo |
|---|---|
| Layout, cores, barras, cálculo exibido | `index.html` |
| A página pública que explica os números | `metodologia.html` |
| Como o Jira é consultado | `scripts/gerar.mjs` |
| Status e etiquetas da régua | `regua.json` |
| Deploy no GitHub Pages | `.github/workflows/pages.yml` |

**Nunca edite `data.json` na mão.** Ele é gerado. Qualquer coisa que você
escrever ali é apagada na próxima execução da Action — e no meio do caminho
você vai brigar com conflito de merge à toa.

### 4. Conferir antes de subir

Se mexeu no JavaScript do `index.html`, vale checar a sintaxe — um erro ali
não aparece no terminal, o painel só fica em branco:

```bash
node --check <(sed -n '/<script>/,/<\/script>/p' index.html | sed '1d;$d')
```

No PowerShell:

```powershell
$h = Get-Content index.html -Raw
[regex]::Match($h,'(?s)<script>(.*?)</script>').Groups[1].Value |
  Set-Content "$env:TEMP\check.mjs"
node --check "$env:TEMP\check.mjs"
```

E abra o painel local trocando as três frentes no seletor do topo
(Consolidado / Revenue / Central) — vários bugs só aparecem numa delas.

### 5. Commitar e subir

```bash
git add index.html metodologia.html
git commit -m "explique o porquê, não o que"
git pull --rebase          # de novo: alguém pode ter subido enquanto você trabalhava
git push
```

O GitHub Pages publica sozinho em ~1-2 minutos (acompanhe em **Actions ▸ Deploy Pages**).
Confira em https://dessachaves87.github.io/mv-projetos/ com **Ctrl + Shift + R**.

---

## Quando der problema

### `! [rejected] main -> main (fetch first)`

O clássico. Alguém — ou a Action — commitou depois do seu último `pull`.
Não force nada:

```bash
git pull --rebase
git push
```

`git push --force` **resolve na aparência e destrói o trabalho dos outros**,
inclusive o `data.json` do dia. Não use.

### Conflito no `data.json`

Nunca resolva na mão. A versão do servidor é sempre a boa:

```bash
git checkout --theirs data.json
git add data.json
git rebase --continue
```

### Subi e o painel não mudou

Nesta ordem:

1. **Ctrl + Shift + R** — 9 de 10 vezes é cache do navegador
2. **Actions ▸ Deploy Pages** — o workflow rodou? Passou?
3. Abra o console do navegador (F12) — erro de JS deixa a página em branco

### Os números estão errados / a US sumiu do painel

Provavelmente não é código, é régua. Um status que não está em nenhuma fase do
`regua.json` faz a US **desaparecer em silêncio**. Veja a seção "Se errar" do
[`COMO-EDITAR.md`](COMO-EDITAR.md) e rode este JQL para achar quem está fora.

---

## Regerar o `data.json` localmente

Só se precisar testar mudança no `gerar.mjs`. Precisa de um token do Jira
(id.atlassian.com ▸ tokens de API — **token clássico**, não "scoped"):

```powershell
$env:JIRA_EMAIL="voce@sottelli.com.br"
$env:JIRA_TOKEN="seu-token"
node scripts/gerar.mjs
```

Ele valida acesso e régua antes de escrever, e **aborta sem publicar** se algo
estiver errado — inclusive se os dois projetos vierem zerados.

Para rodar em produção sem esperar a madrugada:
**Actions ▸ Atualizar painel (Jira) ▸ Run workflow**.
Use *Run workflow*, nunca *Re-run jobs* — o segundo repete a execução antiga.

---

## Combinados do time

- **`git pull --rebase` ao sentar.** Resolve a maior parte das dores sozinho.
- **Um assunto por commit**, com mensagem que explica o *porquê*. Quem lê daqui
  a três meses precisa entender a decisão, não o diff.
- **`data.json` é território da Action.** Não edite, não resolva conflito na mão.
- **Mexeu em `regua.json`?** Rode a Action manualmente e confira o painel. A
  régua muda número na tela, não só código.
- **Mexeu no número que aparece?** Atualize o `metodologia.html` junto. Ela é
  pública e é o que o cliente usa para auditar a conta — doc desencontrada com
  o painel vale menos que doc nenhuma.
- **Sem proteção na `main` é escolha, não esquecimento.** A confiança é no time;
  o cuidado fica no processo.

---

## Links

- **Painel** — https://dessachaves87.github.io/mv-projetos/
- **Metodologia (pública)** — https://dessachaves87.github.io/mv-projetos/metodologia.html
- **Actions** — https://github.com/Dessachaves87/mv-projetos/actions
- **Arquitetura e setup** — [`README.md`](README.md)
- **Editar a régua sem código** — [`COMO-EDITAR.md`](COMO-EDITAR.md)
