# Signify Alternative Finder V46 - GitHub + Azure Static Web Apps

Versao preparada para publicar diretamente num repositorio GitHub e executar no Azure Static Web Apps com Azure Functions integradas.

## Estrutura

- `index.html` - frontend completo; mantem PSU <-> PSD/DALI, lifecycle, Quote DB e Alternativas Signify.
- `selftest.html` - testes locais do motor frontend.
- `staticwebapp.config.json` - configuracao do Azure Static Web Apps.
- `api/function_app.py` - API Python Azure Functions para pesquisa/verificacao de concorrentes.
- `api/requirements.txt` - dependencias da Function.
- `api/host.json` - host Azure Functions.
- `.github/workflows/azure-static-web-apps.yml` - deployment automatico GitHub -> Azure.

## Arquitetura em Azure

Browser -> Azure Static Web Apps (`index.html`) -> `/api/competitor/search` -> Azure Function -> fontes oficiais dos fabricantes / Brave Search opcional.

Nao existem API keys no frontend.

### Fontes externas implementadas

- OPPLE: lookup oficial deterministico em `opple.eu` / `opple.com` e extracao da pagina oficial.
- Brave Search API: opcional, usada como discovery adicional quando `BRAVE_SEARCH_API_KEY` estiver configurada.
- LEDVANCE, TRILUX e ZUMTOBEL: dominios oficiais ja estao na whitelist, mas ainda nao possuem parser especifico equivalente ao parser OPPLE. Nesses casos o sistema nao inventa especificacoes.

## Publicar no GitHub

1. Cria um repositorio vazio no GitHub.
2. Faz upload de **todo o conteudo desta pasta**, incluindo `.github`, `api` e `staticwebapp.config.json`.
3. Usa a branch `main`.

## Criar o Azure Static Web App

No Azure Portal:

1. `Create resource` -> `Static Web App`.
2. Seleciona a subscription/resource group pretendidos.
3. Source: `GitHub`.
4. Seleciona o repositorio e branch `main`.
5. Build preset: `Custom`.
6. App location: `/`
7. API location: `api`
8. Output location: deixar vazio.

O Azure normalmente cria o deployment secret automaticamente quando o recurso e ligado ao GitHub. Se estiveres a usar o workflow incluido manualmente, cria no GitHub Actions secret:

`AZURE_STATIC_WEB_APPS_API_TOKEN`

com o deployment token do teu Static Web App (`Manage deployment token` no Azure Portal).

## Variaveis de ambiente

No Azure Portal -> Static Web App -> Environment variables / Configuration:

- `BRAVE_SEARCH_API_KEY` - **opcional**. Permite pesquisa web adicional. Sem esta key, OPPLE continua a usar lookup oficial deterministico quando a referencia permite construir/localizar a pagina oficial.
- `CACHE_TTL_SECONDS` - opcional; default `86400`.

Nao colocar estas keys no GitHub nem no `index.html`.

## Endpoints

- `GET /api/health`
- `POST /api/competitor/search`

Body:

```json
{"query":"OPPLE LED PostTop-P 50W-3000-W"}
```

## Cache

A Function usa cache temporario no filesystem efemero (`/tmp`). Isto reduz chamadas repetidas dentro da mesma instancia, mas **nao e uma base persistente** e pode desaparecer quando a Function reinicia.

As equivalencias humanas da V44/V45 continuam no `localStorage` do browser. Para partilhar feedback entre toda a equipa sera necessario acrescentar armazenamento persistente Azure (por exemplo Table Storage/Cosmos DB). A V46 nao finge que existe essa persistencia central.

## Testar depois do deployment

1. Abre `https://<teu-site>.azurestaticapps.net/api/health`.
2. Deve devolver `"ok": true` e `"version": "46"`.
3. Abre o site.
4. Confirma que o Finder PSU/PSD continua funcional.
5. Em `Alternativas Signify`, testa:
   `OPPLE LED PostTop-P 50W-3000-W`
6. O browser deve chamar `/api/competitor/search` no mesmo dominio, sem CORS externo no frontend.

## Seguranca / comportamento

- A Function so aceita pesquisa e leitura; nao altera dados do Quote.
- API keys ficam apenas nas Application Settings do Azure.
- O parser nao preenche campos tecnicos sem evidencia encontrada na fonte.
- `UNKNOWN` nao e tratado como match.
- A whitelist de dominios oficiais pode ser expandida em `OFFICIAL_DOMAINS` sem alterar o frontend.
