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
  navHistory: { en: "History", zh: "历史" },
  navSources: { en: "Sources", zh: "音频源" },
  navSettings: { en: "Settings", zh: "设置" },
  navDiagnostics: { en: "Diagnostics", zh: "诊断" },

  // Captions history
  historyTitle: { en: "Captions history", zh: "字幕历史" },
  historyClear: { en: "Clear", zh: "清空" },
  historyEmpty: {
    en: "No finished captions yet. Start a live session — only finalized captions are saved here.",
    zh: "暂无已完成字幕。启动实时会话后，只有最终确定的字幕会被保存到这里。",
  },
  historyUnknownSpeaker: { en: "Unknown speaker", zh: "未知说话人" },
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
  welcomeTitle: { en: "Welcome to yTSRL", zh: "欢迎使用 yTSRL" },
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
    en: "Cap the overlay chat to a fixed number of lines; Default keeps the whole session (scrollable).",
    zh: "将悬浮窗聊天限制为固定行数；默认保留整个会话（可滚动）。",
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
