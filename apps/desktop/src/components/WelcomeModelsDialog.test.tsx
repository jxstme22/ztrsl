import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WelcomeModelsDialog } from "./WelcomeModelsDialog";
import { useUiLanguage } from "../features/i18n/useUiLanguage";
import type { ModelUiState } from "../models/useModels";

function modelsState(): ModelUiState {
  return {
    list: {
      models: [
        {
          id: "whisper-large-v3-turbo",
          name: "Whisper Turbo",
          kind: "asr",
          runtime: "faster-whisper",
          recommended: true,
          description: "d",
          licenseSpdx: "MIT",
          licenseNotice: "",
          downloadSizeBytes: 100,
          source: "s",
          revision: "r",
          fileCount: 1,
          capabilities: {
            languageCapability: "post-filter",
            recommendedProfiles: [],
            vramClass: "medium",
          },
          status: "available",
          installedSizeBytes: 0,
        },
      ],
      inUse: [],
      known: [],
    },
    loading: false,
    progress: {},
    error: null,
    refresh: vi.fn(),
    startInstall: vi.fn(),
    cancel: vi.fn(),
    remove: vi.fn(),
    hasInstalledModels: false,
    isInstalling: () => false,
    installed: [],
    available: [],
    knownInstalled: [],
    knownAvailable: [],
    downloadEndpoint: {
      endpoint: "https://huggingface.co",
      mirror: false,
      userOverride: false,
    },
    setDownloadEndpoint: vi.fn(),
    providerStatus: { region: "global", providers: [] },
    importOfflinePack: vi.fn(),
  };
}

function Harness({ language }: { language: "en" | "zh" }) {
  const controller = useUiLanguage();
  return (
    <WelcomeModelsDialog
      models={{ ...modelsState(), available: modelsState().list.models }}
      onInstall={vi.fn()}
      error={null}
      onRetry={vi.fn()}
      onDismiss={vi.fn()}
      language={{
        language,
        setLanguage: controller.setLanguage,
        t: (key: Parameters<typeof controller.t>[0]) =>
          key === "welcomeTitle"
            ? language === "zh"
              ? "欢迎使用 yTRSLT"
              : "Welcome to yTRSLT"
            : controller.t(key),
      }}
    />
  );
}

describe("WelcomeModelsDialog", () => {
  it("renders the English welcome by default", () => {
    render(<Harness language="en" />);
    expect(screen.getByText("Welcome to yTRSLT")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Interface language" }),
    ).toBeInTheDocument();
  });

  it("renders the Chinese welcome when Chinese is selected", () => {
    render(<Harness language="zh" />);
    expect(screen.getByText("欢迎使用 yTRSLT")).toBeInTheDocument();
  });
});
