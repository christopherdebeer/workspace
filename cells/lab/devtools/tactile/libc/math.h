/* Freestanding math for the Tactile reader core in WebAssembly. */
#pragma once
#define fabsf(x) __builtin_fabsf(x)
#define sqrtf(x) __builtin_sqrtf(x)
#define copysignf(x, y) __builtin_copysignf(x, y)
float atan2f(float y, float x);
float hypotf(float x, float y);
long lroundf(float x);
float sinf(float x);
float cosf(float x);
