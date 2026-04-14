// src/geminiService.js
import { GoogleGenerativeAI } from "@google/generative-ai";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.VITE_OPENAI_API_KEY;

// Fallback precautions based on AQI Level
const FALLBACK_PRECAUTIONS = {
  Good: [
    "Air quality is ideal for outdoor activities.",
    "Open windows to ventilate your home.",
    "Great time for a walk or exercise outside.",
    "No health risks for sensitive groups.",
    "Enjoy the fresh air without any restrictions."
  ],
  Moderate: [
    "Unusually sensitive individuals should limit prolonged outdoor exertion.",
    "Consider reducing intense outdoor activities if you experience symptoms.",
    "Keep windows closed during peak traffic hours.",
    "Air purifiers can be used on low settings indoors.",
    "Monitor yourself for respiratory issues."
  ],
  Poor: [
    "Everyone should reduce prolonged or heavy outdoor exertion.",
    "Sensitive groups should avoid outdoor activities completely.",
    "Keep all windows closed to prevent polluted air from entering.",
    "Run indoor air purifiers at a medium-high setting.",
    "Consider wearing an N95 mask if you must go outside."
  ],
  Severe: [
    "Stay indoors and avoid all outdoor physical activities.",
    "Ensure all doors and windows are strictly sealed.",
    "Use air purifiers constantly on their highest setting.",
    "Wear a high-quality N95 or KN95 mask if you must briefly go outside.",
    "Seek medical attention if you experience shortness of breath."
  ]
};

export async function getAIPrecautions({ gas, dust, temperature, humidity, aqi, level }) {
  // If no API key is set at all, immediately use fallback
  if (!API_KEY || API_KEY === "your_openai_api_key_here" || API_KEY === "your_key_here" || API_KEY === "your_gemini_api_key_here") {
    return FALLBACK_PRECAUTIONS[level] || FALLBACK_PRECAUTIONS.Good;
  }

  try {
    const genAI = new GoogleGenerativeAI(API_KEY);
    // Try the standard flash model
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `Based on the following real-time sensor data, give exactly 5 specific, actionable health precautions:

Sensor Data:
- Gas Level (raw ADC): ${gas}
- Dust Level (raw ADC): ${dust}
- Temperature: ${temperature}°C
- Humidity: ${humidity}%
- AQI Index: ${aqi}
- Air Quality Level: ${level}

Respond ONLY with a JSON array of 5 strings. Example:
["Precaution one.", "Precaution two.", "Precaution three.", "Precaution four.", "Precaution five."]

Return ONLY the array without any markdown wrappers (like \`\`\`json) or other text.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed) && parsed.length > 5) {
          return parsed.slice(0, 5); // Ensure exactly 5
        } else if (Array.isArray(parsed) && parsed.length === 5) {
          return parsed;
        }
      } catch(e) {
        console.error("JSON parse error from Gemini:", e);
      }
    }
    
    // If we reach here, AI returned something weird, fallback to local AQI rules
    console.warn("Invalid AI response format, using local fallback precautions.");
    return FALLBACK_PRECAUTIONS[level] || FALLBACK_PRECAUTIONS.Good;

  } catch (error) {
    console.warn("Gemini API Error (falling back to local rules):", error.message);
    // If the API throws 404, 400, or a rate limit, gracefully fallback without breaking the UI
    return FALLBACK_PRECAUTIONS[level] || FALLBACK_PRECAUTIONS.Good;
  }
}
