"use client";

import { useMemo } from "react";
import { useNarrativeEngine } from "@/components/openalpha/hooks/useNarrativeEngine";
import { MIN_TRANSCRIPT_THRESHOLD } from "@/lib/starstory";

function buildStarId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `star-${Date.now()}`;
}

function buttonStyle(): React.CSSProperties {
  return {
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.08)",
    color: "#f8f4eb",
    padding: "8px 10px",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 12,
  };
}

function disabledButtonStyle(): React.CSSProperties {
  return {
    ...buttonStyle(),
    opacity: 0.45,
    cursor: "not-allowed",
  };
}

function helperTextStyle(): React.CSSProperties {
  return {
    marginTop: 6,
    marginBottom: 12,
    fontSize: 12,
    lineHeight: 1.45,
    opacity: 0.78,
  };
}

function flowRowStyle(): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 10,
  };
}

function arrowStyle(): React.CSSProperties {
  return {
    opacity: 0.6,
    fontSize: 14,
    lineHeight: 1,
  };
}

function branchLabelStyle(): React.CSSProperties {
  return {
    minWidth: 72,
    fontSize: 11,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    opacity: 0.65,
  };
}

export function NarrativeDebugPanel() {
  const engine = useNarrativeEngine();
  const canSpawn = engine.state.phase === "SKY_IDLE";
  const canClick = engine.state.phase === "PROTO_STAR_FORMING";
  const canBeginChronicle = engine.state.phase === "PROTO_STAR_ACTIVE";
  const canInstall = engine.state.phase === "CHRONICLE_STARTED";
  const canAwaken = engine.state.phase === "AWAKENING_READY";
  const canAddTranscript =
    engine.state.phase === "AWAKENED" || engine.state.phase === "CHRONICLE_RECORDING";
  const canStartValidation =
    engine.state.phase === "AWAKENED" || engine.state.phase === "CHRONICLE_RECORDING";
  const canApproveValidation =
    engine.state.phase === "VALIDATION" && engine.state.transcriptLineCount >= MIN_TRANSCRIPT_THRESHOLD;
  const canRejectValidation = engine.state.phase === "VALIDATION";

  const validationHelp = useMemo(() => {
    if (engine.state.phase !== "VALIDATION") {
      return "Validate Chronicle only works during VALIDATION. Use Start Validation after the awakening/recording steps.";
    }
    if (engine.state.transcriptLineCount < MIN_TRANSCRIPT_THRESHOLD) {
      return `Validate Chronicle is blocked: ${engine.state.transcriptLineCount}/${MIN_TRANSCRIPT_THRESHOLD} transcript lines. In VALIDATION below threshold, Reject Chronicle is the only legal outcome.`;
    }
    return `Validate Chronicle will dispatch CHRONICLE_VALIDATED and move the narrative to STAR_BORN because the transcript threshold is met (${engine.state.transcriptLineCount}/${MIN_TRANSCRIPT_THRESHOLD}).`;
  }, [engine.state.phase, engine.state.transcriptLineCount]);

  const clickHelp = useMemo(() => {
    if (engine.state.phase === "PROTO_STAR_ACTIVE") {
      return `Proto-star activation reached at ${engine.state.clickCount} clicks. Additional clicks are no longer accepted.`;
    }
    if (engine.state.phase !== "PROTO_STAR_FORMING") {
      return "Click Star is only active while the proto-star is forming.";
    }
    return `Click Star advances the proto-star toward activation. Current progress: ${engine.state.clickCount}/5.`;
  }, [engine.state.clickCount, engine.state.phase]);

  const snapshotText = useMemo(() => JSON.stringify(engine.state, null, 2), [engine.state]);

  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  return (
    <aside
      style={{
        position: "absolute",
        right: 16,
        top: 16,
        zIndex: 30,
        width: 360,
        maxWidth: "calc(100vw - 32px)",
        borderRadius: 16,
        padding: 16,
        color: "#f8f4eb",
        background: "rgba(6, 11, 24, 0.82)",
        border: "1px solid rgba(255,255,255,0.14)",
        boxShadow: "0 24px 60px rgba(0, 0, 0, 0.35)",
        backdropFilter: "blur(18px)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <strong style={{ fontSize: 14, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Narrative Debug
        </strong>
        <span style={{ opacity: 0.72, fontSize: 12 }}>{engine.hasEngine ? "hydrated" : "booting"}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginBottom: 12 }}>
        <div>Phase: {engine.state.phase}</div>
        <div>Clicks: {engine.state.clickCount}</div>
        <div>Lines: {engine.state.transcriptLineCount}</div>
        <div>Validation: {engine.state.validationStatus}</div>
        <div>Begin: {engine.protoStar.canBeginChronicle ? "yes" : "no"}</div>
        <div>Validate: {canApproveValidation ? "ready" : "blocked"}</div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ ...branchLabelStyle(), marginBottom: 8 }}>Directed Flow</div>

        <div style={flowRowStyle()}>
          <button
            disabled={!canSpawn}
            style={canSpawn ? buttonStyle() : disabledButtonStyle()}
            onClick={() => engine.dispatch({ type: "PROTO_STAR_SPAWNED", at: Date.now(), starId: buildStarId() })}
          >
            Spawn Star
          </button>
          <span style={arrowStyle()}>-&gt;</span>
          <button
            disabled={!canClick}
            style={canClick ? buttonStyle() : disabledButtonStyle()}
            onClick={() => engine.dispatch({ type: "PROTO_STAR_CLICKED", at: Date.now() })}
          >
            Click Star
          </button>
          <span style={{ ...branchLabelStyle(), minWidth: 0 }}>{engine.state.clickCount}/5</span>
          <span style={arrowStyle()}>-&gt;</span>
          <button
            disabled={!canBeginChronicle}
            style={canBeginChronicle ? buttonStyle() : disabledButtonStyle()}
            onClick={() =>
              engine.dispatch({ type: "CHRONICLE_STARTED", at: Date.now(), campaignName: "Open Alpha Chronicle" })
            }
          >
            Begin Chronicle
          </button>
        </div>

        <div style={flowRowStyle()}>
          <button
            disabled={!canInstall}
            style={canInstall ? buttonStyle() : disabledButtonStyle()}
            onClick={() =>
              engine.dispatch({ type: "DISCORD_INSTALL_COMPLETED", at: Date.now(), guildId: "debug-guild" })
            }
          >
            Simulate Install
          </button>
          <span style={arrowStyle()}>-&gt;</span>
          <button
            disabled={!canAwaken}
            style={canAwaken ? buttonStyle() : disabledButtonStyle()}
            onClick={() => engine.dispatch({ type: "AWAKENING_COMPLETED", at: Date.now() })}
          >
            Simulate Awaken
          </button>
          <span style={arrowStyle()}>-&gt;</span>
          <button
            disabled={!canAddTranscript}
            style={canAddTranscript ? buttonStyle() : disabledButtonStyle()}
            onClick={() =>
              engine.dispatch({
                type: "TRANSCRIPT_UPDATED",
                at: Date.now(),
                transcriptLineCount: engine.state.transcriptLineCount + 25,
              })
            }
          >
            Add 25 Lines
          </button>
          <span style={{ ...branchLabelStyle(), minWidth: 0 }}>
            {Math.min(engine.state.transcriptLineCount, MIN_TRANSCRIPT_THRESHOLD)}/{MIN_TRANSCRIPT_THRESHOLD}
          </span>
          <span style={arrowStyle()}>-&gt;</span>
          <button
            disabled={!canStartValidation}
            style={canStartValidation ? buttonStyle() : disabledButtonStyle()}
            title="Moves the narrative from AWAKENED or CHRONICLE_RECORDING into VALIDATION."
            onClick={() => engine.dispatch({ type: "VALIDATION_STARTED", at: Date.now() })}
          >
            Start Validation
          </button>
        </div>

        <div style={flowRowStyle()}>
          <span style={branchLabelStyle()}>Pass Branch</span>
          <button
            disabled={!canApproveValidation}
            style={canApproveValidation ? buttonStyle() : disabledButtonStyle()}
            title="Approves the chronicle only from VALIDATION and only when transcript lines meet the minimum threshold."
            onClick={() => engine.dispatch({ type: "CHRONICLE_VALIDATED", at: Date.now() })}
          >
            Validate Chronicle
          </button>
          <span style={arrowStyle()}>-&gt;</span>
          <span style={{ ...branchLabelStyle(), minWidth: 0 }}>STAR_BORN</span>
        </div>

        <div style={flowRowStyle()}>
          <span style={branchLabelStyle()}>Fail Branch</span>
          <button
            disabled={!canRejectValidation}
            style={canRejectValidation ? buttonStyle() : disabledButtonStyle()}
            title="Rejects the chronicle only from VALIDATION and moves the narrative to STAR_COLLAPSED."
            onClick={() =>
              engine.dispatch({ type: "CHRONICLE_REJECTED", at: Date.now(), reason: "debug-rejection" })
            }
          >
            Reject Chronicle
          </button>
          <span style={arrowStyle()}>-&gt;</span>
          <span style={{ ...branchLabelStyle(), minWidth: 0 }}>STAR_COLLAPSED</span>
        </div>

        <div style={flowRowStyle()}>
          <span style={branchLabelStyle()}>Utility</span>
          <button style={buttonStyle()} onClick={() => engine.resetAll(Date.now())}>
            Reset All
          </button>
        </div>
      </div>

      <div style={helperTextStyle()}>{clickHelp}</div>
      <div style={helperTextStyle()}>{validationHelp}</div>

      <pre
        style={{
          margin: 0,
          overflowX: "auto",
          borderRadius: 12,
          padding: 12,
          background: "rgba(255,255,255,0.06)",
          fontSize: 11,
          lineHeight: 1.45,
        }}
      >
        {snapshotText}
      </pre>
    </aside>
  );
}