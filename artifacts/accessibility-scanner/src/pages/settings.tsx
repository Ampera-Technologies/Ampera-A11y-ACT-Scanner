import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Shield,
  ShieldCheck,
  Trash2,
  CheckCircle2,
  Plus,
  Eye,
  Sun,
  Moon,
  Monitor,
  ListFilter,
  Clock,
  Image as ImageIcon,
  Type,
  Upload,
  RotateCcw,
  Link as LinkIcon,
  Loader2,
  Sparkles,
  Gem,
  Palette,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth, isAdmin, isSuperAdmin } from "@/contexts/auth";

const BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
const SETTINGS_CARD_CLASS = "rounded-[22px] border border-white/80 bg-card/75 shadow-[0_14px_34px_rgba(69,57,112,.06)] backdrop-blur-xl";

export const ELEMENT_VIEWER_LS_KEY = "a11y-element-viewer-enabled";
export const HTML_REPLAY_LS_KEY = "a11y-html-replay-enabled";
export const HTML_REPLAY_CHANGED_EVENT = "a11y-html-replay-changed";

export function isElementViewerEnabled(): boolean {
  try {
    return localStorage.getItem(ELEMENT_VIEWER_LS_KEY) === "true";
  } catch {
    return false;
  }
}

export function isHtmlReplayEnabled(): boolean {
  try {
    return localStorage.getItem(HTML_REPLAY_LS_KEY) === "true";
  } catch {
    return false;
  }
}

export const PROXY_LS_KEY = "a11y-scanner-proxy-pacs";
export const ACTIVE_PROXY_KEY = "a11y-scanner-active-proxy";
export const ACTIVE_PROXY_CHANGED_EVENT = "a11y-active-proxy-changed";
export const PROXY_LIST_CHANGED_EVENT = "a11y-proxy-list-changed";

export function setActiveProxyValue(url: string): void {
  if (url) {
    localStorage.setItem(ACTIVE_PROXY_KEY, url);
  } else {
    localStorage.removeItem(ACTIVE_PROXY_KEY);
  }
  window.dispatchEvent(
    new CustomEvent(ACTIVE_PROXY_CHANGED_EVENT, {
      detail: { proxyUrl: url },
    }),
  );
}

export const URL_LIMIT_LS_KEY = "a11y-url-limit-enabled";
export const URL_LIMIT_VALUE_LS_KEY = "a11y-url-limit-value";
export const DEFAULT_URL_LIMIT = 100;

export function isUrlLimitEnabled(): boolean {
  try {
    return localStorage.getItem(URL_LIMIT_LS_KEY) === "true";
  } catch {
    return false;
  }
}

export function getUrlLimitValue(): number {
  try {
    const v = parseInt(localStorage.getItem(URL_LIMIT_VALUE_LS_KEY) ?? "", 10);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_URL_LIMIT;
  } catch {
    return DEFAULT_URL_LIMIT;
  }
}

export const SCAN_TIMEOUT_LS_KEY = "a11y-scan-timeout-mins";
export const DEFAULT_SCAN_TIMEOUT_MINS = 3;

export function getScanTimeoutMs(): number {
  try {
    const v = parseInt(localStorage.getItem(SCAN_TIMEOUT_LS_KEY) ?? "", 10);
    return Number.isFinite(v) && v >= 1 ? v * 60_000 : DEFAULT_SCAN_TIMEOUT_MINS * 60_000;
  } catch {
    return DEFAULT_SCAN_TIMEOUT_MINS * 60_000;
  }
}

export const LOGO_TYPE_LS_KEY = "a11y-logo-type";
export const LOGO_IMAGE_URL_LS_KEY = "a11y-logo-image-url";
export const LOGO_TEXT_LS_KEY = "a11y-logo-text";
export const LOGO_SIZE_LS_KEY = "a11y-logo-size";
export const DEFAULT_LOGO_TEXT = "Ampera A11y";
export const DEFAULT_LOGO_SUBTITLE = "Accessibility workspace";
export const DEFAULT_LOGO_SIZE = 36;
export const LOGO_SIZE_MIN = 20;
export const LOGO_SIZE_MAX = 200;

export type LogoType = "image" | "text" | "image-text";

export function getLogoType(): LogoType {
  try {
    const v = localStorage.getItem(LOGO_TYPE_LS_KEY);
    if (v === "image" || v === "text") return v;
  } catch { /* ignore */ }
  return "image";
}

export function getLogoImageUrl(baseUrl = ""): string {
  try {
    const v = localStorage.getItem(LOGO_IMAGE_URL_LS_KEY);
    if (v) return v;
  } catch { /* ignore */ }
  return `${baseUrl}act-logo.png`;
}

export function getLogoText(): string {
  try {
    return localStorage.getItem(LOGO_TEXT_LS_KEY) || DEFAULT_LOGO_TEXT;
  } catch {
    return DEFAULT_LOGO_TEXT;
  }
}

export function getLogoSize(): number {
  try {
    const v = parseInt(localStorage.getItem(LOGO_SIZE_LS_KEY) ?? "", 10);
    if (Number.isFinite(v) && v >= LOGO_SIZE_MIN && v <= LOGO_SIZE_MAX) return v;
  } catch { /* ignore */ }
  return DEFAULT_LOGO_SIZE;
}

export const THEME_LS_KEY = "a11y-theme";
export type Theme = "light" | "dark" | "system" | "glass-dark" | "glass-light" | "glass-vision" | "glass-vision-light";

export const ACCENT_LS_KEY = "a11y-accent";
export type AccentColor =
  | "black"
  | "purple"
  | "blue"
  | "pink"
  | "violet"
  | "indigo"
  | "orange"
  | "teal"
  | "bronze"
  | "mint";

export const ACCENT_COLORS: Record<
  AccentColor,
  { label: string; value: string; foreground: string; swatch: string }
> = {
  black: {
    label: "Black",
    value: "220 12% 19%",
    foreground: "0 0% 100%",
    swatch: "#30343b",
  },
  purple: {
    label: "Purple",
    value: "249 80% 67%",
    foreground: "0 0% 100%",
    swatch: "#7b68ee",
  },
  blue: {
    label: "Blue",
    value: "202 80% 45%",
    foreground: "0 0% 100%",
    swatch: "#168bd4",
  },
  pink: {
    label: "Pink",
    value: "335 75% 61%",
    foreground: "0 0% 100%",
    swatch: "#e84d91",
  },
  violet: {
    label: "Violet",
    value: "287 58% 57%",
    foreground: "0 0% 100%",
    swatch: "#ae53d1",
  },
  indigo: {
    label: "Indigo",
    value: "227 75% 64%",
    foreground: "0 0% 100%",
    swatch: "#5d7be8",
  },
  orange: {
    label: "Orange",
    value: "25 87% 49%",
    foreground: "0 0% 100%",
    swatch: "#e86e10",
  },
  teal: {
    label: "Teal",
    value: "181 70% 36%",
    foreground: "0 0% 100%",
    swatch: "#1b9b9d",
  },
  bronze: {
    label: "Bronze",
    value: "17 15% 59%",
    foreground: "0 0% 100%",
    swatch: "#a58f88",
  },
  mint: {
    label: "Mint",
    value: "157 49% 47%",
    foreground: "0 0% 100%",
    swatch: "#3db489",
  },
};

