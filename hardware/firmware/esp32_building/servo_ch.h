#pragma once
#include <stdint.h>
// In its own header so Arduino's auto-generated prototypes can see it.
struct ServoCh { uint8_t pin, ch; uint16_t cur, target; uint32_t arrived; bool limp; };
