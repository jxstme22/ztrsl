import { z } from "zod";

/**
 * Interface language support (Chinese Simplified).
 *
 * The app's inference pipeline already supports Chinese speech and a `zh`
 * target language; this adds a Chinese (Simplified) UI so Chinese speakers can
 * use the whole interface without translating it. Language is chosen on the
 * welcome card before first use and can be changed anytime in Settings.
 */

export const uiLanguageSchema = z.enum(["en", "zh"]);
export type UiLanguage = z.infer<typeof uiLanguageSchema>;

export type UIString = {
  en: string;
  zh: string;
};

const UI_STRINGS = {
  // Nav
  navLive: { en: "Live", zh: "实时" },
  navModels: { en: "Models", zh: "模型" },
  navSetup: { en: "Setup", zh: "设置向导" },
  navSources: { en: "Sources", zh: "音频源" },
  navSettings: { en: "Settings", zh: "设置" },
  navDiagnostics: { en: "Diagnostics", zh: "诊断" },

  // Common
  install: { en: "Install", zh: "安装" },
  cancel: { en: "Cancel", zh: "取消" },
  close: { en: "Close", zh: "关闭" },
  delete: { en: "Delete", zh: "删除" },
  retry: { en: "Try again", zh: "重试" },
  recommended: { en: "Recommended", zh: "推荐" },
  exportBundle: { en: "Export support bundle", zh: "导出支持包" },

  // Welcome
  welcomeTitle: { en: "Welcome to xTRSNLTR", zh: "欢迎使用 xTRSNLTR" },
  welcomeSub: {
    en: "VALORANT voice chat, captioned in English — on this PC.",
    zh: "在本机为 VALORANT 语音聊天生成英文字幕。",
  },
  welcomeListen: { en: "Listen", zh: "聆听" },
  welcomeListenText: { en: "Captures voice chat", zh: "捕获语音聊天" },
  welcomeTranslate: { en: "Translate", zh: "翻译" },
  welcomeTranslateText: {
    en: "Tagalog & Cebuano to English",
    zh: "他加禄语与宿务语 → 英语",
  },
  welcomePrivate: { en: "Private", zh: "私密" },
  welcomePrivateText: { en: "Runs on this PC", zh: "仅在本机运行" },
  welcomePickModels: { en: "Pick your models", zh: "选择模型" },
  welcomePickText: {
    en: "Start with the recommended pair. Downloads are verified and can be changed anytime in the Models tab.",
    zh: "从推荐组合开始。下载经过校验，可随时在“模型”页更改。",
  },
  welcomeSpeechRecognition: { en: "Speech recognition", zh: "语音识别" },
  welcomeTranslation: { en: "Translation", zh: "翻译" },
  welcomeShowOptional: { en: "Show optional model", zh: "显示可选模型" },
  welcomeReadingCatalog: {
    en: "Reading the model catalog…",
    zh: "正在读取模型目录…",
  },
  welcomeCatalogError: {
    en: "Could not load the model catalog.",
    zh: "无法加载模型目录。",
  },
  welcomeFoot: {
    en: "You can start and stop subtitles from the Live tab once a model is installed.",
    zh: "安装模型后，可在“实时”页开启或关闭字幕。",
  },
  welcomeChooseLanguage: {
    en: "Interface language",
    zh: "界面语言",
  },

  // Settings
  settingsOverlayAppearance: { en: "Overlay appearance", zh: "字幕外观" },
  settingsTranslationPreview: { en: "Translation preview", zh: "翻译预览" },
  settingsTranslationPreviewText: {
    en: "Pause subtitles without hiding the overlay.",
    zh: "暂停字幕但不隐藏字幕层。",
  },
  settingsShowSource: { en: "Show source line", zh: "显示原文行" },
  settingsShowSourceText: {
    en: "Original text above the English line.",
    zh: "在英文字幕上方显示原文。",
  },
  settingsSimultaneous: { en: "Simultaneous captions", zh: "同时显示字幕" },
  settingsSimultaneousNote: {
    en: "How overlapping speech from different sources is shown.",
    zh: "不同来源的语音同时出现时的显示方式。",
  },
  settingsPrimarySource: { en: "Primary source", zh: "主音源" },
  settingsPrimarySourceNote: {
    en: "Which source owns the first lane under the simultaneous policy.",
    zh: "在同时显示策略下，哪个来源占据第一条字幕道。",
  },
  settingsShowBoth: { en: "Show both lanes", zh: "同时显示两条" },
  settingsNewestWins: { en: "Newest caption wins", zh: "最新字幕优先" },
  settingsPrimaryWins: { en: "Primary source wins", zh: "主音源优先" },
  settingsAutoPrimary: { en: "Auto (newest first)", zh: "自动（最新优先）" },
  settingsWidth: { en: "Width", zh: "宽度" },
  settingsTextSize: { en: "Text size", zh: "字号" },
  settingsBackground: { en: "Background", zh: "背景" },
  settingsResetPosition: { en: "Reset position", zh: "重置位置" },
  settingsHotkeys: { en: "Hotkeys", zh: "快捷键" },
  settingsInterfaceLanguage: { en: "Interface language", zh: "界面语言" },
  settingsInterfaceLanguageNote: {
    en: "Switch the whole interface between English and Chinese.",
    zh: "在英语与简体中文之间切换整个界面。",
  },
  english: { en: "English", zh: "英语" },
  chineseSimplified: { en: "Chinese (Simplified)", zh: "简体中文" },
} satisfies Record<string, UIString>;

export type UIKey = keyof typeof UI_STRINGS;

export function translate(key: UIKey, language: UiLanguage): string {
  const entry = UI_STRINGS[key];
  return entry[language];
}

export const UI_KEYS = Object.keys(UI_STRINGS) as UIKey[];

/** The subset of strings the welcome card needs (kept small and explicit). */
export const WELCOME_KEYS = [
  "welcomeTitle",
  "welcomeSub",
  "welcomeListen",
  "welcomeListenText",
  "welcomeTranslate",
  "welcomeTranslateText",
  "welcomePrivate",
  "welcomePrivateText",
  "welcomePickModels",
  "welcomePickText",
  "welcomeSpeechRecognition",
  "welcomeTranslation",
  "welcomeShowOptional",
  "welcomeReadingCatalog",
  "welcomeCatalogError",
  "welcomeFoot",
  "welcomeChooseLanguage",
  "install",
  "recommended",
  "cancel",
  "retry",
] as const satisfies readonly UIKey[];