/** Saved accent: a preset key, or a custom hex string like "#3fb27f". */
export function getSavedAccentColor(): AccentColor | string {
  try {
    const value = localStorage.getItem(ACCENT_LS_KEY);
    if (value && (value in ACCENT_COLORS || /^#[0-9a-fA-F]{6}$/.test(value))) {
      return value;
    }
  } catch {
    /* ignore */
  }
    return "violet";
}

export function hexToHslString(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function hexLuminance(hex: string): number {
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function applyAccentColor(accent: AccentColor | string) {
  let value: string;
  let foreground: string;
  let datasetKey: string;
  if (typeof accent === "string" && accent.startsWith("#")) {
    value = hexToHslString(accent);
    foreground = hexLuminance(accent) > 0.45 ? "222 10% 8%" : "0 0% 100%";
    datasetKey = "custom";
  } else {
    const selected =
      ACCENT_COLORS[accent as AccentColor] ?? ACCENT_COLORS.indigo;
    value = selected.value;
    foreground = selected.foreground;
    datasetKey = accent as string;
  }

  // Dark themes intentionally use monochrome white chrome. The accent is
  // still persisted and restored for light themes, but it must not feed the
  // rail, primary controls, selected states, or focus rings in dark themes.
  const savedTheme = getSavedTheme();
  const darkChrome =
    savedTheme === "dark" ||
    savedTheme === "glass-dark" ||
    savedTheme === "glass-vision" ||
    (savedTheme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  if (darkChrome) {
    value = "0 0% 100%";
    foreground = "222 47% 11%";
  }

  const root = document.documentElement;
  root.style.setProperty("--app-accent", value);
  root.style.setProperty("--primary", value);
  root.style.setProperty("--ring", value);
  root.style.setProperty("--sidebar-primary", value);
  root.style.setProperty("--sidebar-ring", value);
  root.style.setProperty("--primary-foreground", foreground);
  root.dataset.accent = datasetKey;
}

export function getSavedTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_LS_KEY);
    if (
      v === "light" || v === "dark" || v === "system" ||
      v === "glass-dark" || v === "glass-light" || v === "glass-vision" ||
      v === "glass-vision-light"
    ) return v;
  } catch {
    /* ignore */
  }
  return "system";
}

export function applyTheme(theme: Theme) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const useDark =
    theme === "dark" ||
    theme === "glass-dark" ||
    theme === "glass-vision" ||
    (theme === "system" && prefersDark);
  document.documentElement.classList.toggle("dark", useDark);
  document.documentElement.classList.toggle("glass-dark", theme === "glass-dark");
  document.documentElement.classList.toggle("glass-light", theme === "glass-light");
  document.documentElement.classList.toggle("glass-vision", theme === "glass-vision");
  document.documentElement.classList.toggle("glass-vision-light", theme === "glass-vision-light");

  // Reapply the persisted accent after the theme classes change. This keeps
  // dark themes neutral and restores the user's accent when switching back
  // to a light theme.
  applyAccentColor(getSavedAccentColor());
}

/* ── App background image ─────────────────────────────────── */
export const BG_LS_KEY = "a11y-bg-image";

export interface BackgroundPreset {
  id: string;
  label: string;
  url: string;
}

const BG_BASE = `${import.meta.env.BASE_URL}backgrounds`;

export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  { id: "teal-room", label: "Teal Room", url: `${BG_BASE}/bg-teal-room.png` },
  { id: "aurora-night", label: "Aurora Night", url: `${BG_BASE}/bg-aurora-night.png` },
  { id: "sunset-haze", label: "Sunset Haze", url: `${BG_BASE}/bg-sunset-haze.png` },
  { id: "misty-forest", label: "Misty Forest", url: `${BG_BASE}/bg-misty-forest.png` },
  { id: "bright-clouds", label: "Bright Clouds", url: `${BG_BASE}/bg-bright-clouds.png` },
];

export function getSavedBackgroundImage(): string {
  try {
    return localStorage.getItem(BG_LS_KEY) ?? "";
  } catch {
    return "";
  }
}

export const THEME_CHANGED_EVENT = "a11y-theme-changed";

export function applyBackgroundImage(url: string) {
  const root = document.documentElement;
  if (url) {
    root.style.setProperty("--app-bg-image", `url("${url}")`);
    root.dataset.bgImage = "on";
  } else {
    root.style.removeProperty("--app-bg-image");
    delete root.dataset.bgImage;
  }
}

export function loadSavedProxies(): string[] {
  try {
    return JSON.parse(localStorage.getItem(PROXY_LS_KEY) || "[]");
  } catch {
    return [];
  }
}

export function getActiveProxy(): string {
  return localStorage.getItem(ACTIVE_PROXY_KEY) || "";
}

