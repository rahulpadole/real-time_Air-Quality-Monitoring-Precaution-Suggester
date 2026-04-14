import React, { useEffect, useState, useCallback, useRef } from "react";
import { ref, onValue } from "firebase/database";
import { database } from "./firebase";
import { getAIPrecautions } from "./geminiService";
import "./App.css";

const AI_COOLDOWN_SECS = 60; // minimum seconds between AI calls

// ── Pure helpers ──────────────────────────────────────────────
const calculateAQI = (gas, dust) => {
  const avg = (gas + dust) / 2;
  if (avg < 1000) return 50;
  if (avg < 2000) return 100;
  if (avg < 3000) return 200;
  return 300;
};

const getLevelFromAQI = (aqi) => {
  if (aqi <= 50)  return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 200) return "Poor";
  return "Severe";
};

const LEVEL_META = {
  Good:     { color: "#10b981", glow: "rgba(16,185,129,0.35)",  bg: "rgba(16,185,129,0.1)",  icon: "😊", desc: "Air quality is satisfactory" },
  Moderate: { color: "#f59e0b", glow: "rgba(245,158,11,0.35)",  bg: "rgba(245,158,11,0.1)",  icon: "😐", desc: "Acceptable with minor concerns" },
  Poor:     { color: "#ef4444", glow: "rgba(239,68,68,0.35)",   bg: "rgba(239,68,68,0.1)",   icon: "😷", desc: "Unhealthy for sensitive groups" },
  Severe:   { color: "#dc2626", glow: "rgba(220,38,38,0.4)",    bg: "rgba(220,38,38,0.12)",  icon: "🚨", desc: "Very unhealthy — stay indoors" },
};

