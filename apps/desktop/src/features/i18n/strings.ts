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

  // Models page
  modelsInstalled: { en: "Installed", zh: "已安装" },
  modelsAvailable: { en: "Available to install", zh: "可安装" },
  modelsLocalExports: { en: "Local exports (NCSpeech)", zh: "本地导出（NCSpeech）" },
  modelsSpeechRecognition: { en: "Speech recognition", zh: "语音识别" },
  modelsTranslation: { en: "Translation", zh: "翻译" },
  modelsOnDisk: { en: "on disk", zh: "已存在" },
  modelsDownload: { en: "download", zh: "下载" },
  modelsLocalExportHint: { en: "Requires local export", zh: "需要本地导出" },
  modelsDownloadServer: { en: "Download server", zh: "下载服务器" },
  modelsOfflinePack: { en: "Install offline model pack", zh: "安装离线模型包" },
  modelsImport: { en: "Import", zh: "导入" },
  modelsNoInstalled: { en: "No models installed yet.", zh: "尚未安装模型。" },
  modelsNoAvailable: { en: "No models available.", zh: "没有可用模型。" },
  modelsInstallAction: { en: "Install", zh: "安装" },

  // Sources page
  sourcesTitle: { en: "Audio sources", zh: "音频源" },
  sourcesName: { en: "Name", zh: "名称" },
  sourcesCaptionTag: { en: "Caption tag", zh: "字幕标签" },
  sourcesLabelStyle: { en: "Label style", zh: "标签样式" },
  sourcesColor: { en: "Color", zh: "颜色" },
  sourcesLanguageProfile: { en: "Language profile", zh: "语言档案" },
  sourcesStrictness: { en: "Strictness", zh: "严格度" },
  sourcesAdd: { en: "Add source", zh: "添加音频源" },
  sourcesRemove: { en: "Remove", zh: "移除" },

  // Diagnostics page
  diagnosticsTitle: { en: "Diagnostics", zh: "诊断" },
  diagnosticsScheduler: { en: "Scheduler", zh: "调度器" },
  diagnosticsSources: { en: "Sources", zh: "音频源" },
  diagnosticsIsolation: { en: "Isolation check", zh: "隔离检查" },
  diagnosticsExport: { en: "Export support bundle", zh: "导出支持包" },
  diagnosticsNoSources: {
    en: "No active sources. Start a live session to see per-source metrics.",
    zh: "没有活动音源。启动实时会话以查看各音源指标。",
  },

  // Live page
  liveSpeechRecognitionSource: {
    en: "Speech recognition source",
    zh: "语音识别来源",
  },
  liveTranslationSource: { en: "Translation source", zh: "翻译来源" },
  liveNotInstalled: { en: "not installed", zh: "未安装" },
  liveStart: { en: "Start subtitles", zh: "开始字幕" },
  liveStop: { en: "Stop subtitles", zh: "停止字幕" },

  // Common
  speechRecognition: { en: "Speech recognition", zh: "语音识别" },
  translation: { en: "Translation", zh: "翻译" },
  closeApp: { en: "Close", zh: "关闭" },
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
