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
  navSetup: { en: "Profile", zh: "配置文件" },
  navAbout: { en: "About", zh: "关于" },
  navModels: { en: "Models", zh: "模型" },
  navHistory: { en: "History", zh: "历史" },
  navSources: { en: "Sources", zh: "音频源" },
  navSettings: { en: "Settings", zh: "设置" },
  navDiagnostics: { en: "Diagnostics", zh: "诊断" },

  // Captions history
  historyTitle: { en: "Captions history", zh: "字幕历史" },
  historyClear: { en: "Clear", zh: "清空" },
  historyShowTranscribed: {
    en: "Transcribed input",
    zh: "转写原文",
  },
  historySessions: { en: "Sessions", zh: "会话" },
  historySessionPrefix: { en: "Session", zh: "会话" },
  historyLiveSession: { en: "Live session", zh: "当前实时会话" },
  historyRename: { en: "Rename session", zh: "重命名会话" },
  historyRenameSave: { en: "Save name", zh: "保存名称" },
  historyDelete: { en: "Delete session", zh: "删除会话" },
  historyDeleteConfirm: { en: "Confirm delete?", zh: "确认删除？" },
  historySettings: { en: "Display options", zh: "显示选项" },
  historyShowSpeaker: { en: "Speaker names", zh: "说话人名称" },
  historyShowTimestamp: { en: "Timestamps", zh: "时间戳" },
  historyShowLatency: { en: "Latency", zh: "延迟" },
  historyShowModels: { en: "Model badges", zh: "模型标签" },
  historyShowAvatars: { en: "Profile icons", zh: "头像图标" },
  historyBubbleColor: {
    en: "Tint bubbles with source colors",
    zh: "气泡使用来源颜色",
  },
  historyYou: { en: "You", zh: "你" },
  historyCopy: { en: "Copy translation", zh: "复制译文" },
  historySearch: { en: "Search captions", zh: "搜索字幕" },
  historySearchEmpty: { en: "No captions match the search.", zh: "没有匹配搜索的字幕。" },
  historyClearSession: { en: "Clear session messages", zh: "清空会话消息" },
  historySessionEmpty: {
    en: "This session has no finished captions yet.",
    zh: "此会话还没有已完成的字幕。",
  },
  profilesTitle: { en: "Saved profiles", zh: "已保存的配置" },
  profilesStart: { en: "Start", zh: "开始" },
  profilesNeedAttention: {
    en: "Needs attention",
    zh: "需要处理",
  },
  historyEmpty: {
    en: "No finished captions yet. Start a live session — only finalized captions are saved here.",
    zh: "暂无已完成字幕。启动实时会话后，只有最终确定的字幕会被保存到这里。",
  },
  historyUnknownSpeaker: { en: "Unknown speaker", zh: "未知说话人" },
  // Chat + your voice ("you" bubbles)
  chatPlaceholder: {
    en: "Type a message to translate…",
    zh: "输入要翻译的消息…",
  },
  chatSend: { en: "Send", zh: "发送" },
  chatMic: { en: "Translate my voice", zh: "翻译我的语音" },
  chatMicLive: { en: "Your voice is being translated — click to stop", zh: "正在翻译你的语音 — 点击停止" },
  chatMicRequiresLive: {
    en: "Start a live session first, then use the mic button",
    zh: "请先启动实时会话，再使用麦克风按钮",
  },
  chatMicNeedsConfig: {
    en: "Choose your mic and languages in the config first",
    zh: "请先在设置中选择麦克风和语言",
  },
  chatConfig: { en: "Your voice & chat settings", zh: "语音与聊天设置" },
  chatConfigMic: { en: "Microphone", zh: "麦克风" },
  chatConfigNoMic: { en: "No microphone available", zh: "没有可用的麦克风" },
  chatConfigYouSection: { en: "Your voice & chat", zh: "你的语音与聊天" },
  chatConfigLiveSection: {
    en: "Live translation",
    zh: "实时翻译",
  },
  chatConfigLiveEndpoint: {
    en: "Input endpoint",
    zh: "输入端点",
  },
  chatConfigLiveSource: {
    en: "Source language",
    zh: "源语言",
  },
  chatConfigLiveTarget: {
    en: "Translate into",
    zh: "翻译为",
  },
  chatConfigSource: { en: "Your language", zh: "你的语言" },
  chatConfigTarget: { en: "Translate into", zh: "翻译为" },
  chatConfigAuto: {
    en: "Auto (reverse of the live pair)",
    zh: "自动（与实时翻译方向相反）",
  },
  chatConfigAsr: { en: "Voice recognition model", zh: "语音识别模型" },
  chatConfigTranslate: { en: "Translation model", zh: "翻译模型" },
  chatConfigSave: { en: "Save", zh: "保存" },
  chatTranslateFailed: { en: "Translation failed", zh: "翻译失败" },
  chatBubbleSource: { en: "You said", zh: "你说的" },
  chatStandaloneSession: { en: "Chat", zh: "聊天" },
  chatMicUnavailable: {
    en: "The microphone is not available right now",
    zh: "麦克风当前不可用",
  },
  chatMicOpenSettings: {
    en: "Open Settings",
    zh: "打开设置",
  },
  overlayToggleHistory: {
    en: "Toggle captions history on the overlay",
    zh: "在悬浮窗中切换字幕历史",
  },
  overlayAriaLabel: { en: "Caption overlay", zh: "字幕悬浮窗" },
  overlayEditModeHint: {
    en: "Edit mode · drag to position",
    zh: "编辑模式 · 拖动调整位置",
  },
  overlayDragLabel: { en: "Drag caption overlay", zh: "拖动字幕悬浮窗" },
  overlayToggleViewLabel: {
    en: "Switch between captions and history",
    zh: "切换字幕与历史",
  },
  overlayPinLabel: {
    en: "Pin above other apps",
    zh: "置顶于其他应用之上",
  },
  overlayCloseLabel: { en: "Hide caption overlay", zh: "隐藏字幕悬浮窗" },
  overlayDoneEditing: { en: "Done", zh: "完成" },
  overlayHistoryEmpty: { en: "No captions yet", zh: "暂无字幕" },
  overlayCustomize: { en: "Customize overlay", zh: "自定义悬浮窗" },
  overlayCustomizeShow: { en: "Show options", zh: "显示选项" },
  overlayCustomizeHide: { en: "Hide options", zh: "隐藏选项" },
  overlayMoveOverlay: { en: "Move overlay", zh: "移动悬浮窗" },
  overlayDoneMoving: { en: "Done moving", zh: "完成移动" },
  overlayMoveOverlayNote: {
    en: "While live captions are flowing, click Move overlay, drag the overlay window to the spot you want, then click Done on the overlay. Works during an active session — click-through returns automatically.",
    zh: "实时字幕播放时，点击“移动悬浮窗”，将悬浮窗拖到目标位置，然后在悬浮窗上点击“完成”。会话进行中同样适用——完成后自动恢复点击穿透。",
  },

  // Common
  install: { en: "Install", zh: "安装" },
  cancel: { en: "Cancel", zh: "取消" },
  close: { en: "Close", zh: "关闭" },
  delete: { en: "Delete", zh: "删除" },
  retry: { en: "Try again", zh: "重试" },
  recommended: { en: "Recommended", zh: "推荐" },
  exportBundle: { en: "Export support bundle", zh: "导出支持包" },

  // Welcome
  welcomeTitle: { en: "Welcome to yTRSL", zh: "欢迎使用 yTRSL" },
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
  settingsCaptionAlignment: {
    en: "Caption alignment",
    zh: "字幕对齐",
  },
  settingsCaptionAlignmentNote: {
    en: "Paragraph position: left, center, or right. Sources can override this.",
    zh: "段落位置：左、中或右。各音源可单独覆盖此设置。",
  },
  settingsAlignLeft: { en: "Left", zh: "左对齐" },
  settingsAlignCenter: { en: "Center", zh: "居中" },
  settingsAlignRight: { en: "Right", zh: "右对齐" },
  settingsWidth: { en: "Width", zh: "宽度" },
  settingsHeight: { en: "Height", zh: "高度" },
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
  settingsAppearance: { en: "Appearance", zh: "外观" },
  settingsTheme: { en: "Theme", zh: "主题" },
  settingsThemeNote: {
    en: "Pick how the app looks. The transparent glass effect stays in both themes.",
    zh: "选择应用的外观。两种主题都保留透明玻璃效果。",
  },
  themeDark: { en: "Dark", zh: "深色" },
  themeLight: { en: "Light", zh: "浅色" },

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
  gpuNotInstalled: { en: "Not installed", zh: "未安装" },
  gpuRemove: { en: "Remove CUDA runtime", zh: "移除 CUDA 运行时" },
  gpuRemovePartial: {
    en: "Remove leftover CUDA files",
    zh: "移除残留 CUDA 文件",
  },
  gpuDownloadSize: { en: "Download size", zh: "下载大小" },
  gpuDownloading: { en: "Downloading", zh: "下载中" },
  gpuSystemAvailable: { en: "GPU available", zh: "GPU 可用" },
  gpuReady: { en: "GPU ready", zh: "GPU 就绪" },
  gpuSystemAvailableNote: {
    en: "A CUDA runtime is already installed on this system (CUDA Toolkit or the app's runtime pack). No download is needed — local ASR and translation will use your GPU.",
    zh: "本系统已安装 CUDA 运行时（CUDA 工具包或本应用的运行时包）。无需下载——本地语音识别与翻译将使用你的 GPU。",
  },

  // Sources page
  sourcesTitle: { en: "Audio sources", zh: "音频源" },
  sourcesAudioSection: { en: "Audio source", zh: "音频来源" },
  sourcesAudioSource: { en: "Voice input", zh: "语音输入" },
  sourcesAudioSourceNote: {
    en: "Where this channel's voice comes from. Loopback captures whatever plays through a device — no microphone needed. VB-CABLE's CABLE Output appears under microphones.",
    zh: "该频道语音的来源。回环可捕获设备播放的任何声音——无需麦克风。VB-CABLE 的 CABLE Output 会出现在麦克风分组下。",
  },
  sourcesMicrophoneGroup: {
    en: "Microphones (your voice)",
    zh: "麦克风（你的声音）",
  },
  sourcesLoopbackGroup: {
    en: "Loopback (game / teammate mix — no mic)",
    zh: "回环（游戏/队友混合音——无需麦克风）",
  },
  sourcesVbCableMissing: {
    en: "VB-CABLE not detected",
    zh: "未检测到 VB-CABLE",
  },
  sourcesVbCableNotice: {
    en: "VB-CABLE is installed separately from its official source (vb-audio.com). This app never bundles it.",
    zh: "VB-CABLE 需从其官方网站（vb-audio.com）单独安装。本应用绝不捆绑该驱动。",
  },
  sourcesName: { en: "Name", zh: "名称" },
  sourcesCaptionTag: { en: "Caption tag", zh: "字幕标签" },
  sourcesLabelStyle: { en: "Label style", zh: "标签样式" },
  sourcesCaptionAlignment: { en: "Caption alignment", zh: "字幕对齐" },
  sourcesColor: { en: "Color", zh: "颜色" },
  sourcesLanguageProfile: { en: "Language profile", zh: "语言档案" },
  sourcesStrictness: { en: "Strictness", zh: "严格度" },
  sourcesAdd: { en: "Add source", zh: "添加音频源" },
  sourcesRemove: { en: "Remove", zh: "移除" },
  sourcesUnnamed: { en: "Unnamed source", zh: "未命名音源" },
  sourcesMacosHint: {
    en: "Install BlackHole (github.com/ExistentialAudio/BlackHole) and route VALORANT voice-chat output to it, so the app can caption the voice channel without using your microphone. Allow microphone access in System Settings when first capturing.",
    zh: "安装 BlackHole（github.com/ExistentialAudio/BlackHole）并将 VALORANT 语音聊天输出路由到它，应用即可在不使用麦克风的情况下为语音频道生成字幕。首次捕获时请在系统设置中允许麦克风访问。",
  },

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
  diagnosticsScreenRecordingTitle: {
    en: "Screen Recording permission",
    zh: "屏幕录制权限",
  },
  diagnosticsScreenRecordingHint: {
    en: "System Audio (all apps) stays silent until this app has Screen Recording permission. Open System Settings and enable yTSRL, then restart the app.",
    zh: "在授予此应用屏幕录制权限之前，系统音频源将保持静默。请打开系统设置启用 yTSRL，然后重新启动应用。",
  },
  diagnosticsScreenRecordingOpen: {
    en: "Open System Settings",
    zh: "打开系统设置",
  },
  diagnosticsMicrophoneTitle: {
    en: "Microphone permission",
    zh: "麦克风权限",
  },
  diagnosticsMicrophoneHint: {
    en: "A denied or missing microphone permission makes mic capture deliver silence with no error. Enable yTSRL under Microphone, then restart the app.",
    zh: "如果麦克风权限被拒绝或缺失，麦克风采集将静默无声且不报错。请在麦克风设置中启用 yTSRL，然后重新启动应用。",
  },
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
  langen: { en: "English", zh: "英语" },
  langzh: { en: "Chinese (simplified)", zh: "简体中文" },
  langfil: { en: "Filipino / Tagalog", zh: "菲律宾语 / 他加禄语" },
  langfilipino: { en: "Filipino / Taglish", zh: "菲律宾语 / 他加禄英语混合" },
  langchinese: {
    en: "Chinese (Mandarin/Cantonese)",
    zh: "中文（普通话/粤语）",
  },
  langenglish: { en: "English", zh: "英语" },
  langindonesian: {
    en: "Indonesian (Bahasa Indonesia)",
    zh: "印尼语（Bahasa Indonesia）",
  },
  langvietnamese: { en: "Vietnamese", zh: "越南语（Tiếng Việt）" },
  langthai: { en: "Thai", zh: "泰语（ไทย）" },
  langmalay: { en: "Malay (Bahasa Melayu)", zh: "马来语（Bahasa Melayu）" },
  langind: {
    en: "Indonesian (Bahasa Indonesia)",
    zh: "印尼语（Bahasa Indonesia）",
  },
  langvie: { en: "Vietnamese", zh: "越南语（Tiếng Việt）" },
  langtha: { en: "Thai", zh: "泰语（ไทย）" },
  langzsm: { en: "Malay (Bahasa Melayu)", zh: "马来语（Bahasa Melayu）" },
  liveAudioStalled: {
    en: "Audio paused — waiting for the source",
    zh: "音频暂停——等待音源",
  },
  liveCaptionMode: { en: "Translation mode", zh: "翻译模式" },
  liveCaptionModeStreaming: {
    en: "Stream while talking (live preview)",
    zh: "边说边译（实时预览）",
  },
  liveCaptionModeFinal: {
    en: "Wait for utterance end (per chunk)",
    zh: "等说完再译（按语句块）",
  },
  liveCaptionModeNote: {
    en: "Streaming shows a live preview that improves as the speaker continues; final-only waits until the utterance ends and translates the whole chunk once.",
    zh: "流式模式在说话过程中实时预览并逐步修正；仅最终模式等语句说完后一次性翻译整段。",
  },
  liveSegmentation: { en: "Caption style", zh: "字幕分段" },
  liveSegmentationchunk: { en: "Short chunks (fast callouts)", zh: "短句块（快速报点）" },
  liveSegmentationbalanced: { en: "Balanced (auto)", zh: "均衡（自动）" },
  liveSegmentationsentence: { en: "Full sentences", zh: "完整句子" },
  liveSegmentationNotechunk: {
    en: "Finalizes after a short pause (~0.24 s) — best for quick gaming callouts.",
    zh: "短暂停顿（约 0.24 秒）后落定——适合快速报点。",
  },
  liveSegmentationNotebalanced: {
    en: "Pause length follows the sensitivity slider.",
    zh: "停顿长度跟随灵敏度滑块。",
  },
  liveSegmentationNotesentence: {
    en: "Waits for a real pause (~0.9 s) and allows utterances up to 30 s — complete sentences, no mid-phrase cuts.",
    zh: "等待真正停顿（约 0.9 秒），最长语句 30 秒——完整句子，不会中途截断。",
  },
  liveStopListening: { en: "Stop listening", zh: "停止聆听" },
  liveStopConfirmTitle: { en: "End the session?", zh: "结束此会话？" },
  liveStopConfirmBody: {
    en: "Stop live and end session \"{name}\"? The transcript stays in Captions history.",
    zh: "停止实时翻译并结束会话 \"{name}\"？记录会保留在字幕历史中。",
  },
  liveStopConfirmBodyShort: {
    en: "Stop live translation? The transcript stays in Captions history.",
    zh: "停止实时翻译？记录会保留在字幕历史中。",
  },
  liveStopEnd: { en: "End session", zh: "结束会话" },
  liveStopKeep: { en: "Keep open", zh: "保持开启" },
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
  liveListeningForPhrase: {
    en: "Listening for a complete phrase…",
    zh: "正在聆听完整语句…",
  },
  liveDevice: { en: "Device", zh: "设备" },
  settingsHiddenSources: { en: "Hidden sources", zh: "隐藏音源" },
  settingsHideSource: { en: "Hide", zh: "隐藏" },
  settingsHiddenSourcesNote: {
    en: "Stop this source's captions from appearing.",
    zh: "阻止该音源的字幕显示。",
  },
  captionEmptyTitle: { en: "No captions yet", zh: "暂无字幕" },
  captionEmptyNote: {
    en: "Send a fake line to test the full caption lifecycle.",
    zh: "发送一条测试文字以测试完整的字幕流程。",
  },

  // Live API config
  liveGroqApiKey: { en: "Groq API key", zh: "Groq API 密钥" },
  liveQuality: { en: "Quality", zh: "质量" },
  liveQualityfast: { en: "Fast", zh: "快速" },
  liveQualitybalanced: { en: "Balanced", zh: "均衡" },
  liveQualitybest_quality: { en: "Best quality", zh: "最佳质量" },
  liveQualitylow_memory: { en: "Low memory", zh: "低内存" },
  liveAdvanced: { en: "Advanced", zh: "高级" },
  liveNvidiaApiKey: {
    en: "NVIDIA API key (build.nvidia.com, free tier)",
    zh: "NVIDIA API 密钥（build.nvidia.com，免费档）",
  },
  liveNvidiaApiKeyNote: {
    en: "One free key from build.nvidia.com unlocks every NVIDIA NIM endpoint. Audio/text is sent to NVIDIA while these options are selected.",
    zh: "在 build.nvidia.com 获取一个免费密钥即可使用所有 NVIDIA NIM 端点。选择这些选项时，音频/文本会发送到 NVIDIA。",
  },
  liveBaiduAppId: {
    en: "Baidu Translate AppID (fanyi-api.baidu.com, free)",
    zh: "百度翻译 AppID（fanyi-api.baidu.com，免费）",
  },
  liveBaiduSecret: {
    en: "Baidu Translate secret key",
    zh: "百度翻译密钥",
  },
  liveBaiduNote: {
    en: "Free tier from fanyi-api.baidu.com. Hosted in mainland China — works where Google/MyMemory are blocked. Text is sent to Baidu while this provider is selected.",
    zh: "在 fanyi-api.baidu.com 获取免费密钥。服务部署在中国大陆，Google/MyMemory 被屏蔽时可用。选择此提供方时，文本会发送到百度。",
  },
  liveLibreTranslateUrl: {
    en: "LibreTranslate endpoint URL",
    zh: "LibreTranslate 端点 URL",
  },
  liveCustomHttpUrl: {
    en: "Custom HTTP endpoint URL",
    zh: "自定义 HTTP 端点 URL",
  },
  liveProviderConfigNeeded: {
    en: "Provider configuration needed",
    zh: "需要提供方配置",
  },
  liveMonitorCapturedAudio: {
    en: "Monitor captured audio",
    zh: "监听捕获的音频",
  },
  liveChannelMode: {
    en: "Capture mode",
    zh: "捕获模式",
  },
  liveOneChannel: {
    en: "One channel",
    zh: "单通道",
  },
  liveAllSources: {
    en: "All sources ({count})",
    zh: "全部来源（{count}）",
  },
  liveOneChannelNote: {
    en: "Pick one device to caption.",
    zh: "选择一个设备进行字幕翻译。",
  },
  liveAllSourcesNote: {
    en: "Every configured source is captured and captioned with its own tag.",
    zh: "将捕获所有已配置的来源，并分别用各自的标签进行字幕翻译。",
  },
  liveAllSourcesDisabledNote: {
    en: "All sources needs 2+ sources with an audio input — add them on the Sources page.",
    zh: "全部来源需要至少 2 个已配置音频输入的来源——请在“音频源”页面添加。",
  },
  liveSourcesBeingCaptured: {
    en: "Sources being captured",
    zh: "正在捕获的来源",
  },
  liveApiKeyOptional: { en: "API key (optional)", zh: "API 密钥（可选）" },
  liveModelsDownloading: { en: "Downloading", zh: "下载中" },
  liveModelsExtracting: { en: "Extracting", zh: "解压中" },
  liveModelsInstalling: { en: "Installing", zh: "安装中" },
  modelsDownloadServerLabel: { en: "Download server", zh: "下载服务器" },
  modelsAutomatic: { en: "Automatic", zh: "自动" },
  modelsOfflinePackLabel: {
    en: "Install offline model pack",
    zh: "安装离线模型包",
  },
  modelsOfflinePackBrowse: {
    en: "Browse…",
    zh: "浏览…",
  },
  modelsBrowse: { en: "Show in folder", zh: "在文件夹中显示" },
  diagSourceActive: { en: "Active", zh: "活动" },
  diagSourceStopped: { en: "Stopped", zh: "已停止" },
  overlayUnavailable: { en: "Overlay unavailable", zh: "字幕层不可用" },
  overlayMoved: {
    en: "Overlay moved to the primary display",
    zh: "字幕层已移至主显示器",
  },
  overlayMovedNote: {
    en: "The saved monitor was unavailable, so the overlay stayed visible.",
    zh: "已保存的显示器不可用，因此字幕层保持在可见位置。",
  },
  settingsOnScreenCaptions: { en: "On-screen captions", zh: "屏幕字幕" },
  overlayEditMode: { en: "Edit mode", zh: "编辑模式" },
  overlayPlayMode: { en: "Play mode", zh: "播放模式" },
  overlayFinishEditing: { en: "Finish editing", zh: "完成编辑" },
  overlayEditPosition: { en: "Edit position", zh: "编辑位置" },
  settingsHideOverlay: { en: "Hide overlay", zh: "隐藏字幕层" },
  settingsShowOverlay: { en: "Show overlay", zh: "显示字幕层" },
  overlayEnterWindowed: {
    en: "Overlay mode — window shows captions only",
    zh: "悬浮模式——窗口只显示字幕",
  },
  overlayExitWindowed: { en: "Exit overlay", zh: "退出悬浮模式" },
  settingsClear: { en: "Clear", zh: "清除" },
  clipLabTitle: { en: "Test a friends' comms clip", zh: "测试好友的通话片段" },
  clipDemoProviders: { en: "Demo providers", zh: "演示提供方" },
  clipLocalModels: { en: "Local models", zh: "本地模型" },
  clipDropPlaceholder: {
    en: "Drop an MP4, MOV, MKV, or audio file",
    zh: "拖入 MP4、MOV、MKV 或音频文件",
  },
  clipSourceSpeech: { en: "Source speech", zh: "源语音" },
  clipInference: { en: "Inference", zh: "推理" },
  clipDemoPlumbing: { en: "Demo plumbing", zh: "演示管道" },
  clipVerifiedLocal: { en: "Verified local models", zh: "已校验的本地模型" },
  clipAnalyzeFailed: { en: "Clip analysis failed", zh: "片段分析失败" },
  clipAnalyzing: { en: "Analyzing locally…", zh: "正在本地分析…" },
  clipAnalyze: { en: "Analyze clip", zh: "分析片段" },
  clipSafety: {
    en: "Read-only · local-only · memory-only",
    zh: "只读 · 仅本地 · 仅内存",
  },
  clipNoSegments: {
    en: "No speech-like segments were detected. Drop another clip or check that its audio is audible.",
    zh: "未检测到类似语音的片段。请拖入另一个片段，或检查其音频是否可听。",
  },
  clipLowConfidence: { en: "Low confidence", zh: "低置信度" },
  routingSimulatorTitle: {
    en: "Silent pipeline simulator",
    zh: "静默流水线模拟器",
  },
  routingBranchTitle: {
    en: "Monitoring and inference branch",
    zh: "监听与推理分支",
  },
  routingActive: { en: "Routing active", zh: "路由已激活" },
  routingStopped: { en: "Stopped", zh: "已停止" },
  routingUnavailable: { en: "Routing test unavailable", zh: "路由测试不可用" },
  routingGeneratedInput: { en: "Generated input", zh: "生成的输入" },
  routingCaptureSource: { en: "Capture source", zh: "捕获音源" },
  routingSilentOutput: { en: "Silent output sink", zh: "静默输出" },
  routingMonitoringOutput: { en: "Monitoring output", zh: "监听输出" },
  routingSimulatedMonitor: {
    en: "Simulated monitor branch",
    zh: "模拟监听分支",
  },
  routingMonitorBranch: { en: "Monitor branch", zh: "监听分支" },
  routingSimulatedGain: { en: "Simulated monitor gain", zh: "模拟监听增益" },
  routingMonitorVolume: { en: "Monitor volume", zh: "监听音量" },
  routingRunSimulator: { en: "Run pipeline simulator", zh: "运行流水线模拟器" },
  routingStart: { en: "Start routing", zh: "开始路由" },
  routingEndpointsOnly: {
    en: "Ordinary Windows audio endpoints only",
    zh: "仅使用常规 Windows 音频端点",
  },
  ipcSidecarStopped: {
    en: "Sidecar stopped unexpectedly",
    zh: "Sidecar 意外停止",
  },
  ipcLoopbackOnly: { en: "Loopback only", zh: "仅环回" },
  ipcEphemeral: {
    en: "Ephemeral port and launch token",
    zh: "临时端口与启动令牌",
  },
  ipcNoRoundtrip: { en: "No roundtrip yet", zh: "尚无往返" },
  ipcNoModels: { en: "No models loaded", zh: "未加载模型" },
  ipcStarting: { en: "Starting…", zh: "正在启动…" },
  ipcStartFake: { en: "Start fake sidecar", zh: "启动模拟 sidecar" },
  ipcTitle: { en: "Authenticated fake inference", zh: "认证的模拟推理" },
  sourcesBlackHoleDetected: {
    en: "BlackHole detected",
    zh: "已检测到 BlackHole",
  },
  liveSameDeviceWarning: {
    en: "Capture and monitor use the same device",
    zh: "捕获与监听使用了同一设备",
  },
  liveAsrLabel: { en: "ASR", zh: "ASR（语音识别）" },
  sourcesAlignLeft: { en: "Left", zh: "左对齐" },
  sourcesAlignCenter: { en: "Center", zh: "居中" },
  sourcesAlignRight: { en: "Right", zh: "右对齐" },
  modelsImporting: { en: "Importing…", zh: "正在导入…" },
  modelsImportBtn: { en: "Import", zh: "导入" },
  modelsUrlInstallLabel: {
    en: "Install model from URL",
    zh: "从 URL 安装模型",
  },
  modelsUrlInstallModel: { en: "Model", zh: "模型" },
  modelsUrlInstallKind: { en: "Kind", zh: "类型" },
  modelsUrlInstallRuntime: { en: "Runtime", zh: "运行时" },
  modelsUrlInstallUrl: { en: "Download URL", zh: "下载地址" },
  modelsUrlInstallBtn: { en: "Download & install", zh: "下载并安装" },
  modelsUrlInstallIdHint: {
    en: "Pick a known model, or leave empty and type a custom id (lowercase, digits, dashes) when the URL has no manifest. If the URL is an offline-pack archive with a manifest, the manifest decides.",
    zh: "选择已知模型，或在 URL 无清单时留空并填写自定义 id（小写字母、数字、短横线）。如果 URL 是带清单的离线包压缩包，则以清单为准。",
  },
  modelsUrlInstallNote: {
    en: "Point at a zip/tar.bz2 archive (offline-pack layout with manifest.json, or plain model files) or a single model file served over http(s). Every artifact is SHA-256 verified before install; sherpa-onnx CTC imports must contain model.onnx and tokens.txt.",
    zh: "指向 http(s) 提供的 zip/tar.bz2 压缩包（含 manifest.json 的离线包布局，或普通模型文件）或单个模型文件。安装前会对每个产物进行 SHA-256 校验；sherpa-onnx CTC 导入必须包含 model.onnx 和 tokens.txt。",
  },
  modelsCustom: { en: "Custom (URL-imported)", zh: "自定义（URL 导入）" },
  modelsCustomDescription: {
    en: "Models installed from a URL under a custom id. The app stores and verifies them; selecting them as an inference provider requires a matching id/runtime.",
    zh: "通过 URL 以自定义 id 安装的模型。应用会存储并校验它们；要作为推理提供方使用，需要匹配的 id/运行时。",
  },
  modelsInstalledSuffix: { en: "Installed", zh: "已安装" },
  modelsOfflinePackNote: {
    en: "Point at a directory that already contains a manifest-verified model pack. Artifacts are SHA-256 checked and installed with no network.",
    zh: "指向一个已包含经清单校验的模型包的目录。产物将进行 SHA-256 校验并离线安装。",
  },
  modelsNothingImported: {
    en: "Nothing was imported.",
    zh: "没有导入任何内容。",
  },

  // Common
  speechRecognition: { en: "Speech recognition", zh: "语音识别" },
  translation: { en: "Translation", zh: "翻译" },
  closeApp: { en: "Close", zh: "关闭" },

  // Setup wizard
  wizardChooseEndpoint: { en: "Choose an endpoint…", zh: "选择端点…" },
  wizardRouteValorant: { en: "Route VALORANT audio", zh: "路由 VALORANT 音频" },
  wizardGameOutput: { en: "VALORANT game output", zh: "VALORANT 游戏输出" },
  wizardPhysicalHeadphones: {
    en: "Physical headphones (unchanged)",
    zh: "物理耳机（不变）",
  },
  wizardVoiceChatOutput: {
    en: "VALORANT voice chat output",
    zh: "VALORANT 语音聊天输出",
  },
  wizardVbCableDetected: {
    en: "VB-CABLE detected: game voice can be captured as its own source.",
    zh: "已检测到 VB-CABLE：可将游戏语音作为独立音源捕获。",
  },
  wizardHeadphoneOutput: { en: "Headphone output", zh: "耳机输出" },
  wizardMonitorSource: { en: "Monitor", zh: "监听" },
  wizardMonitorSourceNote: {
    en: "Hear this source in your headphones while playing.",
    zh: "游戏时在耳机中收听此音源。",
  },
  wizardBlend: { en: "blend", zh: "混合" },
  wizardBlendOff: { en: "off", zh: "关闭" },

  // Audio device panel
  audioInputMeter: { en: "Voice-chat input meter", zh: "语音聊天输入电平表" },
  audioGeneratedMeter: { en: "Generated signal meter", zh: "生成的信号电平表" },
  audioRefresh: { en: "Refresh", zh: "刷新" },
  audioSimulator: {
    en: "Simulator — not a real audio device",
    zh: "模拟器——不是真实音频设备",
  },
  audioSimulatorNote: {
    en: "Select the generated signal below to test the meter. Real incoming voice-chat devices appear only in the Windows build.",
    zh: "选择下方生成的信号以测试电平表。真实语音聊天设备仅在 Windows 版本中出现。",
  },
  audioMeterUnavailable: {
    en: "Audio meter unavailable",
    zh: "音频电平表不可用",
  },
  audioCaptureEndpoint: { en: "Capture endpoint", zh: "捕获端点" },
  audioGeneratedSource: { en: "Generated test source", zh: "生成的测试音源" },
  audioCaptureLevel: { en: "Capture level", zh: "捕获电平" },
  audioGeneratedLevel: { en: "Generated level", zh: "生成电平" },
  audioOff: { en: "Off", zh: "关闭" },
  audioDropped: { en: "dropped", zh: "丢失" },
  audioStopMeter: { en: "Stop meter", zh: "停止电平表" },
  audioStartMeter: { en: "Start meter", zh: "启动电平表" },
  audioGeneratedSafety: {
    en: "Generated in memory · no microphone · no playback",
    zh: "内存中生成 · 无麦克风 · 无播放",
  },
  audioCaptureSafety: {
    en: "Capture meter only · no playback · no recording",
    zh: "仅捕获电平表 · 无播放 · 无录制",
  },

  // Hotkeys
  settingsGlobalHotkeys: { en: "Global hotkeys", zh: "全局快捷键" },
  settingsSaveHotkeys: { en: "Save hotkeys", zh: "保存快捷键" },
  settingsSavedLocally: { en: "Saved locally", zh: "已保存在本地" },
  hotkeyNeedsModifier: {
    en: "Use modifiers and a key, separated by +.",
    zh: "请使用修饰键与按键，用 + 分隔。",
  },
  hotkeyDuplicate: {
    en: "Choose a shortcut not used above.",
    zh: "请选择上方未使用过的快捷键。",
  },
  hotkeyToggleOverlay: { en: "Toggle overlay", zh: "切换字幕层" },
  hotkeyToggleTranslation: { en: "Toggle translation", zh: "切换翻译" },
  hotkeyToggleEditMode: { en: "Edit mode", zh: "编辑模式" },
  hotkeyClearCaptions: { en: "Clear captions", zh: "清除字幕" },
  hotkeyIncreaseText: { en: "Increase text", zh: "增大文字" },
  hotkeyDecreaseText: { en: "Decrease text", zh: "减小文字" },
  hotkeyToggleHistory: {
    en: "Toggle caption/history view",
    zh: "切换字幕/历史视图",
  },
  settingsOverlayContent: { en: "Overlay content", zh: "悬浮窗内容" },
  settingsOverlayCaptions: { en: "Latest caption bar", zh: "最新字幕栏" },
  settingsOverlayHistory: {
    en: "Captions history",
    zh: "字幕历史",
  },
  settingsOverlayContentNote: {
    en: "The overlay shows exactly one of these: the live caption bar or the history panel. Switch anytime with the titlebar button or the hotkey.",
    zh: "悬浮窗每次只显示其中一种：实时字幕栏或历史面板。可随时通过标题栏按钮或快捷键切换。",
  },
  settingsHistoryRows: { en: "History rows", zh: "历史行数" },
  settingsHistoryRowsDefault: {
    en: "Default (auto)",
    zh: "默认（自动）",
  },
  settingsHistoryRows10: { en: "10 rows", zh: "10 行" },
  settingsHistoryRows5: { en: "5 rows", zh: "5 行" },
  settingsHistoryRowsNote: {
    en: "Cap the overlay chat to a fixed number of lines. Default sizes the panel to its window.",
    zh: "将悬浮窗聊天限制为固定行数。默认随窗口自适应。",
  },
  strictnessOff: { en: "Off — process any language", zh: "关闭——处理任何语言" },
  strictnessBalanced: {
    en: "Balanced — prefer selected languages",
    zh: "平衡——优先选择已选语言",
  },
  strictnessStrict: {
    en: "Strict — reject unexpected languages",
    zh: "严格——拒绝意外语言",
  },
  strictnessOffNote: {
    en: "Accept everything and translate it.",
    zh: "接受一切并翻译。",
  },
  strictnessBalancedNote: {
    en: "Filter clear mismatches and junk transcripts.",
    zh: "过滤明显不匹配与垃圾转写。",
  },
  strictnessStrictNote: {
    en: "Suppress anything that is not the profile's language.",
    zh: "抑制不属于该语言档案的内容。",
  },
  labelStyleBrackets: { en: "Brackets — [TEAM]", zh: "方括号 — [TEAM]" },
  labelStyleColon: { en: "Colon — TEAM:", zh: "冒号 — TEAM:" },
  labelStyleBullet: { en: "Bullet — • TEAM", zh: "项目符号 — • TEAM" },
  labelStyleStacked: { en: "Stacked — label above", zh: "堆叠——标签在上方" },
  labelStyleHidden: { en: "Hidden — no label", zh: "隐藏——无标签" },

  // Profile page
  profileIntro: {
    en: "Saved profiles remember which audio channel to capture, how it is monitored, and how it should be translated. Start one from the list below, or create a new one with the guided setup.",
    zh: "已保存的配置会记住要捕获哪个音频通道、如何监听以及如何翻译。可以从下方列表直接开始，也可以使用引导式设置创建新配置。",
  },

  // Setup wizard
  wizardTitle: { en: "Create a profile", zh: "创建配置" },
  wizardStepCount: { en: "Step {n}/8", zh: "第 {n}/8 步" },
  wizardStepChooseUseCase: {
    en: "What will you use yTRSL with?",
    zh: "你打算用 yTRSL 做什么？",
  },
  wizardStepDetectCable: { en: "Virtual cable check", zh: "虚拟音频线检测" },
  wizardStepShowRouting: {
    en: "How this setup routes audio",
    zh: "该配置的音频路由方式",
  },
  wizardStepSelectCapture: {
    en: "Choose the input to capture",
    zh: "选择要捕获的输入",
  },
  wizardStepSelectMonitor: {
    en: "Monitor the captured audio?",
    zh: "监听捕获的音频？",
  },
  wizardStepTestSignal: { en: "Voice signal test", zh: "语音信号测试" },
  wizardStepTestIsolation: { en: "Isolation check", zh: "隔离检测" },
  wizardStepReview: { en: "Review and save", zh: "检查并保存" },
  wizardStepSaved: { en: "Setup saved", zh: "配置已保存" },
  wizardNext: { en: "Next", zh: "下一步" },
  wizardBack: { en: "Back", zh: "上一步" },
  wizardCancel: { en: "Cancel", zh: "取消" },
  wizardRefreshDevices: { en: "Refresh devices", zh: "刷新设备" },
  wizardMeasure: { en: "Measure", zh: "测量" },
  wizardSaveSetup: { en: "Save setup", zh: "保存配置" },
  wizardHintDetecting: {
    en: "Detecting virtual cable devices…",
    zh: "正在检测虚拟音频线设备……",
  },
  wizardCableFound: {
    en: "Found a virtual cable ({ids}). The application you listen to outputs here; yTRSL captures it.",
    zh: "检测到虚拟音频线（{ids}）。你收听的应用程序输出到这里，yTRSL 会捕获它。",
  },
  wizardCableMissing: {
    en: "No virtual cable detected. Install VB-CABLE (Windows) or BlackHole (macOS), then refresh. You can still continue and pick a different input.",
    zh: "未检测到虚拟音频线。请安装 VB-CABLE（Windows）或 BlackHole（macOS）后刷新。你仍可以继续并选择其他输入。",
  },
  wizardRouteSourceName: {
    en: "Source name suggestion: {value}",
    zh: "来源名称建议：{value}",
  },
  wizardRouteOrigin: { en: "Audio origin: {value}", zh: "音频来源：{value}" },
  wizardRoutePreset: { en: "Domain preset: {value}", zh: "领域预设：{value}" },
  wizardRouteVad: { en: "VAD profile: {value}", zh: "语音检测档案：{value}" },
  wizardRouteMonitor: {
    en: "Monitor captured audio by default: {value}",
    zh: "默认监听捕获的音频：{value}",
  },
  wizardYes: { en: "yes", zh: "是" },
  wizardNo: { en: "no", zh: "否" },
  wizardChooseInput: { en: "Choose an input…", zh: "选择输入……" },
  wizardNoCapture: {
    en: "No capture endpoints found. Refresh the device list.",
    zh: "未找到捕获端点。请刷新设备列表。",
  },
  wizardPlayCapturedBack: {
    en: "Play the captured audio back so I can hear it",
    zh: "回放捕获的音频，以便我能听到",
  },
  wizardChooseOutput: { en: "Choose an output…", zh: "选择输出……" },
  wizardSignalIntro: {
    en: "Speak into the captured channel. yTRSL measures your voice level for 2 seconds.",
    zh: "请对着被捕获的通道说话。yTRSL 会测量你的音量 2 秒钟。",
  },
  wizardMeasuringSignal: {
    en: "Measuring… speak now",
    zh: "测量中……请说话",
  },
  wizardSignalHealthy: {
    en: "Voice detected — signal looks healthy.",
    zh: "检测到语音——信号正常。",
  },
  wizardSignalSilent: {
    en: "No signal. Check the app outputs to the cable input.",
    zh: "无信号。请检查应用程序是否输出到音频线输入端。",
  },
  wizardSignalVeryQuiet: {
    en: "Signal is very quiet — raise the source volume.",
    zh: "信号太弱——请调高音源音量。",
  },
  wizardSignalClipping: {
    en: "Signal is clipping — lower the source volume.",
    zh: "信号削波——请调低音源音量。",
  },
  wizardIsolationIntro: {
    en: "Two checks: stay quiet for 2 seconds, then speak for 2 seconds.",
    zh: "两项检测：先保持安静 2 秒，再说话 2 秒。",
  },
  wizardMeasureSilence: { en: "1) Measure silence", zh: "1) 测量静音" },
  wizardStayQuiet: { en: "Stay quiet…", zh: "请保持安静……" },
  wizardSilenceMeasured: {
    en: "Silence measured. Now speak normally.",
    zh: "静音已测量。现在请正常说话。",
  },
  wizardMeasureVoice: { en: "2) Measure voice", zh: "2) 测量语音" },
  wizardListeningSpeak: {
    en: "Listening… speak",
    zh: "正在监听……请说话",
  },
  wizardIsolationPassed: {
    en: "Isolation looks correct: silence stays silent, voice comes through.",
    zh: "隔离正常：安静时无声音，说话时能听到语音。",
  },
  wizardIsolationNoVoice: {
    en: "No voice detected during the speech check — verify the source.",
    zh: "语音检测阶段未检测到声音——请检查音源。",
  },
  wizardIsolationLeak: {
    en: "Non-voice audio leaks through — check what else outputs to this channel.",
    zh: "非语音音频漏入了通道——请检查还有什么输出到了这个通道。",
  },
  wizardReviewUseCase: { en: "Use case: {value}", zh: "使用场景：{value}" },
  wizardReviewInput: { en: "Capture input: {value}", zh: "捕获输入：{value}" },
  wizardReviewMonitor: { en: "Monitor: {value}", zh: "监听：{value}" },
  wizardReviewSignal: { en: "Signal: {value}", zh: "信号：{value}" },
  wizardReviewIsolation: { en: "Isolation: {value}", zh: "隔离：{value}" },
  wizardProfileName: { en: "Profile name", zh: "配置名称" },
  wizardSavedHint: {
    en: "Setup saved ({id}). The Live page is configured with this input, and the routing profile is stored for recovery.",
    zh: "配置已保存（{id}）。实时页面已使用此输入配置，路由配置也已保存以便恢复。",
  },

  // Use-case names
  useCaseValorant: { en: "VALORANT", zh: "无畏契约" },
  useCaseDiscord: { en: "Discord", zh: "Discord 语音" },
  useCaseMeeting: { en: "Meeting application", zh: "会议应用" },
  useCaseBrowserCall: { en: "Browser call", zh: "浏览器通话" },
  useCaseOther: { en: "Other application", zh: "其他应用" },

  // About page
  aboutIntro: {
    en: "yTRSL is a privacy-first accessibility companion: it listens to voice chat on your computer and shows near-live English captions for what your teammates say. Everything runs on your own machine — nothing you say is uploaded unless you choose a cloud provider.",
    zh: "yTRSL 是一个以隐私为先的辅助工具：它监听电脑上的语音聊天，并为队友说的话显示近乎实时的英文字幕。一切都在你自己的机器上运行——除非你选择云端服务商，否则你的声音不会被上传。",
  },
  aboutPagesTitle: {
    en: "The pages, simply explained",
    zh: "页面说明",
  },
  aboutPageLiveTitle: { en: "Live", zh: "实时" },
  aboutPageLiveText: {
    en: "The main screen. Pick an audio channel, a speech-to-text model, and a translation provider, then press Start. Captions appear on the overlay above your game.",
    zh: "主界面。选择音频通道、语音转文字模型和翻译服务商，然后点击“开始”。字幕会显示在游戏上方的悬浮层上。",
  },
  aboutPageProfileTitle: { en: "Profile", zh: "配置文件" },
  aboutPageProfileText: {
    en: "Saved setups. Run the guided setup once (or edit settings manually) and every profile is one click to start later. Use this page if you play on different machines or with different friends.",
    zh: "已保存的设置。只需运行一次引导式设置（或手动调整），之后每个配置都可以一键启动。如果你在多台设备上使用或与不同朋友组队，请使用此页面。",
  },
  aboutPageHistoryTitle: { en: "History", zh: "历史" },
  aboutPageHistoryText: {
    en: "A transcript of everything that has been translated this session, with export buttons for saving it.",
    zh: "本次会话所有已翻译内容的文字记录，并带有导出按钮。",
  },
  aboutPageModelsTitle: { en: "Models", zh: "模型" },
  aboutPageModelsText: {
    en: "Download and manage the local AI models used for speech recognition and translation, with license and checksum details.",
    zh: "下载并管理用于语音识别和翻译的本地 AI 模型，包含许可证和校验和详情。",
  },
  aboutPageSourcesTitle: { en: "Sources", zh: "音频源" },
  aboutPageSourcesText: {
    en: "Advanced multi-channel setup: give each voice channel (team chat, Discord, a meeting) its own color, tag, and language profile.",
    zh: "高级多通道设置：为每个语音通道（队伍语音、Discord、会议）设置独立的颜色、标签和语言档案。",
  },
  aboutPageSettingsTitle: { en: "Settings", zh: "设置" },
  aboutPageSettingsText: {
    en: "Appearance (dark/light), overlay behavior, hotkeys, and language.",
    zh: "外观（深色/浅色）、悬浮层行为、快捷键和语言。",
  },
  aboutPageDiagnosticsTitle: { en: "Diagnostics", zh: "诊断" },
  aboutPageDiagnosticsText: {
    en: "Latency and health graphs for the audio, speech, and translation pipeline when something feels slow.",
    zh: "当感觉卡顿时，查看音频、语音和翻译管道的延迟与健康度图表。",
  },
  aboutModelsTitle: {
    en: "Local models vs cloud models",
    zh: "本地模型与云端模型对比",
  },
  aboutModelsLocal: { en: "Local (on your PC)", zh: "本地（在你电脑上）" },
  aboutModelsCloud: { en: "Cloud (API)", zh: "云端（API）" },
  aboutRowPrivacy: { en: "Privacy", zh: "隐私" },
  aboutPrivacyLocal: {
    en: "Audio never leaves your machine",
    zh: "音频不会离开你的设备",
  },
  aboutPrivacyCloud: {
    en: "Speech is sent to the provider",
    zh: "语音会发送给服务商",
  },
  aboutRowCost: { en: "Cost", zh: "费用" },
  aboutCostLocal: {
    en: "Free, after the one-time model download",
    zh: "免费（一次性下载模型后）",
  },
  aboutCostCloud: {
    en: "Usually free tiers, then pay-per-use",
    zh: "通常有免费额度，之后按量付费",
  },
  aboutRowSpeed: { en: "Speed", zh: "速度" },
  aboutSpeedLocal: {
    en: "Great on a good GPU; slower on CPU",
    zh: "好显卡上很快；CPU 上较慢",
  },
  aboutSpeedCloud: {
    en: "Fast, needs a stable internet connection",
    zh: "很快，但需要稳定的网络连接",
  },
  aboutRowOffline: { en: "Offline", zh: "离线" },
  aboutOfflineLocal: { en: "Works with no internet", zh: "无网络也能用" },
  aboutOfflineCloud: { en: "Does not work offline", zh: "离线不可用" },
  aboutRowQuality: { en: "Quality", zh: "质量" },
  aboutQualityLocal: {
    en: "Very good (Whisper family)",
    zh: "非常好（Whisper 系列）",
  },
  aboutQualityCloud: {
    en: "State-of-the-art (NVIDIA Parakeet, Groq Whisper)",
    zh: "业界领先（NVIDIA Parakeet、Groq Whisper）",
  },
  aboutRowSetup: { en: "Setup", zh: "设置" },
  aboutSetupLocal: {
    en: "Download models once, then just click Start",
    zh: "下载一次模型，之后点击“开始”即可",
  },
  aboutSetupCloud: {
    en: "Create an API key and paste it in Live",
    zh: "创建 API 密钥并粘贴到“实时”页面",
  },
  aboutBestBoth: {
    en: "Best of both: use local Whisper + NLLB for privacy, and switch to cloud (NVIDIA Parakeet + Riva, or Groq) when you want maximum accuracy or when your machine cannot keep up.",
    zh: "两全其美：平时用本地 Whisper + NLLB 保证隐私；需要最高准确率或本地机器跟不上时，切换到云端（NVIDIA Parakeet + Riva 或 Groq）。",
  },
  aboutSpecsTitle: {
    en: "Recommended specs for local models",
    zh: "本地模型推荐配置",
  },
  aboutSpecsMinTitle: { en: "Minimum", zh: "最低配置" },
  aboutSpecsMinText: {
    en: "Everything works, slower. 4-core CPU, 16 GB RAM. Whisper runs on CPU with a bit of delay; NLLB translation still feels responsive.",
    zh: "一切功能可用，速度较慢。4 核 CPU、16 GB 内存。Whisper 在 CPU 上有少许延迟；NLLB 翻译仍然流畅。",
  },
  aboutSpecsRecommendedTitle: { en: "Recommended", zh: "推荐配置" },
  aboutSpecsRecommendedText: {
    en: "Best latency. NVIDIA GPU with 8 GB VRAM or more (GTX 2060 / RTX 3060 class and up). Speech is recognized within about a second of a sentence ending.",
    zh: "最佳延迟。NVIDIA 显卡 8 GB 以上显存（GTX 2060 / RTX 3060 级别及以上）。一句话说完后约一秒钟内即可完成识别。",
  },
  aboutSpecsAppleTitle: {
    en: "macOS / Apple Silicon",
    zh: "macOS / Apple 芯片",
  },
  aboutSpecsAppleText: {
    en: "M1 with 16 GB RAM works well; M-series GPU is used automatically by the MLX Whisper model.",
    zh: "M1 + 16 GB 内存即可流畅运行；MLX Whisper 模型会自动使用 M 系列 GPU。",
  },
  aboutSpecsDiskTitle: { en: "Disk space", zh: "磁盘空间" },
  aboutSpecsDiskText: {
    en: "About 3 GB for the standard Whisper + NLLB pair (larger Whisper model: ~6 GB total). Downloads happen once in the Models page.",
    zh: "标准 Whisper + NLLB 组合约需 3 GB（更大 Whisper 模型共约 6 GB）。只需在“模型”页面下载一次。",
  },
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
