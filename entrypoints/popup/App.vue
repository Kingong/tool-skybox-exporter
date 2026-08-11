<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { browser } from 'wxt/browser';
import type { GetDetectedResponse, SkyboxInfo } from '@/utils/types';

type ViewState = 'loading' | 'not-skybox' | 'none' | 'ready';

const state = ref<ViewState>('loading');
const current = ref<SkyboxInfo | null>(null);
const feedback = ref('');
let activeTabId: number | undefined;

onMounted(async () => {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('no active tab');
    activeTabId = tab.id;
    const resp: GetDetectedResponse = await browser.tabs.sendMessage(tab.id, { type: 'GET_DETECTED' });
    if (resp?.current?.fileUrl) {
      current.value = resp.current;
      state.value = 'ready';
    } else {
      state.value = 'none';
    }
  } catch {
    state.value = 'not-skybox';
  }
});

async function onExport() {
  if (!current.value) return;
  feedback.value = '导出中…';
  try {
    const resp = await browser.runtime.sendMessage({
      type: 'EXPORT_SKYBOX',
      payload: { url: current.value.fileUrl, title: current.value.title },
    });
    feedback.value = resp?.ok ? '已开始下载 ✓' : `导出失败: ${resp?.error ?? '未知错误'}`;
  } catch (err) {
    feedback.value = `导出失败: ${String(err)}`;
  }
}

/** 裁剪版委托页面内 content script 执行（页面上下文 fetch + canvas + a[download]） */
async function onExportCropped() {
  if (!current.value || !activeTabId) return;
  feedback.value = '已在页面开始裁剪下载 ✓';
  try {
    await browser.tabs.sendMessage(activeTabId, { type: 'EXPORT_CROPPED_LOCAL' });
  } catch (err) {
    feedback.value = `触发失败: ${String(err)}`;
  }
}
</script>

<template>
  <main class="popup">
    <h1>Skybox Exporter</h1>
    <p v-if="state === 'loading'">检测中…</p>
    <p v-else-if="state === 'not-skybox'">请在 Skybox AI 页面（skybox.blockadelabs.com）打开你的作品后使用。</p>
    <p v-else-if="state === 'none'">当前页面未检测到已完成的全景图，请先打开一个已生成的 skybox。</p>
    <section v-else class="card">
      <img v-if="current?.thumbUrl" :src="current.thumbUrl" alt="preview" class="thumb" />
      <p class="title">{{ current?.title }}</p>
      <p class="status">状态: {{ current?.status }}</p>
      <button class="export" @click="onExportCropped">导出无横幅版 (8K)</button>
      <button class="export plain" @click="onExport">原图（带水印）</button>
    </section>
    <p v-if="feedback" class="feedback">{{ feedback }}</p>
  </main>
</template>

<style scoped>
.popup { width: 280px; padding: 12px; font-family: sans-serif; }
h1 { font-size: 16px; margin: 0 0 8px; }
.thumb { width: 100%; border-radius: 6px; }
.title { font-weight: 600; margin: 8px 0 2px; }
.status { color: #666; font-size: 12px; margin: 0 0 8px; }
.export { width: 100%; padding: 8px; border: none; border-radius: 6px; background: #6c5ce7; color: #fff; font-weight: 600; cursor: pointer; }
.export.plain { background: #2d3436; margin-top: 6px; }
.feedback { margin-top: 8px; font-size: 12px; color: #2d8a4e; }
</style>
