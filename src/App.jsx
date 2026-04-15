import React, { useEffect, useState, useCallback, useRef } from "react";
import { ref, onValue, set } from "firebase/database";
import { database } from "./firebase";
import { getAIPrecautions } from "./geminiService";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import "./App.css";

const AI_COOLDOWN_SECS = 60; // minimum seconds between AI calls

// ── Pure helpers ──────────────────────────────────────────────
// Standard AQI Breakpoints (Linear Interpolation Method)
const getInterpolatedAQI = (value, breakpoints) => {
  const roundedValue = Math.round(value);
  const table = breakpoints.find(b => roundedValue >= b.cLo && roundedValue <= b.cHi);
  if (!table) return roundedValue > breakpoints[breakpoints.length - 1].cHi ? 500 : 0;
  
  const { cLo, cHi, iLo, iHi } = table;
  return Math.round(((iHi - iLo) / (cHi - cLo)) * (roundedValue - cLo) + iLo);
};

const DUST_BREAKPOINTS = [
  { cLo: 0,   cHi: 30,  iLo: 0,   iHi: 50 },
  { cLo: 31,  cHi: 60,  iLo: 51,  iHi: 100 },
  { cLo: 61,  cHi: 150, iLo: 101, iHi: 200 },
  { cLo: 151, cHi: 250, iLo: 201, iHi: 300 },
  { cLo: 251, cHi: 350, iLo: 301, iHi: 400 },
  { cLo: 351, cHi: 1023, iLo: 401, iHi: 500 }
];

const GAS_BREAKPOINTS = [
  { cLo: 0,   cHi: 200, iLo: 0,   iHi: 50 },
  { cLo: 201, cHi: 400, iLo: 51,  iHi: 100 },
  { cLo: 401, cHi: 600, iLo: 101, iHi: 200 },
  { cLo: 601, cHi: 800, iLo: 201, iHi: 300 },
  { cLo: 801, cHi: 1023, iLo: 301, iHi: 500 }
];

const calculateAQI = (gas, dust) => {
  // 1. Calculate individual indices (sub-indices)
  const gasIndex  = getInterpolatedAQI(gas, GAS_BREAKPOINTS);
  const dustIndex = getInterpolatedAQI(dust, DUST_BREAKPOINTS);
  
  // 2. Final AQI is the maximum of the sub-indices
  return Math.max(gasIndex, dustIndex);
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
  const [historyData, setHistoryData]           = useState([]);
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

      const gasVal  = Number(data.gas         ?? 0);
      const dustVal = Number(data.dust        ?? 0);
      const tempVal = Number(data.temperature ?? 0);
      const humVal  = Number(data.humidity    ?? 0);
      
      const hardwareAqi = Number(data.aqi ?? 0);
      const hardwareLevel = data.level || "Good";

      // Use the hardware-calculated values directly
      const aqi     = hardwareAqi;
      const level   = hardwareLevel;

      const newSensor = {
        gas: gasVal, dust: dustVal,
        temperature: tempVal,
        humidity: humVal,
        aqi, level,
      };
      setSensor(newSensor);

      // Accumulate real-time history for the chart
      setHistoryData((prev) => {
        const timeStr = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
        // Always append to allow graph to scroll forward over time.
        const newData = [...prev, { time: timeStr, AQI: aqi, Gas: gasVal, Dust: dustVal }];
        return newData.length > 20 ? newData.slice(newData.length - 20) : newData; // keep last 20 elements
      });

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

  // ── Buzzer Control Sync ──
  useEffect(() => {
    if (!sensor.level) return;
    const buzzerRef = ref(database, "airQuality/current/buzzer");
    // Activate buzzer for Poor or Severe air quality
    const isBuzzerNeeded = (sensor.level === "Poor" || sensor.level === "Severe");
    set(buzzerRef, isBuzzerNeeded ? 1 : 0).catch(err => console.error("Firebase Buzzer Update Error:", err));
  }, [sensor.level]);

  const meta       = LEVEL_META[sensor.level] || LEVEL_META.Good;
  const aqiPercent = Math.min((sensor.aqi / 500) * 100, 100);

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

      {/* ── Historical Data Chart ── */}
      <section className="chart-section panel">
        <div className="panel-header">
          <div className="panel-title-group">
            <span className="panel-icon-circle">📈</span>
            <div>
              <h2 className="panel-title">Real-time Trends</h2>
              <p className="panel-subtitle">Gas, Dust, and AQI fluctuations over the last 20 updates</p>
            </div>
          </div>
        </div>
        <div className="panel-body chart-body">
          {historyData.length > 1 ? (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={historyData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorAqi" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={meta.color} stopOpacity={0.8} />
                    <stop offset="95%" stopColor={meta.color} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorGas" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorDust" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a855f7" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" stroke="#6b7280" fontSize={11} tickMargin={10} minTickGap={20} />
                <YAxis yAxisId="left" stroke="#6b7280" fontSize={11} domain={[0, 'auto']} />
                <YAxis yAxisId="right" orientation="right" stroke="#6b7280" fontSize={11} domain={[0, 'auto']} />
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "rgba(15,15,15,0.9)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", backdropFilter: "blur(10px)" }}
                  itemStyle={{ fontSize: "14px", fontWeight: "600" }}
                  labelStyle={{ color: "#9ca3af", marginBottom: "4px" }}
                />
                <Area yAxisId="right" type="monotone" dataKey="Gas" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorGas)" />
                <Area yAxisId="right" type="monotone" dataKey="Dust" stroke="#a855f7" strokeWidth={2} fillOpacity={1} fill="url(#colorDust)" />
                <Area yAxisId="left" type="monotone" dataKey="AQI" stroke={meta.color} strokeWidth={3} fillOpacity={1} fill="url(#colorAqi)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state">
              <span className="spin">🔄</span>
              <p>Accumulating real-time sensor data...</p>
            </div>
          )}
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
