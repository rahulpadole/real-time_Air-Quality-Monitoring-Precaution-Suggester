import React, { useEffect, useState, useCallback, useRef } from "react";
import { ref, onValue, set } from "firebase/database";
import { database } from "./firebase";
import { getAIPrecautions } from "./geminiService";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Wind, Droplets, Thermometer, Activity, Zap, 
  RefreshCw, Database, Bot, Clock, MapPin, 
  ShieldAlert, AlertTriangle, CheckCircle, Info, Flame
} from "lucide-react";
import "./App.css";

const AI_COOLDOWN_SECS = 60;

// ── Pure Helpers ──────────────────────────────────────────────
const getInterpolatedAQI = (value, breakpoints) => {
  const roundedValue = Math.round(value);
  const table = breakpoints.find(b => roundedValue >= b.cLo && roundedValue <= b.cHi);
  if (!table) return roundedValue > breakpoints[breakpoints.length - 1].cHi ? 500 : 0;
  const { cLo, cHi, iLo, iHi } = table;
  return Math.round(((iHi - iLo) / (cHi - cLo)) * (roundedValue - cLo) + iLo);
};

const DUST_BREAKPOINTS = [
  { cLo: 0,    cHi: 12,   iLo: 0,   iHi: 50 },
  { cLo: 13,   cHi: 35,   iLo: 51,  iHi: 100 },
  { cLo: 36,   cHi: 55,   iLo: 101, iHi: 150 },
  { cLo: 56,   cHi: 150,  iLo: 151, iHi: 200 },
  { cLo: 151,  cHi: 250,  iLo: 201, iHi: 300 },
  { cLo: 251,  cHi: 500,  iLo: 301, iHi: 500 }
];

const GAS_BREAKPOINTS = [
  { cLo: 0,    cHi: 700,  iLo: 0,   iHi: 50 },
  { cLo: 701,  cHi: 1300, iLo: 51,  iHi: 100 },
  { cLo: 1301, cHi: 1700, iLo: 101, iHi: 150 },
  { cLo: 1701, cHi: 2200, iLo: 151, iHi: 200 },
  { cLo: 2201, cHi: 2900, iLo: 201, iHi: 300 },
  { cLo: 2901, cHi: 4095, iLo: 301, iHi: 500 }
];

const calculateAQI = (gas, dust) => {
  const gasIndex  = getInterpolatedAQI(gas, GAS_BREAKPOINTS);
  const dustIndex = getInterpolatedAQI(dust, DUST_BREAKPOINTS);
  return Math.max(gasIndex, dustIndex);
};

const getLevelFromAQI = (aqi) => {
  if (aqi <= 50)  return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy for Sensitive Groups";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very Unhealthy";
  return "Hazardous";
};

const LEVEL_META = {
  "Good": { 
    color: "#10b981", glow: "rgba(16,185,129,0.3)", icon: <CheckCircle size={36} />, 
    desc: "Air quality is satisfactory", bg: "rgba(16,185,129,0.05)"
  },
  "Moderate": { 
    color: "#f59e0b", glow: "rgba(245,158,11,0.3)", icon: <Info size={36} />, 
    desc: "Acceptable for most people", bg: "rgba(245,158,11,0.05)"
  },
  "Unhealthy for Sensitive Groups": { 
    color: "#f97316", glow: "rgba(249,115,22,0.3)", icon: <AlertTriangle size={36} />, 
    desc: "Sensitive groups should reduce outdoor activity", bg: "rgba(249,115,22,0.05)"
  },
  "Unhealthy": { 
    color: "#ef4444", glow: "rgba(239,68,68,0.3)", icon: <Flame size={36} />, 
    desc: "Everyone may begin to experience health effects", bg: "rgba(239,68,68,0.05)"
  },
  "Very Unhealthy": { 
    color: "#b91c1c", glow: "rgba(185,28,28,0.35)", icon: <ShieldAlert size={36} />, 
    desc: "Health alert: serious effects for everyone", bg: "rgba(185,28,28,0.05)"
  },
  "Hazardous": { 
    color: "#7f1d1d", glow: "rgba(127,29,29,0.45)", icon: <Zap size={36} />, 
    desc: "Health warning of emergency conditions", bg: "rgba(127,29,29,0.08)"
  },
};

const STANDARD_PRECAUTIONS = {
  "Good": ["Ideal for outdoor exercise", "Ventilate indoor spaces", "No restrictions for anyone", "Enjoy the clean environment"],
  "Moderate": ["Sensitive people should limit exertion", "Consider air purifiers", "Acceptable quality level", "Monitor symptoms"],
  "Unhealthy for Sensitive Groups": ["Kids & elderly should stay indoors", "Reduce outdoor physical effort", "Close windows", "Use indoor filtration"],
  "Unhealthy": ["Limit all outdoor activity", "Wear masks outside", "Run purifiers on high", "Protect your respiratory health"],
  "Very Unhealthy": ["Everyone stay indoors", "Avoid physical effort completely", "N95 masks mandatory", "Seal all air gaps"],
  "Hazardous": ["Medical emergency conditions", "Avoid all outdoor air", "Stay in air-conditioned room", "Follow local health alerts"]
};

