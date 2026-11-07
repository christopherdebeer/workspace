#pragma once
#include <stddef.h>
#include <stdarg.h>
int snprintf(char *out, size_t cap, const char *fmt, ...);
int vsnprintf(char *out, size_t cap, const char *fmt, va_list ap);
int printf(const char *fmt, ...);
int puts(const char *s);
