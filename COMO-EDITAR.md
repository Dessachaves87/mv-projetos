# Como editar a régua do painel

O painel lê o Jira todo dia às 00:00 e publica os números em
https://painelprojetonexus.netlify.app

**Toda a regra de negócio está num arquivo só: [`regua.json`](regua.json).**
Dá pra editar pelo navegador, sem instalar nada e sem saber programar.

---

## Editar

1. Abrir o arquivo: https://github.com/Dessachaves87/mv-projetos/blob/main/regua.json
2. Clicar no **ícone de lápis** (canto superior direito do arquivo)
3. Fazer a alteração
4. Descer até o fim ▸ escrever uma linha explicando o que mudou ▸ **Commit changes**

Pronto. O painel se atualiza na próxima execução automática.

### Quer ver o resultado na hora?

1. Ir em **Actions** ▸ **Atualizar painel (Jira)**
2. Botão **Run workflow** ▸ **Run workflow**
3. Esperar ~1 minuto e recarregar o painel com `Ctrl + Shift + R`

> ⚠️ Use **Run workflow**, nunca "Re-run jobs" — esse último repete a execução
> antiga e ignora o que você acabou de editar.

---

## O que dá pra mudar

### Status de cada fase do funil

```json
"liberadasUAT": [
  "Liberado para deploy",
  "PRONTO PARA DEPLOY EM PROD"
]
```

Criaram um status novo no Jira? Adicione na fase certa. Um status que não está
em nenhuma fase **não aparece no painel** — a US some da conta.

O nome precisa ser **idêntico ao do Jira**: acento, maiúscula, espaço, ponto.
`"Deploy em Prod. realizado"` tem ponto depois de "Prod" — se tirar, para de funcionar.

### Nome das etiquetas

```json
"etiquetas": {
  "emHomologacao": "Em-Homologacao-Cliente",
  "aprovado": "Aprovado",
  "reprovado": "Reprovado(Bug)"
}
```

É o campo **Categorias** no Jira. Etiqueta não aceita espaço — por isso os hífens.

### Projetos acompanhados

```json
"projetos": {
  "Revenue": "MVREV",
  "Central de Projetos": "MVPMO"
}
```

À esquerda o nome que aparece no painel, à direita a chave do projeto no Jira.

---

## O que **não** dá pra mudar por aqui

- Criar uma fase nova no funil (hoje são 4)
- Mudar cores, textos ou layout
- Mudar a lógica de precedência da homologação

Isso é código — precisa de quem desenvolveu.

---

## Se errar

O script **valida antes de publicar**. Se um status não existir no Jira, ou se o
mesmo status estiver em duas fases, ele para e não altera o painel:

```
❌ regua.json tem status que não existem no Jira:

   • "Liberado pra deploy"

   Confira acentos, maiúsculas e espaços — o nome precisa ser idêntico ao do Jira.
   Nada foi publicado.
```

O painel continua mostrando os últimos números bons. É só corrigir e commitar de novo.

Para ver o erro: **Actions** ▸ clicar na execução vermelha ▸ **Gerar data.json a partir do Jira**.

---

## Regras que valem no dia a dia

O painel só reflete o que está no Jira. Duas disciplinas mantêm ele correto:

1. **Arrastar o card no quadro.** O funil é por status — card parado no lugar
   errado aparece na fase errada.
2. **Etiquetar quem entra em UAT.** A homologação é por etiqueta. US em UAT sem
   `Em-Homologacao-Cliente` aparece no funil mas some do quadrante de homologação.

Este JQL mostra quem está em UAT sem etiqueta (troque `MVREV` por `MVPMO` para o Central):

```
project = MVREV AND issuetype in (10001,10212)
  AND status in ("Liberado para deploy","PRONTO PARA DEPLOY EM PROD")
  AND (labels is EMPTY OR labels not in ("Em-Homologacao-Cliente","Aprovado","Reprovado(Bug)"))
```

Se der 0, está tudo fechado.

---

## Links

- **Painel** — https://painelprojetonexus.netlify.app
- **Metodologia (pública)** — https://painelprojetonexus.netlify.app/metodologia.html
- **Regra** — [`regua.json`](regua.json)
