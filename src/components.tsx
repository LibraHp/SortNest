import { useEffect, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight, ImageOff, Inbox, TriangleAlert } from "lucide-react";
import { api, asset, bytes, type ImageItem } from "./api";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export const ALL = "all";
export const NONE = "none";
export const ROOT = "root";

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

export function Choice({
  label,
  value,
  onValueChange,
  options,
  className,
  placeholder = "请选择",
}: {
  label?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
  placeholder?: string;
}) {
  const current = options.some((option) => option.value === value)
    ? value
    : undefined;
  return (
    <Select value={current} onValueChange={onValueChange}>
      <SelectTrigger aria-label={label} className={cn("w-full", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function EmptyState({
  title = "这里还没有图片",
  children,
  icon = <Inbox />,
}: {
  title?: string;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Empty className="min-h-48 border border-dashed bg-card/60">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {typeof children === "string" ? (
          <EmptyDescription>{children}</EmptyDescription>
        ) : null}
      </EmptyHeader>
      {children && typeof children !== "string" ? (
        <EmptyContent>{children}</EmptyContent>
      ) : null}
    </Empty>
  );
}

export function ErrorBox({ error }: { error: string }) {
  return error ? (
    <Alert variant="destructive">
      <TriangleAlert />
      <AlertTitle>请求没有完成</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  ) : null;
}

export function Loading() {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
      <Spinner />
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={
          wide
            ? "h-[86vh] max-h-[86vh] w-[92vw] max-w-[92vw] gap-5 overflow-y-auto p-5 sm:max-w-[92vw]"
            : "max-h-[80vh] w-[min(40rem,90vw)] max-w-[min(40rem,90vw)] gap-5 overflow-y-auto p-5 sm:max-w-[min(40rem,90vw)]"
        }
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
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
    <div className="flex flex-wrap items-end justify-between gap-6">
      <div className="max-w-2xl space-y-3">
        {eyebrow ? (
          <p className="text-[11px] font-medium tracking-[0.18em] text-primary/80">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-[1.9rem] leading-tight font-semibold tracking-tight">
          {title}
        </h1>
        {description ? (
          <p className="max-w-xl text-sm leading-7 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
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
    const observer = new ResizeObserver(([e]) => {
      const next = Math.max(2, Math.floor(e.contentRect.width / 260));
      setCols((current) => (current === next ? current : next));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const rows = useVirtualizer({
    count: Math.ceil(items.length / cols),
    getScrollElement: () => parent.current,
    estimateSize: () => 348,
    overscan: 3,
  });
  return (
    <div
      ref={parent}
      className="h-[calc(100vh-280px)] min-h-[460px] overflow-auto pr-1"
    >
      <div style={{ height: rows.getTotalSize(), position: "relative" }}>
        {rows.getVirtualItems().map((row) => (
          <div
            key={row.key}
            className="absolute top-0 left-0 grid w-full gap-5"
            style={{
              height: 348,
              transform: `translateY(${row.start}px)`,
              gridTemplateColumns: `repeat(${cols},minmax(0,1fr))`,
            }}
          >
            {items
              .slice(row.index * cols, (row.index + 1) * cols)
              .map((item) => (
                <Card
                  key={item.id}
                  className={cn(
                    "group relative gap-0 overflow-hidden py-0",
                    selected?.has(item.id) && "ring-2 ring-primary",
                  )}
                >
                  <Button
                    variant="ghost"
                    className="relative h-52 w-full rounded-none bg-muted p-0 hover:bg-muted"
                    onClick={() => onOpen(item)}
                    aria-label={`查看 ${item.name}`}
                  >
                    {item.thumbnail ? (
                      <img
                        src={asset(item.thumbnail)}
                        alt={item.name}
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    ) : (
                      <ImageOff className="text-muted-foreground" />
                    )}
                    <Badge className="absolute bottom-2 left-2 border-0 bg-black/60 text-white">
                      {item.extension.toUpperCase()}
                    </Badge>
                    {typeof item.score === "number" ? (
                      <Badge className="absolute right-2 bottom-2 border-0 bg-black/60 text-white">
                        {item.relation === "exact"
                          ? "完全重复"
                          : item.score.toFixed(3)}
                      </Badge>
                    ) : null}
                  </Button>
                  {onToggle ? (
                    <Checkbox
                      className={cn(
                        "absolute top-2.5 left-2.5 z-10 border-white bg-white shadow-sm",
                        !selected?.has(item.id) &&
                          "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                      )}
                      checked={selected?.has(item.id) || false}
                      onCheckedChange={() => onToggle(item.id)}
                      aria-label={`选择 ${item.name}`}
                    />
                  ) : null}
                  <Button
                    variant="ghost"
                    className="h-auto w-full flex-col items-start gap-1 rounded-none px-3 py-3 text-left hover:bg-transparent"
                    onClick={() => onOpen(item)}
                  >
                    <strong className="w-full truncate" title={item.name}>
                      {item.name}
                    </strong>
                    <span className="flex w-full justify-between text-xs text-muted-foreground">
                      <span>
                        {item.category ||
                          `${item.width || "–"} × ${item.height || "–"}`}
                      </span>
                      <span>{bytes(item.size)}</span>
                    </span>
                    <small className="line-clamp-1 text-xs text-muted-foreground">
                      {item.tags ||
                        (item.status === "failed"
                          ? "解码失败"
                          : item.relation === "perceptual"
                            ? "感知哈希接近 · 需要人工核对"
                            : "尚未添加标签")}
                    </small>
                  </Button>
                </Card>
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
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-sm font-medium tracking-wide">{children}</h2>
      {action ? (
        <Button variant="link" onClick={onAction}>
          {action}
          <ChevronRight />
        </Button>
      ) : null}
    </div>
  );
}

export type Run = (
  operation: string,
  args?: Record<string, unknown>,
  success?: string,
) => Promise<any>;
