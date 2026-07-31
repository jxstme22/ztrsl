import {
  Activity,
  AudioLines,
  Captions,
  CircleAlert,
  Gauge,
  LoaderCircle,
  Play,
  ShieldCheck,
  Square,
} from "lucide-react";
import { useState } from "react";

import type { useAudioMeter } from "../audio/useAudioMeter";
import type { Caption } from "../overlay/model";
import { useLiveTranslation } from "../live/useLiveTranslation";

type AudioController = ReturnType<typeof useAudioMeter>;

type LiveTranslationPanelProps = {
  audio: AudioController;
  onCaption: (caption: Caption) => void;
};

export function LiveTranslationPanel({
  audio,
  onCaption,
}: LiveTranslationPanelProps) {
  const live = useLiveTranslation(onCaption);
  const [playbackEndpointId, setPlaybackEndpointId] = useState<string | null>(
    () => window.localStorage.getItem("lst.live.playback-endpoint"),
  );
  const isSimulator = audio.catalog?.platform === "development";
  const busy = live.state === "starting" || live.state === "stopping";
  const listening = live.state === "listening";
  const endpointReady =
    audio.selectedEndpoint !== null &&
    audio.selectedEndpoint.state === "active";
  const playbackEndpoint =
    audio.renderEndpoints.find(
      (endpoint) => endpoint.id === playbackEndpointId,
    ) ?? null;
  const playbackReady =
    playbackEndpoint !== null && playbackEndpoint.state === "active";

  return (
    <section className="live-console" id="live" aria-labelledby="live-title">
      <div className="live-console__header">
        <div>
          <p className="section-kicker">Primary operation</p>
          <h2 id="live-title">Live Tagalog translation</h2>
          <p>
            Incoming Filipino and Taglish become local English subtitles.
            Audio is processed in memory and discarded.
          </p>
        </div>
        <div
          className={`live-state ${listening ? "listening" : live.state}`}
          role="status"
          aria-live="polite"
        >
          <span aria-hidden="true" />
          {live.state === "starting"
            ? "Loading models"
            : live.state === "stopping"
              ? "Stopping"
              : listening
                ? "Listening"
                : live.state === "error"
                  ? "Needs attention"
                  : "Ready"}
        </div>
      </div>

      {isSimulator && (
        <div className="inline-alert info live-notice" role="status">
          <AudioLines aria-hidden="true" size={18} />
          <div>
            <strong>macOS product simulation</strong>
            <p>
              This runs a timed generated signal through the live sidecar. Real
              incoming communications capture activates in the Windows build.
            </p>
          </div>
        </div>
      )}

      {live.error !== null && (
        <div className="inline-alert error live-notice" role="alert">
          <CircleAlert aria-hidden="true" size={18} />
          <div>
            <strong>Live translation could not continue</strong>
            <p>{live.error}</p>
          </div>
        </div>
      )}

      <div className="live-signal-chain">
        <label className="live-module" htmlFor="live-input">
          <span className="module-number">01 / INPUT</span>
          <strong>Voice-chat channel</strong>
          <select
            id="live-input"
            value={audio.selectedEndpointId ?? ""}
            disabled={listening || busy}
            onChange={(event) => {
              audio.selectEndpoint(event.currentTarget.value || null);
            }}
          >
            <option value="">Choose incoming communications…</option>
            {audio.captureEndpoints.map((endpoint) => (
              <option
                key={endpoint.id}
                value={endpoint.id}
                disabled={endpoint.state !== "active"}
              >
                {endpoint.friendlyName}
                {endpoint.state !== "active" ? ` · ${endpoint.state}` : ""}
              </option>
            ))}
          </select>
          <small>
            {endpointReady
              ? "Endpoint available"
              : "Select the endpoint carrying your friends’ voices"}
          </small>
          <span className="module-divider" aria-hidden="true" />
          <strong>Headphones / speakers</strong>
          <select
            aria-label="Monitoring output"
            value={playbackEndpointId ?? ""}
            disabled={listening || busy}
            onChange={(event) => {
              const next = event.currentTarget.value || null;
              setPlaybackEndpointId(next);
              if (next === null) {
                window.localStorage.removeItem("lst.live.playback-endpoint");
              } else {
                window.localStorage.setItem(
                  "lst.live.playback-endpoint",
                  next,
                );
              }
            }}
          >
            <option value="">Choose where you hear friends…</option>
            {audio.renderEndpoints.map((endpoint) => (
              <option
                key={endpoint.id}
                value={endpoint.id}
                disabled={endpoint.state !== "active"}
              >
                {endpoint.friendlyName}
                {endpoint.state !== "active" ? ` · ${endpoint.state}` : ""}
              </option>
            ))}
          </select>
          <small>
            {playbackReady
              ? "Voice chat will be monitored here"
              : "Required so routing voice chat does not mute your friends"}
          </small>
        </label>

        <div className="signal-rail" aria-hidden="true">
          <span />
        </div>

        <div className="live-module fixed">
          <span className="module-number">02 / RECOGNITION</span>
          <strong>Whisper large-v3</strong>
          <p>CUDA FP16 · Filipino forced · quality profile</p>
          <small>
            {live.snapshot.asrModel ?? "Loads when listening starts"}
          </small>
        </div>

        <div className="signal-rail" aria-hidden="true">
          <span />
        </div>

        <div className="live-module fixed">
          <span className="module-number">03 / OUTPUT</span>
          <strong>English overlay</strong>
          <p>MADLAD local translation · source line retained</p>
          <small>Maximum two captions on screen</small>
        </div>
      </div>

      <div className="live-readout" aria-live="polite">
        <div className="live-transcript">
          <Captions aria-hidden="true" size={20} />
          <div>
            <span>Latest translation</span>
            {live.lastCaption === null ? (
              <p>
                {listening
                  ? "Listening for a complete phrase…"
                  : "Start listening when your communications channel is ready."}
              </p>
            ) : (
              <>
                <small>{live.lastCaption.source_text}</small>
                <strong>{live.lastCaption.english_text}</strong>
              </>
            )}
          </div>
        </div>
        <dl className="live-metrics">
          <div>
            <dt>Packets</dt>
            <dd>{live.snapshot.metrics.audioPacketsSent}</dd>
          </div>
          <div>
            <dt>Input drops</dt>
            <dd>{live.snapshot.metrics.captureDrops}</dd>
          </div>
          <div>
            <dt>Monitor drops</dt>
            <dd>{live.snapshot.metrics.monitorDrops}</dd>
          </div>
          <div>
            <dt>Monitor gaps</dt>
            <dd>{live.snapshot.metrics.monitorUnderrunSamples}</dd>
          </div>
          <div>
            <dt>Captions</dt>
            <dd>{live.snapshot.metrics.captionsReceived}</dd>
          </div>
          <div>
            <dt>ASR latency</dt>
            <dd>
              {live.lastCaption === null
                ? "—"
                : `${String(Math.round(live.lastCaption.asr_ms))} ms`}
            </dd>
          </div>
        </dl>
      </div>

      <div className="live-actions">
        {listening ? (
          <button
            className="button live-stop"
            type="button"
            disabled={busy}
            aria-busy={busy}
            onClick={() => void live.stop()}
          >
            {busy ? (
              <LoaderCircle className="spin" aria-hidden="true" size={18} />
            ) : (
              <Square aria-hidden="true" size={16} />
            )}
            Stop listening
          </button>
        ) : (
          <button
            className="button live-start"
            type="button"
            disabled={!endpointReady || !playbackReady || busy}
            aria-busy={busy}
            onClick={() => {
              if (
                audio.selectedEndpointId !== null &&
                playbackEndpointId !== null
              ) {
                void live.start(
                  audio.selectedEndpointId,
                  playbackEndpointId,
                  isSimulator ? "demo" : "local",
                );
              }
            }}
          >
            {busy ? (
              <LoaderCircle className="spin" aria-hidden="true" size={18} />
            ) : (
              <Play aria-hidden="true" size={17} />
            )}
            {busy ? "Loading local models…" : "Start listening"}
          </button>
        )}
        <div className="live-assurances">
          <span>
            <ShieldCheck aria-hidden="true" size={14} />
            Local only
          </span>
          <span>
            <Gauge aria-hidden="true" size={14} />
            One GPU job at a time
          </span>
          <span>
            <Activity aria-hidden="true" size={14} />
            Bounded audio queue
          </span>
        </div>
      </div>
    </section>
  );
}
