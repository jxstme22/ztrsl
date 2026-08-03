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
  modelsLocalExports: {
    en: "Local exports (NCSpeech)",
    zh: "本地导出（NCSpeech）",
  },
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
  modelsInstalledCount: {
    en: "installed",
    zh: "已安装",
  },
  modelsAvailableCount: { en: "available", zh: "可安装" },
  modelsPageDescription: {
    en: "Model files are downloaded only when you choose them, from the pinned official sources referenced in the confirmation dialogs. Nothing is fetched at install time. Installed models are verified by checksum on disk.",
    zh: "模型文件仅在你选择时从确认对话框中列出的固定官方来源下载。安装时不会获取其他内容。已安装的模型会在磁盘上进行校验和验证。",
  },
  modelsLocalExportsDescription: {
    en: "Fixed-language CTC models generated on this PC via",
    zh: "在本机通过以下脚本生成的固定语言 CTC 模型",
  },
  modelsSpeechRecognitionLabel: {
    en: "Speech recognition",
    zh: "语音识别",
  },
  modelsTranslationLabel: { en: "Translation", zh: "翻译" },
  modelsOnDiskMeta: { en: "on disk", zh: "已存在" },
  modelsDownloadMeta: { en: "download", zh: "下载" },
  modelsCapabilityForced: {
    en: "Fixed-language decoder",
    zh: "固定语言解码器",
  },
  modelsCapabilityPreferred: {
    en: "Language-biased (no hard lock)",
    zh: "语言偏置（无硬性锁定）",
  },
  modelsCapabilityPostFilter: {
    en: "Filters after recognition",
    zh: "识别后过滤",
  },
  modelsVramLow: { en: "Low VRAM", zh: "低显存" },
  modelsVramMedium: { en: "Medium VRAM", zh: "中显存" },
  modelsVramHigh: { en: "High VRAM", zh: "高显存" },
  modelsNonCommercial: { en: "Non-commercial", zh: "非商用" },
  modelsRecommended: { en: "Recommended", zh: "推荐" },
  modelsLocalExportBadge: { en: "Local export", zh: "本地导出" },
  modelsDeleteAction: { en: "Delete", zh: "删除" },
  modelsInstallAction2: { en: "Install", zh: "安装" },
  modelsCancelInstall: { en: "Cancel", zh: "取消" },
  modelsInUseTitle: {
    en: "In use by the live session",
    zh: "实时会话正在使用",
  },
  modelsDialogInstallTitle: { en: "Install", zh: "安装" },
  modelsDialogDeleteTitle: { en: "Delete", zh: "删除" },
  modelsDialogType: { en: "Type", zh: "类型" },
  modelsDialogDownloadSize: { en: "Download size", zh: "下载大小" },
  modelsDialogLicense: { en: "License", zh: "许可证" },
  modelsDialogSource: { en: "Source", zh: "来源" },
  modelsDialogFiles: { en: "Files", zh: "文件" },
  modelsDialogFileArtifacts: { en: "checksums verified", zh: "校验和已验证" },
  modelsDialogDeleteBody: {
    en: "This removes {model} and frees {size}. You can reinstall it later. {inUse}",
    zh: "这将移除 {model} 并释放 {size}。你可以稍后重新安装。{inUse}",
  },
  modelsDialogInUseNotice: {
    en: "It is in use — stop the live session first.",
    zh: "该模型正在使用中——请先停止实时会话。",
  },
  modelsDialogDownloadInstall: {
    en: "Download & install",
    zh: "下载并安装",
  },
  modelsPageTitle: { en: "Models", zh: "模型" },

  // GPU acceleration (CUDA runtime pack)
  gpuInstall: { en: "Enable GPU acceleration", zh: "启用 GPU 加速" },
  gpuTitle: { en: "GPU acceleration", zh: "GPU 加速" },
  gpuDescription: {
    en: "Run local ASR and translation on your NVIDIA GPU instead of CPU. A one-time, checksum-verified download (~1.3 GB); nothing ships in the installer.",
    zh: "让本地语音识别与翻译在 NVIDIA GPU 上运行，而不是 CPU。一次性、经校验的下载（约 1.3 GB）；安装包中不包含任何内容。",
  },
  gpuInstalled: { en: "Installed", zh: "已安装" },
  gpuRemove: { en: "Remove CUDA runtime", zh: "移除 CUDA 运行时" },
  gpuDownloadSize: { en: "Download size", zh: "下载大小" },
  gpuDownloading: { en: "Downloading", zh: "下载中" },

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
  sourcesUnnamed: { en: "Unnamed source", zh: "未命名音源" },

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
  diagnosticsQueueDepth: { en: "Queue depth", zh: "队列深度" },
  diagnosticsOldestQueued: { en: "Oldest queued", zh: "最旧排队" },
  diagnosticsAvgDelay: { en: "Avg delay", zh: "平均延迟" },
  diagnosticsMaxDelay: { en: "Max delay", zh: "最大延迟" },
  diagnosticsIsolationOk: { en: "Clean", zh: "干净" },
  diagnosticsIsolationLeak: { en: "Leakage detected", zh: "检测到泄漏" },

  // Live page
  liveSpeechRecognitionSource: {
    en: "Speech recognition source",
    zh: "语音识别来源",
  },
  liveTranslationSource: { en: "Translation source", zh: "翻译来源" },
  liveNotInstalled: { en: "not installed", zh: "未安装" },
  liveStart: { en: "Start subtitles", zh: "开始字幕" },
  liveStop: { en: "Stop subtitles", zh: "停止字幕" },
  liveStartListening: { en: "Start listening", zh: "开始聆听" },
  liveStopListening: { en: "Stop listening", zh: "停止聆听" },
  liveLoadingModels: { en: "Loading models…", zh: "正在加载模型…" },
  liveStopping: { en: "Stopping", zh: "正在停止" },
  liveNeedsAttention: { en: "Needs attention", zh: "需要注意" },
  liveSimulatorMode: { en: "Simulator mode", zh: "模拟器模式" },
  liveSimulatorModeText: {
    en: "Generated signal — real capture activates in the Windows build.",
    zh: "生成的信号——真实采集将在 Windows 版本中启用。",
  },
  liveVoiceChatChannel: { en: "Voice-chat channel", zh: "语音聊天频道" },
  liveChooseInput: {
    en: "Choose incoming communications…",
    zh: "选择传入的通讯…",
  },
  liveSourceLanguage: { en: "Source language", zh: "源语言" },
  liveOutputLanguage: { en: "Output language", zh: "目标语言" },
  liveSpeechRecognition: { en: "Speech recognition", zh: "语音识别" },
  liveMonitoringOutput: { en: "Monitoring output", zh: "监听输出" },
  liveCustomHttp: { en: "Custom HTTP endpoint", zh: "自定义 HTTP 端点" },
  liveCaptions: { en: "Captions", zh: "字幕" },
  livePackets: { en: "Packets", zh: "数据包" },
  liveDrops: { en: "Drops", zh: "丢失" },
  liveCouldNotContinue: {
    en: "Live translation could not continue",
    zh: "实时翻译无法继续",
  },

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
