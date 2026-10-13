// Serial output and the millisecond clock.
void setup() {
  Serial.begin(115200);
  Serial.println("hello");
}

void loop() {
  Serial.print("tick ");
  Serial.println(millis());
  delay(200);
}