// ── Component ─────────────────────────────────────────────────
function App() {
  const [sensor, setSensor] = useState({ gas: 0, dust: 0, temperature: 0, humidity: 0, aqi: 0, level: "Good" });
  const [savedPrecautions, setSavedPrecautions] = useState([]);
  const [aiPrecautions, setAiPrecautions]       = useState([]);
  const [aiLoading, setAiLoading]               = useState(false);
  const [aiError, setAiError]                   = useState(null);
  const [lastAiTime, setLastAiTime]             = useState(null);
  const [apiKeyMissing, setApiKeyMissing]       = useState(false);
  const [clock, setClock]                       = useState(new Date());
  const [cooldown, setCooldown]                 = useState(0);   // seconds remaining
  const cooldownRef                             = useRef(null);
  const prevLevelRef                            = useRef(null);

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Cooldown ticker ──
  const startCooldown = useCallback((secs = AI_COOLDOWN_SECS) => {
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    setCooldown(secs);
    cooldownRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) { clearInterval(cooldownRef.current); return 0; }
        return prev - 1;
      });
    }, 1000);
  }, []);

  // ── AI fetch ──
  const fetchAI = useCallback(async (data) => {
    setAiLoading(true);
    setAiError(null);
    setApiKeyMissing(false);
    try {
      const results = await getAIPrecautions(data);
      setAiPrecautions(results);
      setLastAiTime(new Date());
      startCooldown(); // start cooldown after successful call
    } catch (err) {
      if (err.message === "MISSING_API_KEY") {
        setApiKeyMissing(true);
      } else {
        // Extract retry-after seconds from 429 error message if present
        const retryMatch = err.message?.match(/(\d+\.?\d*)\s*s/i);
        const retrySecs = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : AI_COOLDOWN_SECS;
        if (err.message?.includes("429") || err.message?.includes("quota") || err.message?.includes("quota")) {
          setAiError(`Rate limit reached. AI will auto-retry in ${retrySecs}s.`);
          startCooldown(retrySecs);
        } else {
          setAiError(err.message || "Failed to load AI precautions.");
          startCooldown(15);
        }
      }
    } finally {
      setAiLoading(false);
    }
  }, [startCooldown]);

  // ── Firebase listener ──
  useEffect(() => {
    const dataRef = ref(database, "airQuality/current");
    const unsub = onValue(dataRef, (snap) => {
      const data = snap.val();
      if (!data) return;

      const gasVal  = data.gas         ?? 0;
      const dustVal = data.dust        ?? 0;
      const aqi     = calculateAQI(gasVal, dustVal);
      const level   = getLevelFromAQI(aqi);

      const newSensor = {
        gas: gasVal, dust: dustVal,
        temperature: data.temperature ?? 0,
        humidity:    data.humidity    ?? 0,
        aqi, level,
      };
      setSensor(newSensor);

      setSavedPrecautions(
        data.precautions ? Object.values(data.precautions) : []
      );

      // Only re-call AI on first load or level change
      if (prevLevelRef.current !== level) {
        prevLevelRef.current = level;
        fetchAI(newSensor);
      }
    });
    return () => unsub();
  }, [fetchAI]);

  const meta       = LEVEL_META[sensor.level] || LEVEL_META.Good;
  const aqiPercent = Math.min((sensor.aqi / 300) * 100, 100);

  const metrics = [
    { label: "Gas",         value: sensor.gas,         unit: "ADC", icon: "🌫️" },
    { label: "Dust",        value: sensor.dust,         unit: "ADC", icon: "💨" },
    { label: "Temperature", value: sensor.temperature,  unit: "°C",  icon: "🌡️" },
    { label: "Humidity",    value: sensor.humidity,     unit: "%",   icon: "💧" },
    { label: "AQI",         value: sensor.aqi,          unit: "",    icon: "📊", highlight: true },
  ];

  return (
    <div className="dashboard">

      {/* ── Header ── */}
      <header className="dash-header">
        <div className="header-brand">
          <div className="brand-pulse" style={{ "--pulse-color": meta.color }}></div>
          <div>
            <h1 className="brand-title" style={{ fontSize: "1.4rem" }}>Air Quality Monitoring</h1>
            <p className="brand-sub">& Precaution Suggester</p>
          </div>
        </div>
        <div className="header-right">
          <span className="live-badge">● LIVE</span>
          <div className="clock-box">
            <span className="clock-time">{clock.toLocaleTimeString()}</span>
            <span className="clock-date">{clock.toLocaleDateString()}</span>
          </div>
        </div>
      </header>

      {/* ── Sensor Metrics ── */}
      <section className="metrics-row">
        {metrics.map((m) => (
          <div key={m.label} className={`metric-card${m.highlight ? " metric-card--aqi" : ""}`}
               style={m.highlight ? { "--aqi-color": meta.color, "--aqi-glow": meta.glow } : {}}>
            <span className="metric-icon">{m.icon}</span>
            <div>
              <p className="metric-label">{m.label}</p>
              <p className="metric-value">{m.value}<span className="metric-unit">{m.unit}</span></p>
            </div>
          </div>
        ))}
      </section>

      {/* ── AQI Status ── */}
      <section className="aqi-section" style={{ "--lc": meta.color, "--lg": meta.glow, "--lb": meta.bg }}>
        <div className="aqi-status-row">
          <div className="aqi-icon-badge" style={{ background: meta.bg, boxShadow: `0 0 20px ${meta.glow}` }}>
            <span className="aqi-emoji">{meta.icon}</span>
            <div>
              <p className="aqi-level-name" style={{ color: meta.color }}>{sensor.level}</p>
              <p className="aqi-level-desc">{meta.desc}</p>
            </div>
          </div>
          <div className="aqi-score-box" style={{ color: meta.color, boxShadow: `0 0 25px ${meta.glow}` }}>
            <span className="aqi-score-num">{sensor.aqi}</span>
            <span className="aqi-score-label">AQI</span>
          </div>
        </div>
        <div className="aqi-track">
          <div className="aqi-fill" style={{ width: `${aqiPercent}%`, background: meta.color, boxShadow: `0 0 12px ${meta.glow}` }}></div>
        </div>
        <div className="aqi-scale-labels">
          <span style={{ color: "#10b981" }}>Good</span>
          <span style={{ color: "#f59e0b" }}>Moderate</span>
          <span style={{ color: "#ef4444" }}>Poor</span>
          <span style={{ color: "#dc2626" }}>Severe</span>
        </div>
      </section>

      {/* ── Dual Precautions ── */}
      <section className="precautions-grid">

        {/* Saved (Firebase) */}
        <div className="panel panel--firebase">
          <div className="panel-header">
            <div className="panel-title-group">
              <span className="panel-icon-circle panel-icon-circle--firebase">📋</span>
              <div>
                <h2 className="panel-title">Saved Precautions</h2>
                <p className="panel-subtitle">Stored in Firebase Database</p>
              </div>
            </div>
            <span className="badge badge--firebase">Firebase</span>
          </div>
          <div className="panel-body">
            {savedPrecautions.length > 0 ? (
              savedPrecautions.map((p, i) => (
                <div key={i} className="precaution-row">
                  <span className="dot dot--firebase"></span>
                  <p>{p}</p>
                </div>
              ))
            ) : (
              <div className="empty-state">
                <span>🔍</span>
                <p>No precautions saved in database.</p>
              </div>
            )}
          </div>
        </div>

        {/* AI (OpenAI) */}
        <div className="panel panel--ai">
          <div className="panel-header">
            <div className="panel-title-group">
              <span className="panel-icon-circle panel-icon-circle--ai">🤖</span>
              <div>
                <h2 className="panel-title">AI Precautions</h2>
                <p className="panel-subtitle">Generated by Gemini AI</p>
              </div>
            </div>
            <div className="panel-header-actions">
              <span className="badge badge--ai">Gemini AI</span>
              <button
                className={`refresh-btn${cooldown > 0 ? " refresh-btn--cooldown" : ""}`}
                onClick={() => cooldown === 0 && !aiLoading && !apiKeyMissing && fetchAI(sensor)}
                disabled={aiLoading || apiKeyMissing || cooldown > 0}
                title={cooldown > 0 ? `Wait ${cooldown}s before refreshing` : "Refresh AI precautions"}
              >
                {aiLoading
                  ? <span className="spin">🔄</span>
                  : cooldown > 0
                  ? <span className="cooldown-num">{cooldown}</span>
                  : <span>🔄</span>}
              </button>
            </div>
          </div>

          {lastAiTime && !apiKeyMissing && (
            <p className="last-updated">
              ⏱ Updated at {lastAiTime.toLocaleTimeString()}
            </p>
          )}

          <div className="panel-body">
            {apiKeyMissing ? (
              <div className="api-key-notice">
                <span className="notice-icon">🔑</span>
                <p className="notice-title">API Key Required</p>
                <p className="notice-desc">Add your Gemini API key to the <code>.env</code> file:</p>
                <code className="notice-code">VITE_GEMINI_API_KEY=your_key_here</code>
                <a className="notice-link" href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">
                  Get API key →
                </a>
              </div>
            ) : aiLoading ? (
              [1,2,3,4,5].map(i => (
                <div key={i} className="skeleton-row">
                  <div className="skeleton-dot"></div>
                  <div className="skeleton-line" style={{ width: `${70 + (i * 5 % 25)}%` }}></div>
                </div>
              ))
            ) : aiError ? (
              <div className="empty-state empty-state--error">
                <span>⚠️</span>
                <p>{aiError}</p>
                <button className="retry-btn" onClick={() => fetchAI(sensor)}>Try Again</button>
              </div>
            ) : aiPrecautions.length > 0 ? (
              aiPrecautions.map((p, i) => (
                <div key={i} className="precaution-row precaution-row--ai">
                  <span className="dot dot--ai"></span>
                  <p>{p}</p>
                </div>
              ))
            ) : (
              <div className="empty-state">
                <span>🤖</span>
                <p>AI precautions will load shortly…</p>
              </div>
            )}
          </div>
        </div>

      </section>

      {/* ── Footer ── */}
      <footer className="dash-footer">
        <span>Air Quality Monitoring & Precaution Suggester</span>
        <span className="footer-dot">•</span>
        <span>Firebase Realtime DB</span>
        <span className="footer-dot">•</span>
        <span>Gemini AI</span>
      </footer>

    </div>
  );
}

export default App;
