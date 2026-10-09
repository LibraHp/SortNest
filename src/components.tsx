import { Button, Checkbox } from "./ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ImageOff, Inbox, ChevronRight } from "lucide-react";
import { api, asset, bytes, type ImageItem } from "./api";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Alert, Empty as AntEmpty, Modal as AntModal, Spin } from "antd";

export function useData<T>(
  operation: string,
  args: Record<string, unknown> = {},
  version = 0,
) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const key = JSON.stringify(args);
  useEffect(() => {
    let current = true;
    setLoading(true);
    api<T>(operation, JSON.parse(key))
      .then((v) => {
        if (current) {
          setData(v);
          setError("");
        }
      })
      .catch((e) => {
        if (current) setError(String(e));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [operation, key, version]);
  return { data, error, loading, setData };
}
export function Empty({
  title = "这里还没有图片",
  children,
  icon = <Inbox size={35} />,
}: {
  title?: string;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <AntEmpty
      className="empty"
      image={<div className="empty-icon">{icon}</div>}
      description={
        <>
          <h3>{title}</h3>
          <div>{children}</div>
        </>
      }
    />
  );
}
export function ErrorBox({ error }: { error: string }) {
  return error ? (
    <Alert className="error-box" type="error" showIcon title={error} />
  ) : null;
}
export function Loading() {
  return (
    <div className="loading">
      <Spin size="small" />
      正在读取本地图片库…
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <AntModal
      open
      title={title}
      onCancel={onClose}
      footer={null}
      width={wide ? 1160 : 560}
      centered
      className={wide ? "detail-modal" : "form-modal"}
    >
      {children}
    </AntModal>
  );
}
export function Heading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="heading-actions">{actions}</div>
    </div>
  );
}
export function ImageGrid({
  items,
  onOpen,
  selected,
  onToggle,
}: {
  items: ImageItem[];
  onOpen: (i: ImageItem) => void;
  selected?: Set<number>;
  onToggle?: (id: number) => void;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(4);
  useEffect(() => {
    const el = parent.current;
    if (!el) return;
    const observer = new ResizeObserver(([e]) =>
      setCols(Math.max(2, Math.floor(e.contentRect.width / 220))),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const rows = useVirtualizer({
    count: Math.ceil(items.length / cols),
    getScrollElement: () => parent.current,
    estimateSize: () => 278,
    overscan: 3,
  });
  return (
    <div ref={parent} className="virtual-grid">
      <div style={{ height: rows.getTotalSize(), position: "relative" }}>
        {rows.getVirtualItems().map((row) => (
          <div
            className="grid-row"
            key={row.key}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: 278,
              transform: `translateY(${row.start}px)`,
              gridTemplateColumns: `repeat(${cols},minmax(0,1fr))`,
            }}
          >
            {items
              .slice(row.index * cols, (row.index + 1) * cols)
              .map((item) => (
                <article
                  key={item.id}
                  className={`image-card ${selected?.has(item.id) ? "selected" : ""}`}
                >
                  <button
                    className="image-open"
                    onClick={() => onOpen(item)}
                    aria-label={`查看 ${item.name}`}
                  >
                    {item.thumbnail ? (
                      <img
                        src={asset(item.thumbnail)}
                        alt={item.name}
                        loading="lazy"
                      />
                    ) : (
                      <ImageOff size={28} />
                    )}
                    <span className="format-label">
                      {item.extension.toUpperCase()}
                    </span>
                    {typeof item.score === "number" && (
                      <span className="score-label">
                        {item.relation === "exact"
                          ? "完全重复"
                          : item.score.toFixed(3)}
                      </span>
                    )}
                  </button>
                  {onToggle && (
                    <Checkbox
                      className="image-check"
                      checked={selected?.has(item.id) || false}
                      onChange={() => onToggle(item.id)}
                      aria-label={`选择 ${item.name}`}
                    />
                  )}
                  <button className="image-info" onClick={() => onOpen(item)}>
                    <strong title={item.name}>{item.name}</strong>
                    <span>
                      {item.category ||
                        `${item.width || "–"} × ${item.height || "–"}`}
                      <span>{bytes(item.size)}</span>
                    </span>
                    <small>
                      {item.tags ||
                        (item.status === "failed"
                          ? "解码失败"
                          : item.relation === "perceptual"
                            ? "感知哈希接近 · 需要人工核对"
                            : "尚未添加标签")}
                    </small>
                  </button>
                </article>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
export function SectionTitle({
  children,
  action,
  onAction,
}: {
  children: ReactNode;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="section-title">
      <h2>{children}</h2>
      {action && (
        <Button className="link-button" onClick={onAction}>
          {action}
          <ChevronRight size={16} />
        </Button>
      )}
    </div>
  );
}
export type Run = (
  operation: string,
  args?: Record<string, unknown>,
  success?: string,
) => Promise<any>;
