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
  welcomeTitle: { en: "Welcome to yTRSLT", zh: "欢迎使用 yTRSLT" },
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
  wizardTitle: { en: "Audio setup wizard", zh: "音频设置向导" },
  wizardStep: { en: "Step", zh: "步骤" },
  wizardOf: { en: "of", zh: "/" },
  wizardNext: { en: "Next", zh: "下一步" },
  wizardBack: { en: "Back", zh: "返回" },
  wizardSavePreset: { en: "Save preset", zh: "保存预设" },
  wizardSetupSaved: { en: "Setup saved", zh: "设置已保存" },
  wizardDone: { en: "Done", zh: "完成" },
  wizardSetupSavedNote: {
    en: "Your source presets are saved. Open Sources to edit them at any time.",
    zh: "你的音源预设已保存。可随时打开“音频源”页进行编辑。",
  },
  wizardChooseSetup: { en: "Choose a setup type", zh: "选择设置类型" },
  wizardRecommended: { en: "Recommended", zh: "推荐" },
  wizardRecommendedDetail: {
    en: "One separately installed VB-CABLE for VALORANT voice + a second source for Discord.",
    zh: "为 VALORANT 语音单独安装一个 VB-CABLE，并为 Discord 添加第二个音源。",
  },
  wizardAdvanced: { en: "Advanced", zh: "高级" },
  wizardAdvancedDetail: {
    en: "Multiple virtual audio endpoints or process captures for separate applications.",
    zh: "为不同的应用程序使用多个虚拟音频端点或进程捕获。",
  },
  wizardVoiceSetup: { en: "Voice setup", zh: "语音设置" },
  wizardCustomRouting: { en: "Custom routing", zh: "自定义路由" },
  wizardAddFirstSource: { en: "Add the first source", zh: "添加第一个音源" },
  wizardAddFirstSourceNote: {
    en: "Start from a preset, then edit the name, tag, and label style. The internal identity is assigned once and never changes.",
    zh: "从预设开始，然后编辑名称、标签和标签样式。内部标识只分配一次，永不改变。",
  },
  wizardPreset: { en: "Preset", zh: "预设" },
  wizardAddSource: { en: "Add source", zh: "添加音源" },
  wizardSourceName: { en: "Source name", zh: "音源名称" },
  wizardCaptionTag: { en: "Caption tag", zh: "字幕标签" },
  wizardCaptionStyle: { en: "Caption style", zh: "字幕样式" },
  wizardCaptureMethod: { en: "Capture method", zh: "捕获方式" },
  wizardChooseCapture: {
    en: "Choose a capture method for each source",
    zh: "为每个音源选择捕获方式",
  },
  wizardChooseCaptureNote: {
    en: "Nothing is selected automatically. Pick the exact endpoint or process each voice channel comes from.",
    zh: "不会自动选择。请为每个语音频道指定其来源端点或进程。",
  },
  wizardProcessUnavailable: {
    en: "Process capture (loopback of a named app) is not available yet on this build; choose endpoints for now.",
    zh: "此版本尚不支持进程捕获（指定应用的环回）；请先选择端点。",
  },
  wizardSet: { en: "Set", zh: "已设置" },
  wizardUnset: { en: "Unset", zh: "未设置" },
  wizardChooseEndpoint: { en: "Choose an endpoint…", zh: "选择端点…" },
  wizardEndpointState: { en: "Endpoint state", zh: "端点状态" },
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
  wizardAddSocial: {
    en: "Add a Discord or social source",
    zh: "添加 Discord 或社交音源",
  },
  wizardAddSocialNote: {
    en: "Recommended: capture Discord as its own source so friends' voices get their own caption lane.",
    zh: "建议：将 Discord 捕获为独立音源，让朋友的语音拥有独立字幕道。",
  },
  wizardMonitoringOutput: {
    en: "Choose the monitoring output",
    zh: "选择监听输出",
  },
  wizardMonitoringOutputNote: {
    en: "Monitoring blends captured voice into your headphones only. It never feeds translation. Beware of feedback loops, disconnected endpoints, and microphones selected as playback.",
    zh: "监听仅将捕获的语音混合到你的耳机中，绝不会进入翻译。请注意反馈回路、断开的端点以及被选为播放设备的麦克风。",
  },
  wizardHeadphoneOutput: { en: "Headphone output", zh: "耳机输出" },
  wizardMonitorSource: { en: "Monitor", zh: "监听" },
  wizardMonitorSourceNote: {
    en: "Hear this source in your headphones while playing.",
    zh: "游戏时在耳机中收听此音源。",
  },
  wizardFeedbackLoop: {
    en: "Captures and monitors the same endpoint — audio would loop.",
    zh: "捕获与监听了同一端点——音频会形成回路。",
  },
  wizardLiveMeter: { en: "live meter", zh: "实时电平表" },
  wizardEndpointUnderTest: { en: "Endpoint under test", zh: "待测端点" },
  wizardInputLevel: { en: "Input level", zh: "输入电平" },
  wizardIsolationTest: { en: "Source isolation test", zh: "音源隔离测试" },
  wizardIsolationNote: {
    en: "Each source must only ever hear its own voice channel. Play voice into the cable and confirm only its meter moves.",
    zh: "每个音源只能听到自己的语音频道。向线缆播放语音，并确认只有对应电平表有反应。",
  },
  wizardIsolation1: {
    en: "Play voice into the selected cable (or another app's voice).",
    zh: "向选定的线缆播放语音（或其他应用的语音）。",
  },
  wizardIsolation2: {
    en: "Trigger VALORANT game or announcer audio.",
    zh: "触发 VALORANT 游戏或播报音频。",
  },
  wizardIsolation3: {
    en: "The TEAM meter must move only for voice into the cable.",
    zh: "TEAM 电平表应仅对输入线缆的语音有反应。",
  },
  wizardIsolation4: {
    en: "The other source's meter must stay silent.",
    zh: "其他音源的电平表应保持静止。",
  },
  wizardTeamInstruction: {
    en: "TEAM: should move only when voice plays into its cable.",
    zh: "TEAM：仅当语音输入其线缆时应有反应。",
  },
  wizardSocialInstruction: {
    en: "SOCIAL: must stay silent when VALORANT game audio plays.",
    zh: "SOCIAL：播放 VALORANT 游戏音频时必须保持静止。",
  },
  wizardMonitoringTest: { en: "Monitoring test", zh: "监听测试" },
  wizardMonitoringTestNote: {
    en: "All enabled voice sources should be audible in your headphones without feedback. Adjust each blend; verify by ear. The blend never enters translation.",
    zh: "所有已启用的语音音源都应在耳机中无反馈地清晰可闻。逐项调整混合音量并以耳朵确认。混合永远不会进入翻译。",
  },
  wizardBlend: { en: "blend", zh: "混合" },
  wizardBlendOff: { en: "off", zh: "关闭" },
  wizardBlendConfirm: {
    en: "Optional: confirm the blend output still carries voice.",
    zh: "可选：确认混合输出仍带有语音。",
  },
  wizardLanguageStep: {
    en: "Language profile and strictness per source",
    zh: "各音源的语言档案与严格度",
  },
  wizardLanguageNote: {
    en: "Balanced is recommended for mixed gaming speech. Strict rejects unexpected languages more aggressively.",
    zh: "建议对混合游戏语音使用“平衡”。“严格”会更积极地拒绝意外语言。",
  },
  wizardProfile: { en: "profile", zh: "档案" },
  wizardOverlayPreview: { en: "Overlay preview", zh: "字幕层预览" },
  wizardOverlayPreviewNote: {
    en: "Both captions appear at once, each in its own lane. Edit tags and label styles directly.",
    zh: "两条字幕同时显示，各自独立一行。可直接编辑标签与标签样式。",
  },
  wizardSaveNote: {
    en: "Saving writes {count} source preset{plural} to this device. Suggested name:",
    zh: "保存将向本设备写入 {count} 个音源预设{plural}。建议名称：",
  },
  wizardNoEndpoint: { en: "no endpoint yet", zh: "尚未选择端点" },
  wizardMonitoringAt: { en: "monitored at", zh: "监听于" },
  wizardMonitoringOff: { en: "monitoring off", zh: "监听关闭" },
  wizardStepLabel_chooseSetup: { en: "Setup type", zh: "设置类型" },
  wizardStepLabel_addFirstSource: {
    en: "Add the first source",
    zh: "添加第一个音源",
  },
  wizardStepLabel_selectCapture: { en: "Capture method", zh: "捕获方式" },
  wizardStepLabel_valorantRouting: {
    en: "Valorant routing",
    zh: "VALORANT 路由",
  },
  wizardStepLabel_addSocial: { en: "Social source", zh: "社交音源" },
  wizardStepLabel_monitoringOutput: { en: "Monitoring output", zh: "监听输出" },
  wizardStepLabel_isolationTest: {
    en: "Source isolation test",
    zh: "音源隔离测试",
  },
  wizardStepLabel_monitoringTest: { en: "Monitoring test", zh: "监听测试" },
  wizardStepLabel_languageStrictness: {
    en: "Language & strictness",
    zh: "语言与严格度",
  },
  wizardStepLabel_overlayPreview: { en: "Overlay preview", zh: "字幕层预览" },
  wizardStepLabel_savePreset: { en: "Save preset", zh: "保存预设" },

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