function LogoSettingsCard() {
  const { toast } = useToast();
  const BASE_URL = import.meta.env.BASE_URL as string;
  const BASE = BASE_URL.replace(/\/$/, "");
  const [loading, setLoading] = useState(true);
  const [logoType, setLogoTypeState] = useState<LogoType>("image");
  const [logoImageUrl, setLogoImageUrlState] = useState<string>("");
  const [logoText, setLogoTextState] = useState<string>(DEFAULT_LOGO_TEXT);
  const [logoSubtitle, setLogoSubtitleState] = useState<string>(DEFAULT_LOGO_SUBTITLE);
  const [logoUrlInput, setLogoUrlInput] = useState<string>("");
  const [logoTextInput, setLogoTextInput] = useState<string>(DEFAULT_LOGO_TEXT);
  const [logoSize, setLogoSizeState] = useState<number>(DEFAULT_LOGO_SIZE);
  const [logoTextColor, setLogoTextColorState] = useState<string>("#000000");
  const [logoImgError, setLogoImgError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`${BASE}/api/logo`)
      .then((r) => r.json())
      .then((data: { type: string; imageUrl: string; text: string; subtitle?: string; size: number | null; textColor?: string }) => {
        const type: LogoType = data.type === "text" ? "text" : data.type === "image-text" ? "image-text" : "image";
        const imgUrl = data.imageUrl || `${BASE_URL}act-logo.png`;
        const text = data.text || DEFAULT_LOGO_TEXT;
        const size = typeof data.size === "number" ? data.size : DEFAULT_LOGO_SIZE;
        setLogoTypeState(type);
        setLogoImageUrlState(imgUrl);
        setLogoUrlInput(data.imageUrl || "");
        setLogoTextState(text);
        setLogoTextInput(text);
        setLogoSubtitleState(data.subtitle || DEFAULT_LOGO_SUBTITLE);
        setLogoSizeState(size);
        setLogoTextColorState(data.textColor || "#000000");
      })
      .catch(() => {
        setLogoImageUrlState(`${BASE_URL}act-logo.png`);
      })
      .finally(() => setLoading(false));
  }, [BASE, BASE_URL]);

  const saveLogo = async (patch: Partial<{ type: LogoType; imageUrl: string; text: string; subtitle: string; size: number; textColor: string }>) => {
    try {
      await fetch(`${BASE}/api/admin/logo`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(patch),
      });
    } catch {
      // silently ignore — local state already updated
    }
  };

  const dispatch = (detail: { type: LogoType; imageUrl: string; text: string; subtitle: string; size: number; textColor?: string }) => {
    window.dispatchEvent(new CustomEvent("a11y-logo-changed", { detail }));
  };

  const handleLogoTypeChange = async (t: LogoType) => {
    setLogoTypeState(t);
    await saveLogo({ type: t });
    dispatch({ type: t, imageUrl: logoImageUrl, text: logoText, subtitle: logoSubtitle, size: logoSize, textColor: logoTextColor });
    toast({ title: t === "image" ? "Logo set to image" : t === "text" ? "Logo set to text" : "Logo set to image + text" });
  };

  const applyLogoUrl = async (url: string) => {
    const trimmed = url.trim();
    const imgUrl = trimmed || `${BASE_URL}act-logo.png`;
    setLogoImageUrlState(imgUrl);
    setLogoImgError(false);
    await saveLogo({ imageUrl: trimmed });
    dispatch({ type: logoType, imageUrl: imgUrl, text: logoText, subtitle: logoSubtitle, size: logoSize, textColor: logoTextColor });
    toast({ title: "Logo image updated" });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please select an image file", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      setLogoImageUrlState(dataUrl);
      setLogoUrlInput("");
      setLogoImgError(false);
      await saveLogo({ imageUrl: dataUrl });
      dispatch({ type: logoType, imageUrl: dataUrl, text: logoText, subtitle: logoSubtitle, size: logoSize, textColor: logoTextColor });
      toast({ title: "Logo image uploaded" });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const resetLogoImage = async () => {
    const def = `${BASE_URL}act-logo.png`;
    setLogoImageUrlState(def);
    setLogoUrlInput("");
    setLogoImgError(false);
    await saveLogo({ imageUrl: "" });
    dispatch({ type: logoType, imageUrl: def, text: logoText, subtitle: logoSubtitle, size: logoSize, textColor: logoTextColor });
    toast({ title: "Logo reset to default" });
  };

  const applyLogoText = async (text: string) => {
    const trimmed = text.trim() || DEFAULT_LOGO_TEXT;
    setLogoTextState(trimmed);
    setLogoTextInput(trimmed);
    await saveLogo({ text: trimmed });
    dispatch({ type: logoType, imageUrl: logoImageUrl, text: trimmed, subtitle: logoSubtitle, size: logoSize, textColor: logoTextColor });
    toast({ title: "Logo text updated" });
  };

  const applyLogoSubtitle = async (subtitle: string) => {
    const trimmed = subtitle.trim() || DEFAULT_LOGO_SUBTITLE;
    setLogoSubtitleState(trimmed);
    await saveLogo({ subtitle: trimmed });
    dispatch({ type: logoType, imageUrl: logoImageUrl, text: logoText, subtitle: trimmed, size: logoSize, textColor: logoTextColor });
    toast({ title: "Workspace subtitle updated" });
  };

  const handleLogoSizeChange = async (val: number[]) => {
    const size = val[0];
    setLogoSizeState(size);
    await saveLogo({ size });
    dispatch({ type: logoType, imageUrl: logoImageUrl, text: logoText, subtitle: logoSubtitle, size, textColor: logoTextColor });
  };

  const applyLogoTextColor = async (color: string) => {
    setLogoTextColorState(color);
    await saveLogo({ textColor: color });
    dispatch({ type: logoType, imageUrl: logoImageUrl, text: logoText, subtitle: logoSubtitle, size: logoSize, textColor: color });
  };

  if (loading) {
    return (
      <Card className={SETTINGS_CARD_CLASS}>
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={SETTINGS_CARD_CLASS}>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ImageIcon className="w-5 h-5 text-muted-foreground" />
              <CardTitle>Workspace branding</CardTitle>
        </div>
        <CardDescription>
          Set the shared logo, workspace name, and subtitle shown to everyone.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-3 gap-3">
          {([
            { value: "image" as LogoType, label: "Image logo", icon: ImageIcon },
            { value: "text" as LogoType, label: "Text logo", icon: Type },
            { value: "image-text" as LogoType, label: "Image + text", icon: null },
          ]).map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => handleLogoTypeChange(value)}
              className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all ${
                logoType === value
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border hover:border-primary/40 hover:bg-muted/40 text-muted-foreground"
              }`}
            >
              {Icon ? (
                <Icon className="w-5 h-5" />
              ) : (
                <span className="flex items-center gap-1">
                  <ImageIcon className="w-4 h-4" />
                  <Type className="w-4 h-4" />
                </span>
              )}
              <span className="text-sm font-medium">{label}</span>
            </button>
          ))}
        </div>

        {logoType === "image" && (
          <div className="space-y-4 pt-1 border-t">
            <div>
              <p className="text-sm font-medium mb-2">Preview</p>
              <div className="flex items-center gap-3 rounded-lg border bg-background px-4 py-3">
                {logoImgError ? (
                  <span className="text-sm text-destructive">Failed to load image</span>
                ) : (
                  <img
                    src={logoImageUrl}
                    alt="Logo preview"
                    className="h-8 w-auto max-w-[180px] object-contain"
                    onError={() => setLogoImgError(true)}
                    onLoad={() => setLogoImgError(false)}
                  />
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Upload image file</Label>
              <div className="flex gap-2">
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                <Button variant="outline" className="gap-2" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="w-4 h-4" />
                  Choose file
                </Button>
                <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={resetLogoImage}>
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset to default
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">PNG, JPG, SVG, or WebP — transparent background recommended.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="logo-url-input" className="flex items-center gap-1.5">
                <LinkIcon className="w-3.5 h-3.5" />
                Or enter an image URL
              </Label>
              <div className="flex gap-2">
                <Input
                  id="logo-url-input"
                  placeholder="https://example.com/logo.png"
                  value={logoUrlInput}
                  onChange={(e) => setLogoUrlInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { applyLogoUrl(logoUrlInput); (e.target as HTMLInputElement).blur(); } }}
                  className="font-mono text-sm"
                />
                <Button onClick={() => applyLogoUrl(logoUrlInput)} disabled={!logoUrlInput.trim()}>Apply</Button>
              </div>
            </div>
          </div>
        )}

        {(logoType === "text" || logoType === "image-text") && (
          <div className="space-y-4 pt-1 border-t">
            {logoType === "text" && (
              <div>
                <p className="text-sm font-medium mb-2">Preview</p>
                <div className="flex items-center gap-2 rounded-lg border bg-background px-4 py-3">
                  <svg viewBox="0 0 24 24" style={{ width: logoSize * 0.6, height: logoSize * 0.6 }} className="text-primary shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                  <span className="font-bold text-foreground" style={{ fontSize: logoSize * 0.55 }}>{logoText}</span>
                </div>
              </div>
            )}
            {logoType === "image-text" && (
              <div>
                <p className="text-sm font-medium mb-2">Preview</p>
                <div className="flex items-center gap-3 rounded-lg border bg-background px-4 py-3">
                  {logoImgError ? (
                    <span className="text-sm text-destructive">Failed to load image</span>
                  ) : (
                    <img
                      src={logoImageUrl}
                      alt="Logo preview"
                      style={{ height: logoSize, maxWidth: logoSize * 4 }}
                      className="w-auto object-contain shrink-0"
                      onError={() => setLogoImgError(true)}
                      onLoad={() => setLogoImgError(false)}
                    />
                  )}
                   <span className="flex flex-col">
                     <span className="font-bold" style={{ fontSize: logoSize * 0.55, color: logoTextColor || undefined }}>{logoText}</span>
                     <span className="text-xs text-muted-foreground">{logoSubtitle}</span>
                   </span>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="logo-text-input">Logo text</Label>
              <div className="flex gap-2">
                <Input
                  id="logo-text-input"
                  value={logoTextInput}
                  onChange={(e) => setLogoTextInput(e.target.value)}
                  onBlur={() => applyLogoText(logoTextInput)}
                  onKeyDown={(e) => { if (e.key === "Enter") { applyLogoText(logoTextInput); (e.target as HTMLInputElement).blur(); } }}
                  placeholder={DEFAULT_LOGO_TEXT}
                  maxLength={60}
                  className="max-w-xs"
                />
                {logoText !== DEFAULT_LOGO_TEXT && (
                    <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={async () => { setLogoTextState(DEFAULT_LOGO_TEXT); setLogoTextInput(DEFAULT_LOGO_TEXT); await saveLogo({ text: DEFAULT_LOGO_TEXT }); dispatch({ type: logoType, imageUrl: logoImageUrl, text: DEFAULT_LOGO_TEXT, subtitle: logoSubtitle, size: logoSize, textColor: logoTextColor }); toast({ title: "Logo text reset to default" }); }}>
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Press Enter or click away to apply.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="logo-subtitle-input">Workspace subtitle</Label>
              <div className="flex gap-2">
                <Input
                  id="logo-subtitle-input"
                  value={logoSubtitle}
                  onChange={(e) => setLogoSubtitleState(e.target.value)}
                  onBlur={() => applyLogoSubtitle(logoSubtitle)}
                  onKeyDown={(e) => { if (e.key === "Enter") { applyLogoSubtitle(logoSubtitle); (e.target as HTMLInputElement).blur(); } }}
                  placeholder={DEFAULT_LOGO_SUBTITLE}
                  maxLength={80}
                  className="max-w-xs"
                />
                {logoSubtitle !== DEFAULT_LOGO_SUBTITLE && (
                  <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => applyLogoSubtitle(DEFAULT_LOGO_SUBTITLE)}>
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Shown below the workspace name wherever branding is displayed.</p>
            </div>
            {logoType === "image-text" && (
              <div className="space-y-2">
                <Label htmlFor="logo-text-color">Text color</Label>
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <input
                      id="logo-text-color"
                      type="color"
                      value={logoTextColor || "#000000"}
                      onChange={(e) => setLogoTextColorState(e.target.value)}
                      onBlur={(e) => applyLogoTextColor(e.target.value)}
                      className="sr-only"
                    />
                    <label
                      htmlFor="logo-text-color"
                      className="flex items-center gap-2 cursor-pointer rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                    >
                      <span
                        className="inline-block w-5 h-5 rounded border border-border shrink-0"
                        style={{ backgroundColor: logoTextColor || "#000000" }}
                      />
                      <span className="font-mono text-xs">{logoTextColor || "#000000"}</span>
                    </label>
                  </div>
                  {logoTextColor && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-muted-foreground"
                      onClick={() => applyLogoTextColor("")}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Reset
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">Color of the text next to the logo image.</p>
              </div>
            )}
            {logoType === "image-text" && (
              <div className="space-y-2">
                <Label>Image</Label>
                <div className="flex gap-2">
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                  <Button variant="outline" className="gap-2" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="w-4 h-4" />
                    Choose file
                  </Button>
                  <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={resetLogoImage}>
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset image
                  </Button>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="logo-url-input-it" className="flex items-center gap-1.5">
                    <LinkIcon className="w-3.5 h-3.5" />
                    Or enter an image URL
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="logo-url-input-it"
                      placeholder="https://example.com/logo.png"
                      value={logoUrlInput}
                      onChange={(e) => setLogoUrlInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { applyLogoUrl(logoUrlInput); (e.target as HTMLInputElement).blur(); } }}
                      className="font-mono text-sm"
                    />
                    <Button onClick={() => applyLogoUrl(logoUrlInput)} disabled={!logoUrlInput.trim()}>Apply</Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">PNG, JPG, SVG, or WebP — transparent background recommended.</p>
              </div>
            )}
          </div>
        )}

        <div className="space-y-3 pt-4 border-t">
          <div className="flex items-center justify-between">
            <Label>Logo size</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm tabular-nums text-muted-foreground w-12 text-right">{logoSize}px</span>
              {logoSize !== DEFAULT_LOGO_SIZE && (
                   <Button variant="ghost" size="sm" className="h-7 px-2 gap-1 text-muted-foreground" onClick={async () => { setLogoSizeState(DEFAULT_LOGO_SIZE); await saveLogo({ size: DEFAULT_LOGO_SIZE }); dispatch({ type: logoType, imageUrl: logoImageUrl, text: logoText, subtitle: logoSubtitle, size: DEFAULT_LOGO_SIZE }); }}>
                  <RotateCcw className="w-3 h-3" />
                  Reset
                </Button>
              )}
            </div>
          </div>
          <Slider min={LOGO_SIZE_MIN} max={LOGO_SIZE_MAX} step={1} value={[logoSize]} onValueChange={handleLogoSizeChange} className="w-full" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{LOGO_SIZE_MIN}px</span>
            <span>{LOGO_SIZE_MAX}px</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Settings() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const canEditLogo = isSuperAdmin(user);
  const [savedProxies, setSavedProxies] = useState<string[]>([]);
  const [activeProxy, setActiveProxy] = useState<string>("");
  const [newPacUrl, setNewPacUrl] = useState("");
  const [testingProxy, setTestingProxy] = useState<string | null>(null);
  const [elementViewerEnabled, setElementViewerEnabledState] =
    useState<boolean>(false);
  const [htmlReplayEnabled, setHtmlReplayEnabledState] =
    useState<boolean>(false);
  const [theme, setThemeState] = useState<Theme>("system");
  const [accent, setAccentState] = useState<AccentColor | string>("indigo");
  const [bgImage, setBgImage] = useState<string>("");
  const [urlLimitEnabled, setUrlLimitEnabledState] = useState(false);
  const [urlLimitValue, setUrlLimitValueState] = useState(DEFAULT_URL_LIMIT);
  const [urlLimitInput, setUrlLimitInput] = useState(String(DEFAULT_URL_LIMIT));
  const [globalTimeoutMs, setGlobalTimeoutMs] = useState<number>(10000);
  const [customTimeoutSecs, setCustomTimeoutSecs] = useState("");
  const [savingTimeout, setSavingTimeout] = useState(false);
  const [smartAnalysisAiEnabled, setSmartAnalysisAiEnabled] = useState(false);
  const [savingSmartAi, setSavingSmartAi] = useState(false);

  const saveScanDelay = useCallback(async (ms: number, label: string) => {
    setSavingTimeout(true);
    try {
      const res = await fetch(`${BASE}/api/admin/settings`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scan_page_timeout_ms: String(ms) }),
      });
      if (res.ok) {
        setGlobalTimeoutMs(ms);
        setCustomTimeoutSecs("");
        toast({ title: ms === 0 ? "Scan delay disabled (0 s)" : `Scan delay set to ${label}` });
      } else if (res.status === 401) {
        toast({ title: "Session expired — please log in again", variant: "destructive" });
        navigate("/login");
      } else {
        toast({ title: `Failed to save (${res.status})`, variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error — check your connection", variant: "destructive" });
    } finally {
      setSavingTimeout(false);
    }
  }, [toast, navigate]);

  useEffect(() => {
    const onThemeChanged = () => setThemeState(getSavedTheme());
    window.addEventListener(THEME_CHANGED_EVENT, onThemeChanged);
    return () => window.removeEventListener(THEME_CHANGED_EVENT, onThemeChanged);
  }, []);

  useEffect(() => {
    setSavedProxies(loadSavedProxies());
    setActiveProxy(getActiveProxy());
    setElementViewerEnabledState(isElementViewerEnabled());
    setHtmlReplayEnabledState(isHtmlReplayEnabled());
    setThemeState(getSavedTheme());
    const savedAccent = getSavedAccentColor();
    setAccentState(savedAccent);
    applyAccentColor(savedAccent);
    const savedBg = getSavedBackgroundImage();
    setBgImage(savedBg);
    applyBackgroundImage(savedBg);
    setUrlLimitEnabledState(isUrlLimitEnabled());
    const saved = getUrlLimitValue();
    setUrlLimitValueState(saved);
    setUrlLimitInput(String(saved));
    fetch(`${BASE}/api/scan-settings`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d != null && typeof d.pageTimeoutMs === "number") setGlobalTimeoutMs(d.pageTimeoutMs); })
      .catch(() => {});
    fetch(`${BASE}/api/ai/config`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.smartAnalysisAiEnabled != null) setSmartAnalysisAiEnabled(d.smartAnalysisAiEnabled); })
      .catch(() => {});
  }, []);

  const handleThemeChange = (t: Theme) => {
    setThemeState(t);
    localStorage.setItem(THEME_LS_KEY, t);
    applyTheme(t);
    window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT, { detail: { theme: t } }));
    const labels: Record<Theme, string> = {
      light: "Light",
      dark: "Dark",
      system: "System default",
      "glass-dark": "Glass Dark",
      "glass-light": "Glass Light",
      "glass-vision": "Vision Pro",
      "glass-vision-light": "Vision Pro Light",
    };
    toast({ title: `Theme set to ${labels[t]}` });
  };

  const handleAccentChange = (value: AccentColor | string) => {
    setAccentState(value);
    localStorage.setItem(ACCENT_LS_KEY, value);
    applyAccentColor(value);
    const label = value.startsWith("#")
      ? `Custom (${value})`
      : ACCENT_COLORS[value as AccentColor]?.label ?? value;
    toast({ title: `${label} accent applied` });
  };

  const handleBackgroundChange = (url: string) => {
    try {
      if (url) localStorage.setItem(BG_LS_KEY, url);
      else localStorage.removeItem(BG_LS_KEY);
    } catch {
      toast({
        title: "Could not save background",
        description: "The image is too large to store. Try a smaller file.",
        variant: "destructive",
      });
      return;
    }
    setBgImage(url);
    applyBackgroundImage(url);
    toast({ title: url ? "Background applied" : "Background removed" });
  };

  const handleBackgroundUpload = (file: File) => {
    if (file.size > 1.5 * 1024 * 1024) {
      toast({
        title: "Image too large",
        description: "Please choose an image under 1.5 MB.",
        variant: "destructive",
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => handleBackgroundChange(String(reader.result));
    reader.readAsDataURL(file);
  };

  const syncProxyToServer = async (pacUrl: string) => {
    try {
      await fetch(`${BASE}/api/admin/active-proxy`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxyPacUrl: pacUrl }),
      });
    } catch { /* best-effort */ }
  };

  const addProxy = () => {
    const url = newPacUrl.trim();
    if (!url) return;
    const existing = loadSavedProxies().filter((p) => p !== url);
    const updated = [url, ...existing].slice(0, 8);
    localStorage.setItem(PROXY_LS_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent(PROXY_LIST_CHANGED_EVENT));
    setSavedProxies(updated);
    if (!activeProxy) {
      setActiveProxyValue(url);
      setActiveProxy(url);
      void syncProxyToServer(url);
    }
    setNewPacUrl("");
    toast({ title: "PAC URL saved" });
  };

  const selectProxy = (url: string) => {
    setActiveProxyValue(url);
    setActiveProxy(url);
    void syncProxyToServer(url);
    toast({ title: "Active proxy updated" });
  };

  const clearActiveProxy = () => {
    setActiveProxyValue("");
    setActiveProxy("");
    void syncProxyToServer("");
    toast({ title: "Active proxy cleared" });
  };

  const removeProxy = (url: string) => {
    const remaining = loadSavedProxies().filter((p) => p !== url);
    localStorage.setItem(PROXY_LS_KEY, JSON.stringify(remaining));
    window.dispatchEvent(new CustomEvent(PROXY_LIST_CHANGED_EVENT));
    setSavedProxies(remaining);
    if (activeProxy === url) {
      setActiveProxyValue("");
      setActiveProxy("");
      void syncProxyToServer("");
    }
    toast({ title: "PAC URL removed" });
  };

  const testProxy = async (proxyUrl: string) => {
    setTestingProxy(proxyUrl);
    try {
      const resp = await fetch("/api/admin/proxy/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxyUrl }),
      });
      const data = (await resp.json()) as { ok: boolean; ms?: number; error?: string };
      if (data.ok) {
        toast({
          title: "Proxy reachable",
          description: `HTTPS tunneling confirmed in ${data.ms}ms`,
        });
      } else {
        toast({
          title: "Proxy test failed",
          description: data.error ?? "Unknown error",
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "Proxy test failed", description: "Network error — could not reach API", variant: "destructive" });
    } finally {
      setTestingProxy(null);
    }
  };

  return (
    <div className="relative w-full space-y-5 pb-10 pt-1">
      <header className="relative flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[.2em] text-primary">Workspace</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">Settings</h1>
          <p className="mt-1 text-xs text-muted-foreground">Manage your appearance, scan, and proxy preferences.</p>
        </div>
        <Button
          type="button"
          className="h-9 rounded-xl px-4 text-xs font-semibold shadow-[0_8px_18px_rgba(109,72,199,.20)]"
          onClick={() => toast({ title: "Settings save automatically", description: "Your preferences are applied as you update them." })}
        >
          <CheckCircle2 className="mr-2 h-3.5 w-3.5" />
          Saved automatically
        </Button>
      </header>

      <Tabs defaultValue="appearance" className="relative">
        <TabsList className="mb-5 flex h-auto w-fit flex-wrap justify-start gap-1 rounded-2xl border border-white/80 bg-card/75 p-1.5 shadow-[0_8px_20px_rgba(69,57,112,.05)] backdrop-blur-xl">
          <TabsTrigger value="appearance" className="gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold text-muted-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_4px_12px_rgba(109,72,199,.2)]">
            <Sun className="w-3.5 h-3.5" />
            Appearance
          </TabsTrigger>
          <TabsTrigger value="scan" className="gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold text-muted-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_4px_12px_rgba(109,72,199,.2)]">
            <Clock className="w-3.5 h-3.5" />
            Scan defaults
          </TabsTrigger>
          <TabsTrigger value="proxy" className="gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold text-muted-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_4px_12px_rgba(109,72,199,.2)]">
            <Shield className="w-3.5 h-3.5" />
            Proxy &amp; tools
          </TabsTrigger>
        </TabsList>

        {/* ── Appearance tab ──────────────────────────────────────────────── */}
        <TabsContent value="appearance" className="space-y-5 mt-0">
          {canEditLogo && <LogoSettingsCard />}

          <Card className={SETTINGS_CARD_CLASS}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Sun className="w-5 h-5 text-muted-foreground" />
                <CardTitle>Appearance</CardTitle>
              </div>
              <CardDescription>
                Choose a colour scheme for the interface.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {(
                  [
                    { value: "light", label: "Light", icon: Sun },
                    { value: "dark", label: "Dark", icon: Moon },
                    { value: "system", label: "System", icon: Monitor },
                  ] as { value: Theme; label: string; icon: React.ElementType }[]
                ).map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => handleThemeChange(value)}
                    className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all ${
                      theme === value
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border hover:border-primary/40 hover:bg-muted/40 text-muted-foreground"
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-sm font-medium">{label}</span>
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  Glass themes
                </p>
                <div className="grid grid-cols-3 gap-3">
                  {(
                    [
                      {
                        value: "glass-dark" as Theme,
                        label: "Glass Dark",
                        icon: Gem,
                        desc: "Deep space aurora",
                        gradient: "from-violet-900 via-indigo-900 to-slate-900",
                      },
                      {
                        value: "glass-light" as Theme,
                        label: "Glass Light",
                        icon: Sparkles,
                        desc: "Frosted crystal",
                        gradient: "from-violet-100 via-fuchsia-100 to-sky-100",
                      },
                      {
                        value: "glass-vision" as Theme,
                        label: "Vision Pro",
                        icon: Gem,
                        desc: "Spatial computing",
                        gradient: "from-slate-900 via-teal-950 to-cyan-950",
                      },
                      {
                        value: "glass-vision-light" as Theme,
                        label: "Vision Pro Light",
                        icon: Sparkles,
                        desc: "Bright spatial glass",
                        gradient: "from-sky-100 via-cyan-50 to-slate-200",
                      },
                    ]
                  ).map(({ value, label, icon: Icon, desc, gradient }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => handleThemeChange(value)}
                      className={`relative flex flex-col items-start gap-2 p-3.5 rounded-lg border-2 transition-all overflow-hidden text-left ${
                        theme === value
                          ? "border-primary text-primary"
                          : "border-border hover:border-primary/40 text-muted-foreground"
                      }`}
                    >
                      <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-20 pointer-events-none`} />
                      <div className={`relative flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br ${gradient} shadow-sm shrink-0`}>
                        <Icon className={`w-4.5 h-4.5 ${theme === value ? "text-primary" : "text-foreground/70"}`} />
                      </div>
                      <div className="relative min-w-0">
                        <p className="text-sm font-semibold leading-none">{label}</p>
                        <p className="text-[11px] text-muted-foreground mt-1">{desc}</p>
                      </div>
                      {theme === value && (
                        <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3 border-t pt-4">
                <div className="flex items-start gap-2">
                  <Palette className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-semibold">Accent colour</p>
                    <p className="text-xs text-muted-foreground">
                      Set the navigation rail, active states, buttons, and focus colour.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {(Object.keys(ACCENT_COLORS) as AccentColor[]).map((value) => {
                    const option = ACCENT_COLORS[value];
                    const selected = accent === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        data-testid={`button-accent-${value}`}
                        aria-pressed={selected}
                        aria-label={`${option.label} accent`}
                        onClick={() => handleAccentChange(value)}
                        className={`group flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-all ${
                          selected
                            ? "border-primary bg-primary/8 ring-2 ring-primary/20"
                            : "border-border hover:border-primary/50 hover:bg-muted/50"
                        }`}
                      >
                        <span
                          className="h-7 w-7 shrink-0 rounded-md shadow-sm ring-2 ring-background"
                          style={{ backgroundColor: option.swatch }}
                        />
                        <span className={`text-xs font-medium ${selected ? "text-primary" : "text-muted-foreground"}`}>
                          {option.label}
                        </span>
                        {selected && (
                          <CheckCircle2 className="ml-auto h-4 w-4 shrink-0 text-primary" />
                        )}
                      </button>
                    );
                  })}
                  <label
                    data-testid="button-accent-custom"
                    className={`group flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-all ${
                      accent.startsWith("#")
                        ? "border-primary bg-primary/8 ring-2 ring-primary/20"
                        : "border-border hover:border-primary/50 hover:bg-muted/50"
                    }`}
                  >
                    <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded-md shadow-sm ring-2 ring-background">
                      <span
                        className="absolute inset-0"
                        style={{
                          background: accent.startsWith("#")
                            ? accent
                            : "conic-gradient(from 0deg, #f44, #fa0, #ff4, #4f4, #4ff, #44f, #f4f, #f44)",
                        }}
                      />
                      <input
                        type="color"
                        aria-label="Pick a custom accent colour"
                        value={accent.startsWith("#") ? accent : "#3b82f6"}
                        onChange={(e) => handleAccentChange(e.target.value)}
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                      />
                    </span>
                    <span className={`text-xs font-medium ${accent.startsWith("#") ? "text-primary" : "text-muted-foreground"}`}>
                      {accent.startsWith("#") ? `Custom ${accent}` : "Custom…"}
                    </span>
                    {accent.startsWith("#") && (
                      <CheckCircle2 className="ml-auto h-4 w-4 shrink-0 text-primary" />
                    )}
                  </label>
                </div>
              </div>

              {/* ── App background image ── */}
              <div className="space-y-3 border-t pt-4">
                <div className="flex items-start gap-2">
                  <ImageIcon className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-semibold">Background image</p>
                    <p className="text-xs text-muted-foreground">
                      Shown behind the glass themes. Pick a preset or upload your own (under 1.5 MB).
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    data-testid="button-bg-none"
                    aria-pressed={!bgImage}
                    onClick={() => handleBackgroundChange("")}
                    className={`relative flex h-20 items-center justify-center rounded-xl border text-xs font-medium transition-all ${
                      !bgImage
                        ? "border-primary ring-2 ring-primary/20 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    None (theme default)
                  </button>
                  {BACKGROUND_PRESETS.map((preset) => {
                    const selected = bgImage === preset.url;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        data-testid={`button-bg-${preset.id}`}
                        aria-pressed={selected}
                        aria-label={`${preset.label} background`}
                        onClick={() => handleBackgroundChange(preset.url)}
                        className={`relative h-20 overflow-hidden rounded-xl border transition-all ${
                          selected
                            ? "border-primary ring-2 ring-primary/20"
                            : "border-border hover:border-primary/50"
                        }`}
                      >
                        <img
                          src={preset.url}
                          alt={preset.label}
                          className="absolute inset-0 h-full w-full object-cover"
                          loading="lazy"
                        />
                        <span className="absolute inset-x-0 bottom-0 bg-black/45 px-2 py-1 text-left text-[11px] font-medium text-white">
                          {preset.label}
                        </span>
                        {selected && (
                          <CheckCircle2 className="absolute right-1.5 top-1.5 h-4 w-4 text-white drop-shadow" />
                        )}
                      </button>
                    );
                  })}
                  <label
                    data-testid="button-bg-upload"
                    className={`relative flex h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-xs font-medium transition-all ${
                      bgImage.startsWith("data:")
                        ? "border-primary ring-2 ring-primary/20 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    {bgImage.startsWith("data:") ? (
                      <img src={bgImage} alt="Custom background" className="absolute inset-0 h-full w-full rounded-xl object-cover opacity-80" />
                    ) : null}
                    <span className="relative z-10 rounded bg-background/70 px-1.5 py-0.5">
                      {bgImage.startsWith("data:") ? "Custom image" : "Upload image…"}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleBackgroundUpload(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Scan tab ────────────────────────────────────────────────────── */}
        <TabsContent value="scan" className="space-y-5 mt-0">
          <Card className={SETTINGS_CARD_CLASS}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <ListFilter className="w-5 h-5 text-muted-foreground" />
                <CardTitle>URL Limit</CardTitle>
              </div>
              <CardDescription>
                Restrict the number of URLs that can be added to a scan. When
                enabled, adding URLs beyond the limit is blocked and an alert is
                shown.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Enable URL limit</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {urlLimitEnabled
                      ? `Scans are limited to ${urlLimitValue} URL${urlLimitValue === 1 ? "" : "s"}`
                      : "No limit — scans can include any number of URLs"}
                  </p>
                </div>
                <Switch
                  checked={urlLimitEnabled}
                  onCheckedChange={(v) => {
                    setUrlLimitEnabledState(v);
                    localStorage.setItem(URL_LIMIT_LS_KEY, String(v));
                    window.dispatchEvent(new CustomEvent("a11y-url-limit-changed"));
                    toast({
                      title: v
                        ? `URL limit enabled (${urlLimitValue})`
                        : "URL limit disabled",
                    });
                  }}
                />
              </div>

              {urlLimitEnabled && (
                <div className="space-y-2 pt-1 border-t">
                  <Label htmlFor="url-limit-input">Maximum number of URLs</Label>
                  <div className="flex gap-2 items-center max-w-xs">
                    <Input
                      id="url-limit-input"
                      type="number"
                      min={1}
                      max={10000}
                      value={urlLimitInput}
                      onChange={(e) => setUrlLimitInput(e.target.value)}
                      onBlur={() => {
                        const n = parseInt(urlLimitInput, 10);
                        if (!Number.isFinite(n) || n < 1) {
                          setUrlLimitInput(String(urlLimitValue));
                          return;
                        }
                        const clamped = Math.min(Math.max(n, 1), 10000);
                        setUrlLimitValueState(clamped);
                        setUrlLimitInput(String(clamped));
                        localStorage.setItem(URL_LIMIT_VALUE_LS_KEY, String(clamped));
                        window.dispatchEvent(new CustomEvent("a11y-url-limit-changed"));
                        toast({ title: `URL limit set to ${clamped}` });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      className="w-32"
                    />
                    <span className="text-sm text-muted-foreground">URLs maximum</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Enter a number between 1 and 10,000. Changes take effect immediately on the scan page.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className={SETTINGS_CARD_CLASS}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-muted-foreground" />
                <CardTitle>Scan Delay</CardTitle>
                {isSuperAdmin(user) && (
                  <Badge variant="outline" className="ml-auto text-xs text-purple-600 border-purple-300 dark:text-purple-400">Super Admin</Badge>
                )}
              </div>
              <CardDescription>
                How long to wait after <strong>DOMContentLoaded</strong> before running checks. At <strong>0 s</strong> the scanner captures the DOM before JS post-load callbacks (setTimeout, requestAnimationFrame, etc.) have had a chance to patch accessibility issues — this matches the scan point used by leading accessibility platforms. Increasing the delay lets more JS run first, which can cause issues to disappear from results.
                {!isSuperAdmin(user) && " Only super admins can change this setting."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Current value shown to everyone */}
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Current delay:</span>
                <Badge variant="secondary" className="font-mono">
                  {globalTimeoutMs === 0 ? "0s (no delay)" : globalTimeoutMs >= 1000 ? `${globalTimeoutMs / 1000}s` : `${globalTimeoutMs}ms`}
                </Badge>
              </div>

              {isSuperAdmin(user) && (
                <>
                  {/* Preset buttons */}
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wide">Preset values</Label>
                    <div className="flex flex-wrap gap-2">
                      {[{ label: "0s", ms: 0 }, { label: "2s", ms: 2000 }, { label: "5s", ms: 5000 }, { label: "10s", ms: 10000 }, { label: "30s", ms: 30000 }].map(({ label, ms }) => {
                        const active = globalTimeoutMs === ms;
                        return (
                          <Button
                            key={ms}
                            size="sm"
                            variant={active ? "default" : "outline"}
                            className={`text-xs h-8 px-3 ${active ? "" : "text-muted-foreground"}`}
                            onClick={() => saveScanDelay(ms, label)}
                            disabled={savingTimeout}
                          >
                            {label}
                          </Button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Custom value */}
                  <div className="space-y-2">
                    <Label htmlFor="custom-timeout" className="text-xs text-muted-foreground uppercase tracking-wide">Custom (seconds)</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="custom-timeout"
                        type="number"
                        min={0}
                        max={120}
                        placeholder="e.g. 3"
                        value={customTimeoutSecs}
                        onChange={(e) => setCustomTimeoutSecs(e.target.value)}
                        className="w-28 h-8 text-sm"
                        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        disabled={savingTimeout || customTimeoutSecs === ""}
                        onClick={() => {
                          const secs = parseFloat(customTimeoutSecs);
                          if (!Number.isFinite(secs) || secs < 0 || secs > 120) {
                            toast({ title: "Enter a value between 0 and 120 seconds", variant: "destructive" });
                            return;
                          }
                          saveScanDelay(Math.round(secs * 1000), `${secs}s`);
                        }}
                      >
                        {savingTimeout ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Apply"}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">5–300 seconds. The hard-abort deadline is 20 s beyond this value.</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {isSuperAdmin(user) && (
            <Card className={SETTINGS_CARD_CLASS}>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-muted-foreground" />
                  <CardTitle>Smart Analysis AI</CardTitle>
                </div>
                <CardDescription>
                  When enabled, users with Smart Analysis access can request AI-generated
                  insights for individual components — root cause, fix strategy, and priority.
                  Requires an external AI provider to be configured in the Admin panel.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Enable AI insights for Smart Analysis</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Adds a per-component &ldquo;Get AI Insights&rdquo; button in Smart Analysis
                    </p>
                  </div>
                  <Switch
                    checked={smartAnalysisAiEnabled}
                    disabled={savingSmartAi}
                    onCheckedChange={async (v) => {
                      setSavingSmartAi(true);
                      try {
                        const r = await fetch(`${BASE}/api/admin/settings`, {
                          method: "PUT",
                          credentials: "include",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ smart_analysis_ai_enabled: String(v) }),
                        });
                        if (r.ok) {
                          setSmartAnalysisAiEnabled(v);
                          toast({ title: v ? "Smart Analysis AI enabled" : "Smart Analysis AI disabled" });
                        } else {
                          toast({ title: "Failed to save setting", variant: "destructive" });
                        }
                      } finally {
                        setSavingSmartAi(false);
                      }
                    }}
                  />
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Proxy & Tools tab ───────────────────────────────────────────── */}
        <TabsContent value="proxy" className="space-y-5 mt-0">
          <Card className={SETTINGS_CARD_CLASS}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-muted-foreground" />
                <CardTitle>Proxy Configuration</CardTitle>
              </div>
              <CardDescription>
                Add and manage proxy URLs for scanning environments behind a
                corporate proxy. Supports PAC files (<code className="font-mono text-xs">http://host/proxy.pac</code>),
                HTTP proxies (<code className="font-mono text-xs">http://host:port</code>), and SOCKS4/5 proxies (<code className="font-mono text-xs">socks4://host:port</code>).
                The active proxy is used when proxy mode is enabled on the scan page.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-lg border p-4 space-y-2">
                <p className="text-sm font-medium">Active Proxy</p>
                {activeProxy ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
                    <code className="text-sm font-mono text-blue-700 dark:text-blue-400 flex-1 break-all">
                      {activeProxy}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive shrink-0"
                      onClick={clearActiveProxy}
                    >
                      Clear
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    No active proxy set. Select one below or add a new one.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Add Proxy URL</Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="socks4://host:port  or  http://host:port  or  http://host/proxy.pac"
                    value={newPacUrl}
                    onChange={(e) => setNewPacUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addProxy();
                    }}
                    className="font-mono text-sm"
                  />
                  <Button onClick={addProxy} disabled={!newPacUrl.trim()}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add
                  </Button>
                </div>
              </div>

              {savedProxies.length > 0 ? (
                <div className="space-y-2">
                  <Label>Saved Proxy URLs</Label>
                  <div className="border rounded-md overflow-hidden divide-y">
                    {savedProxies.map((pac) => (
                      <div
                        key={pac}
                        className={`flex items-center gap-3 px-4 py-3 group ${activeProxy === pac ? "bg-blue-50 dark:bg-blue-950/20" : "hover:bg-muted/40"}`}
                      >
                        <code className="flex-1 text-xs font-mono truncate" title={pac}>
                          {pac}
                        </code>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                            disabled={testingProxy === pac}
                            onClick={() => void testProxy(pac)}
                            title="Test if this proxy supports HTTPS tunneling"
                          >
                            {testingProxy === pac ? (
                              <span className="flex items-center gap-1">
                                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                                </svg>
                                Testing…
                              </span>
                            ) : "Test"}
                          </Button>
                          {activeProxy === pac ? (
                            <Badge
                              variant="secondary"
                              className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-xs"
                            >
                              <CheckCircle2 className="w-3 h-3 mr-1" />
                              Active
                            </Badge>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => selectProxy(pac)}
                            >
                              Use this
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => removeProxy(pac)}
                            aria-label="Remove"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No PAC URLs saved yet. Add one above.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className={SETTINGS_CARD_CLASS}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Eye className="w-5 h-5 text-muted-foreground" />
                <CardTitle>Element Viewer</CardTitle>
              </div>
              <CardDescription>
                When enabled, a side panel appears next to Page Results on each scan
                detail page. Click any issue occurrence to inspect its HTML source
                and live page preview, and navigate between occurrences with Prev /
                Next controls.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Enable Element Viewer</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Shows HTML source viewer and live page preview alongside issue results
                  </p>
                </div>
                <Switch
                  checked={elementViewerEnabled}
                  onCheckedChange={(v) => {
                    setElementViewerEnabledState(v);
                    localStorage.setItem(ELEMENT_VIEWER_LS_KEY, String(v));
                    window.dispatchEvent(new Event("storage"));
                    toast({
                      title: v
                        ? "Element Viewer enabled"
                        : "Element Viewer disabled",
                    });
                  }}
                />
              </div>

              {(isSuperAdmin(user) || user?.permissions.canViewHtmlReplay) && (
                <div className="flex items-center justify-between pt-4 border-t">
                  <div>
                    <p className="text-sm font-medium">Enable HTML Page Replay</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Adds an option in the Element Viewer to render the stored HTML of the page (sandboxed, scripts disabled). Image snapshot remains the default.
                    </p>
                  </div>
                  <Switch
                    checked={htmlReplayEnabled}
                    onCheckedChange={(v) => {
                      setHtmlReplayEnabledState(v);
                      localStorage.setItem(HTML_REPLAY_LS_KEY, String(v));
                      window.dispatchEvent(new CustomEvent(HTML_REPLAY_CHANGED_EVENT, { detail: { enabled: v } }));
                      toast({
                        title: v
                          ? "HTML Page Replay enabled"
                          : "HTML Page Replay disabled",
                      });
                    }}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