// ── Components ────────────────────────────────────────────────
const SemiCircleGauge = ({ value, color }) => {
  const rotation = (value / 500) * 180 - 90;
  return (
    <div className="gauge-container">
      <svg width="240" height="140" viewBox="0 0 240 140">
        <path d="M 20 120 A 100 100 0 0 1 220 120" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="12" strokeLinecap="round" />
        <motion.path 
          d="M 20 120 A 100 100 0 0 1 220 120" fill="none" stroke={color} strokeWidth="14" strokeLinecap="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: value / 500 }} transition={{ duration: 1.5, ease: "easeOut" }}
          style={{ filter: `drop-shadow(0 0 8px ${color})` }}
        />
      </svg>
      <div className="gauge-content">
        <motion.span className="gauge-value" animate={{ color }}>{Math.round(value)}</motion.span>
        <p className="gauge-label">AQI INDEX</p>
      </div>
    </div>
  );
};

function App() {
  const [sensor, setSensor] = useState({ gas: 0, dust: 0, temperature: 0, humidity: 0, aqi: 0, level: "Good" });
  const [historyData, setHistoryData] = useState([]);
  const [aiPrecautions, setAiPrecautions] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [lastAiTime, setLastAiTime] = useState(null);
  const [apiKeyMissing, setApiKeyMissing] = useState(false);
  const [clock, setClock] = useState(new Date());
  const [cooldown, setCooldown] = useState(0);
  const cooldownRef = useRef(null);
  const prevLevelRef = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const startCooldown = useCallback((secs = AI_COOLDOWN_SECS) => {
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    setCooldown(secs);
    cooldownRef.current = setInterval(() => {
      setCooldown((p) => { if (p <= 1) { clearInterval(cooldownRef.current); return 0; } return p - 1; });
    }, 1000);
  }, []);

  const fetchAI = useCallback(async (data) => {
    setAiLoading(true); setAiError(null); setApiKeyMissing(false);
    try {
      const res = await getAIPrecautions(data);
      setAiPrecautions(res); setLastAiTime(new Date()); startCooldown();
    } catch (err) {
      if (err.message === "MISSING_API_KEY") setApiKeyMissing(true);
      else setAiError(err.message || "AI failed");
    } finally { setAiLoading(false); }
  }, [startCooldown]);

  useEffect(() => {
    const dataRef = ref(database, "air");
    const unsub = onValue(dataRef, (snap) => {
      const data = snap.val();
      if (!data) return;
      const gas = Number(data.gas ?? 0);
      const dust = Number((Number(data.dust ?? 0) / 10).toFixed(1));
      const aqi = calculateAQI(gas, dust);
      const level = getLevelFromAQI(aqi);
      const newSensor = { gas, dust, temperature: data.temp ?? 0, humidity: data.humidity ?? 0, aqi, level };
      
      setSensor(newSensor);
      setHistoryData(prev => {
        const now = Date.now();
        const time = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        // Add new point with a timestamp for accurate 1-hour filtering
        const updated = [...prev, { timestamp: now, time, AQI: aqi, Gas: gas, Dust: dust }];
        // Filter out anything older than 1 hour (3600000 ms)
        return updated.filter(point => now - point.timestamp <= 3600000);
      });

      if (prevLevelRef.current !== level) {
        prevLevelRef.current = level;
        fetchAI(newSensor);
      }
    });

    // Buzzer control
    const buzzerRef = ref(database, "air/buzzer");
    const isBuzzer = ["Unhealthy", "Very Unhealthy", "Hazardous"].includes(sensor.level);
    set(buzzerRef, isBuzzer ? 1 : 0);

    return () => unsub();
  }, [fetchAI, sensor.level]);

  const meta = LEVEL_META[sensor.level] || LEVEL_META.Good;
  const metrics = [
    { label: "Gas", value: sensor.gas, unit: "ppm", icon: <Wind size={20} /> },
    { label: "Dust", value: sensor.dust, unit: "µg/m³", icon: <Droplets size={20} /> },
    { label: "Temp", value: sensor.temperature, unit: "°C", icon: <Thermometer size={20} /> },
    { label: "Humidity", value: sensor.humidity, unit: "%", icon: <Activity size={20} /> },
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="dashboard" style={{ "--aqi-color": meta.color, "--aqi-glow": meta.glow, "--aqi-bg": meta.bg }}>
      
      <header className="dash-header">
        <div className="header-brand">
          <div className="brand-pulse"><Wind color="#fff" size={28} /></div>
          <div>
            <h1 className="brand-title">AIRSENSE ELITE</h1>
            <p className="brand-sub">PRECISION MONITORING</p>
          </div>
        </div>
        <div className="header-right">
          <div className="live-badge"><div className="live-dot" /> LIVE FEED</div>
          <div className="clock-box">
            <p className="clock-time">{clock.toLocaleTimeString()}</p>
            <p className="clock-date">{clock.toLocaleDateString()}</p>
          </div>
        </div>
      </header>

      <section className="metrics-row">
        <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="metric-card metric-card--aqi">
          <div className="metric-header">
             <p className="metric-label">System Health</p>
             <Zap size={18} color={meta.color} />
          </div>
          <p className="metric-value">{sensor.aqi}<span className="metric-unit">AQI</span></p>
        </motion.div>
        {metrics.map((m, i) => (
          <motion.div initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: i * 0.1 }} key={m.label} className="metric-card">
            <div className="metric-header">
              <p className="metric-label">{m.label}</p>
              <div className="metric-icon-box">{m.icon}</div>
            </div>
            <p className="metric-value">{m.value}<span className="metric-unit">{m.unit}</span></p>
          </motion.div>
        ))}
      </section>

      <main className="main-grid">
        <section className="aqi-hero">
          <div className="hero-header">
            <div className="status-badge" style={{ backgroundColor: meta.bg, borderColor: meta.color }}>
              <div className="status-icon">{meta.icon}</div>
              <div>
                <h2 className="status-title" style={{ color: meta.color }}>{sensor.level}</h2>
                <p className="status-desc">{meta.desc}</p>
              </div>
            </div>
            <MapPin size={24} color="var(--text-muted)" />
          </div>
          <SemiCircleGauge value={sensor.aqi} color={meta.color} />
        </section>

        <section className="chart-card">
          <header className="chart-header">
            <h2 className="chart-title">Dynamic Trends</h2>
            <Clock size={18} color="var(--text-muted)" />
          </header>
          
          <div style={{ width: '100%', height: '280px', paddingTop: '20px' }}>
            {historyData.length > 2 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={historyData}>
                  <defs>
                    <linearGradient id="colorAqi" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={meta.color} stopOpacity={0.3}/>
                      <stop offset="95%" stopColor={meta.color} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
                  <XAxis 
                    dataKey="time" 
                    stroke="#64748b" 
                    fontSize={11} 
                    tickMargin={12}
                    minTickGap={60}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis 
                    stroke="#64748b" 
                    fontSize={11} 
                    domain={[0, 500]} 
                    tickCount={6}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip 
                    contentStyle={{ background: '#0a0f1d', border: '1px solid var(--border)', borderRadius: '12px', backdropFilter: 'blur(10px)' }}
                    itemStyle={{ color: meta.color, fontSize: '13px', fontWeight: '600' }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="AQI" 
                    stroke={meta.color} 
                    strokeWidth={3} 
                    fillOpacity={1} 
                    fill="url(#colorAqi)"
                    isAnimationActive={false} // Disable animation to debug rendering
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', gap: '12px' }}>
                <RefreshCw size={24} className="spin" />
                <p style={{ fontSize: '14px' }}>Collecting trend data...</p>
              </div>
            )}
          </div>
        </section>
      </main>

      <section className="precautions-grid">
        <div className="pre-panel">
          <div className="pre-header">
            <div className="pre-title-group"><Database size={20} className="pre-icon" /> <h2 className="pre-title">Action Protocol</h2></div>
            <span className="ai-badge" style={{ background: 'rgba(255,255,255,0.1)' }}>ROOT</span>
          </div>
          <div className="pre-body">
            {STANDARD_PRECAUTIONS[sensor.level].map((text, i) => (
              <motion.div initial={{ x: -10, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: i * 0.1 }} key={i} className="pre-row">
                <div className="pre-dot" />
                <p className="pre-text">{text}</p>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="pre-panel">
          <div className="pre-header">
            <div className="pre-title-group"><Bot size={20} className="pre-icon" /> <h2 className="pre-title">Intelligence Insight</h2></div>
            <div className="ai-badge">GEMINI AI</div>
          </div>
          <div className="pre-body">
            {aiLoading ? <p className="pre-text">Analyzing environmental data...</p> : 
             aiPrecautions.map((text, i) => (
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: i * 0.1 }} key={i} className="pre-row" style={{ borderColor: 'rgba(167, 139, 250, 0.2)' }}>
                <div className="pre-dot" style={{ background: '#a78bfa' }} />
                <p className="pre-text">{text}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <footer className="dash-footer">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Zap size={14} /> <span>POWERED BY GEMINI 1.5 FLASH</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Database size={14} /> <span>REAL-TIME FIREBASE STORAGE</span>
        </div>
      </footer>
    </motion.div>
  );
}

export default App;
