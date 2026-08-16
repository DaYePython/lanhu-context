import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

// The @grant list is generated automatically from the GM_* symbols imported
// from '$' (vite-plugin-monkey/dist/client) in src/. The version comes from
// package.json, which changesets manages.
export default defineConfig({
  build: {
    // Match the extension: an unminified single file is auditable, and a
    // credential-handling userscript should be readable before install.
    minify: false
  },
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: '蓝湖 lanhu-context 助手',
        namespace: 'https://github.com/DaYePython/lanhu-context',
        description:
          '在蓝湖设计稿详情页与画布页复制设计稿链接与登录 Cookie，配合 lanhu-context CLI 使用。',
        // GreasyFork requires an explicit license; matches the repo LICENSE.
        license: 'MIT',
        // Reuse the extension's shipped icon so both installers look the same.
        icon: 'https://raw.githubusercontent.com/DaYePython/lanhu-context/main/ecosystem/browser-extension/public/icons/icon48.png',
        match: ['https://lanhuapp.com/web/*'],
        // GM_xmlhttpRequest to the CLI receiver: localhost must be whitelisted
        // explicitly — `@connect *` does not cover it.
        connect: ['127.0.0.1'],
        'run-at': 'document-idle'
      },
      build: {
        fileName: 'lanhu-monkey.user.js'
      }
    })
  ]
});
