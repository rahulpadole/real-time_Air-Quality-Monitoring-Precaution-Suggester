/**
 * AIR QUALITY MONITORING - HARDWARE SNIPPET (ESP32/ESP8266)
 * This snippet shows how to listen to the 'buzzer' status from Firebase
 * and activate the physical buzzer on pin D18.
 */

#include <WiFi.h>
#include <Firebase_ESP_Client.h>

// 1. Connection Details
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
#define API_KEY "AIzaSyDa0_OO59UC7r7AtFG2XlkN2Sa_XE5Q0wI"
#define DATABASE_URL "https://airqualitymonitor-ca58a-default-rtdb.asia-southeast1.firebasedatabase.app"

// 2. Pin Definition
const int buzzerPin = 18; // D18

// Firebase objects
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

void setup() {
  Serial.begin(115200);
  
  // Initialize Pin
  pinMode(buzzerPin, OUTPUT);
  digitalWrite(buzzerPin, LOW); // Start with off

  // Connect to WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  // Configure Firebase
  config.api_key = API_KEY;
  config.database_url = DATABASE_URL;
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);
}

void loop() {
  // Read Buzzer status from Firebase
  // Recommended: Use a Firebase Stream for real-time, 
  // but for simplicity we show a basic GET here.
  
  if (Firebase.ready()) {
    if (Firebase.RTDB.getInt(&fbdo, "/airQuality/current/buzzer")) {
      int buzzerVal = fbdo.intData();
      
      if (buzzerVal == 1) {
        digitalWrite(buzzerPin, HIGH);
        Serial.println("BUZZER ACTIVE!");
      } else {
        digitalWrite(buzzerPin, LOW);
      }
    }
  }
  
  delay(1000); // Check every second
}
