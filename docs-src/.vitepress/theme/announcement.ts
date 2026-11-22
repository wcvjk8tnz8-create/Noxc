import { ref } from 'vue';

/** 与 SPA / 独立模板同源：后台「站点设置 → 站点公告」的纯文本 */
export const announcement = ref('');

export async function loadAnnouncement(): Promise<void> {
  try {
    const r = await fetch('/api/config', { headers: { Accept: 'application/json' } });
    if (!r.ok) return;
    const d = await r.json();
    announcement.value = typeof d?.announcement === 'string' ? d.announcement.trim() : '';
  } catch { /* 接口失败保持隐藏，不影响文档阅读 */ }
}
