import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'Skybox Exporter',
    description: '一键导出你在 Skybox AI 生成的全景原图（免费账号可用）。',
    permissions: ['downloads'],
    host_permissions: ['*://skybox.blockadelabs.com/*'],
  },
});
