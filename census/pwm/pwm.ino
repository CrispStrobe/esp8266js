// Software PWM on a pin and an ADC read.
void setup() {
  pinMode(D5, OUTPUT);
  analogWriteRange(255);
}

void loop() {
  analogWrite(D5, analogRead(A0) >> 2);
  delay(20);
}
