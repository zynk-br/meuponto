# Meu Ponto Automatizado (Electron App com Vite)

Aplicativo desktop para automatizar o registro de ponto no site centraldofuncionario.com.br, utilizando Electron e Vite.

## Pré-requisitos

*   [Node.js](https://nodejs.org/) (versão >= 18.x recomendada, inclui npm)
*   Git (opcional, para clonar o repositório)

## Configuração do Projeto

1.  **Clone o repositório (se aplicável):**
    ```bash
    git clone <url-do-repositorio>
    cd <nome-do-diretorio-do-projeto>
    ```

2.  **Instale as dependências:**
    Use npm ou yarn. O comando `postinstall` também executará `electron-builder install-app-deps` para garantir que as dependências nativas sejam compiladas para a versão correta do Electron.
    ```bash
    npm install
    # ou
    yarn install
    ```

## Executando em Modo de Desenvolvimento

Para iniciar o aplicativo em modo de desenvolvimento com Vite (que fornece Hot Module Replacement - HMR) e acesso às ferramentas de desenvolvedor do Electron:

```bash
npm run dev
# ou
yarn dev
```
Isso iniciará o servidor de desenvolvimento Vite para o processo de renderização e o processo principal do Electron.

## Build para Produção

Para criar os instaladores para diferentes plataformas:

1.  **Primeiro, construa o código com `electron-vite`:**
    ```bash
    # Se electron-vite não estiver instalado globalmente, use npx
    npx electron-vite build
    # ou, se definido como script no package.json (como fizemos)
    # npm run build:vite (se você adicionar um script "build:vite": "electron-vite build")
    ```
    Isso compilará os processos principal, preload e de renderização para a pasta `dist/`.

2.  **Depois, empacote com `electron-builder`:**
    Os scripts de build no `package.json` já combinam esses passos (`electron-vite build && electron-builder`).

*   **Build para todas as plataformas configuradas (Windows, macOS, Linux):**
    ```bash
    npm run build
    # ou
    yarn build
    ```

*   **Build específico para Windows:**
    ```bash
    npm run build:win
    # ou
    yarn build:win
    ```

*   **Build específico para macOS:**
    ```bash
    npm run build:mac
    # ou
    yarn build:mac
    ```

*   **Build específico para Linux:**
    ```bash
    npm run build:linux
    # ou
    yarn build:linux
    ```

Os instaladores e arquivos empacotados serão encontrados na pasta `release/`.

### Ícones da Aplicação

Os ícones da aplicação são referenciados na configuração do `electron-builder` dentro do `package.json` e devem estar localizados em `assets/build/`:

*   **macOS:** `assets/build/icon.icns`
*   **Windows:** `assets/build/icon.ico`
*   **Linux:** `assets/build/icon.png`

**Você precisará criar esses arquivos de ícone.** Um placeholder `icon.png` minúsculo foi fornecido.

## Estrutura do Projeto com `electron-vite`

*   `electron/`: Contém o código do processo principal (`main.js`) e preload (`preload.js`).
*   `src/renderer/`: Contém todo o código da interface do usuário (React).
    *   `index.html`: Ponto de entrada HTML para o renderer.
    *   `index.tsx`: Ponto de entrada JavaScript/TypeScript para o renderer.
    *   `components/`, `contexts/`, `hooks/`, `views/`, `types.ts`, `constants.ts`, `App.tsx`: Código React.
    *   `index.css`: Estilos globais e diretivas Tailwind.
*   `vite.config.ts`: Configuração do Vite.
*   `tailwind.config.js`: Configuração do Tailwind CSS.
*   `postcss.config.js`: Configuração do PostCSS (usado pelo Tailwind).
*   `assets/build/`: Recursos para o build do Electron (ex: ícones).
*   `dist/`: Pasta de saída do build do `electron-vite`.
    *   `dist/electron/`: Código compilado do processo principal e preload.
    *   `dist/renderer/`: Código compilado da interface do usuário.
*   `release/`: Pasta de saída dos instaladores gerados pelo `electron-builder`.

