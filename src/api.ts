import { invoke, convertFileSrc, isTauri } from "@tauri-apps/api/core";
export const desktop = isTauri();
export async function api<T = any>(
  operation: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (!desktop)
    throw new Error(
      "请使用 SortNest 桌面应用连接本地图片库。运行 npm run desktop 启动。",
    );
  return invoke<T>("command", { operation, args });
}
export const asset = (path?: string | null) =>
  path ? convertFileSrc(path) : "";
export const bytes = (n: number = 0): string =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KB`
      : n < 1073741824
        ? `${(n / 1048576).toFixed(1)} MB`
        : `${(n / 1073741824).toFixed(2)} GB`;
export const taskNames: Record<string, string> = {
  scan: "扫描图片",
  image_embedding: "图片向量索引",
  text_embedding: "文本查询嵌入",
  description: "图片描述",
  tags: "分类与标签",
  description_embedding: "描述向量索引",
};
export const statusNames: Record<string, string> = {
  ready: "已索引",
  pending: "待处理",
  queued: "排队中",
  failed: "失败",
  running: "进行中",
  paused: "已暂停",
  completed: "已完成",
  cancelled: "已取消",
};
export interface ImageItem {
  id: number;
  path: string;
  name: string;
  thumbnail: string;
  extension: string;
  size: number;
  width: number;
  height: number;
  status: string;
  category?: string;
  tags?: string;
  score?: number;
  relation?: string;
  hash?: string;
  error?: string;
}
export interface Category {
  id: number;
  name: string;
  parent_id: number | null;
  count: number;
}
export interface Tag {
  id: number;
  name: string;
  kind: string;
  count: number;
}
export interface Taxonomy {
  categories: Category[];
  tags: Tag[];
}
export interface Folder {
  id: number;
  path: string;
  count: number;
  failed: number;
  missing: number;
  last_scan: string | null;
}
