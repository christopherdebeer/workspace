/*
 * Just enough libc for firmware/main/afterword.c (and its host test) to run in
 * the browser unchanged. Numerics follow IEEE float like the ESP32-S3 FPU;
 * atan2f is computed in double and rounded, so it agrees with newlib/glibc to
 * within an ulp.
 */
#include <math.h>
#include <stdio.h>
#include <string.h>
#include <stdint.h>

void *memcpy(void *d, const void *s, size_t n) { unsigned char *o = d; const unsigned char *i = s; while (n--) *o++ = *i++; return d; }
void *memmove(void *d, const void *s, size_t n) {
    unsigned char *o = d; const unsigned char *i = s;
    if (o < i) while (n--) *o++ = *i++; else { o += n; i += n; while (n--) *--o = *--i; }
    return d;
}
void *memset(void *d, int c, size_t n) { unsigned char *o = d; while (n--) *o++ = (unsigned char)c; return d; }
size_t strlen(const char *s) { size_t n = 0; while (s[n]) ++n; return n; }
int strcmp(const char *a, const char *b) { while (*a && *a == *b) ++a, ++b; return (unsigned char)*a - (unsigned char)*b; }
int strncmp(const char *a, const char *b, size_t n) { for (; n; --n, ++a, ++b) { if (*a != *b || !*a) return (unsigned char)*a - (unsigned char)*b; } return 0; }
size_t strcspn(const char *s, const char *r) {
    size_t n = 0;
    for (; s[n]; ++n) for (const char *x = r; *x; ++x) if (s[n] == *x) return n;
    return n;
}

static double datan(double x) {          /* |x| <= 1 */
    int halvings = 0;
    while (x > 0.2 || x < -0.2) { x = x / (1.0 + __builtin_sqrt(1.0 + x * x)); ++halvings; }
    double x2 = x * x, term = x, sum = x;
    for (int k = 1; k < 30; ++k) { term *= -x2; sum += term / (2 * k + 1); }
    return sum * (double)(1 << halvings);
}
float atan2f(float yf, float xf) {
    const double pi = 3.14159265358979323846;
    double y = yf, x = xf;
    if (x == 0 && y == 0) return __builtin_copysignf(__builtin_signbit(xf) ? (float)pi : 0.0f, yf);
    double ay = y < 0 ? -y : y, ax = x < 0 ? -x : x, a;
    a = ay <= ax ? datan(ay / ax) : pi / 2 - datan(ax / ay);
    if (x < 0) a = pi - a;
    return (float)(y < 0 || (y == 0 && __builtin_signbit(yf)) ? -a : a);
}
static double dsin(double x) {
    const double pi = 3.14159265358979323846;
    x -= 2 * pi * __builtin_floor(x / (2 * pi));
    if (x > pi) x -= 2 * pi; else if (x < -pi) x += 2 * pi;
    double term = x, sum = x;
    for (int k = 1; k < 20; ++k) { term *= -x * x / ((2 * k) * (2 * k + 1)); sum += term; }
    return sum;
}
float sinf(float x) { return (float)dsin(x); }
float cosf(float x) { return (float)dsin((double)x + 1.57079632679489661923); }
float hypotf(float x, float y) { double a = x, b = y; return (float)__builtin_sqrt(a * a + b * b); }
long lroundf(float x) { double v = x; return v < 0 ? -(long)(-v + 0.5) : (long)(v + 0.5); }

static void put(char *out, size_t cap, size_t *n, char c) { if (*n + 1 < cap) out[*n] = c; ++*n; }
int vsnprintf(char *out, size_t cap, const char *f, va_list ap) {
    size_t n = 0;
    for (; *f; ++f) {
        if (*f != '%') { put(out, cap, &n, *f); continue; }
        ++f;
        int precision = -1;
        if (*f == '.') {
            ++f;
            if (*f == '*') { precision = va_arg(ap, int); ++f; }
            else { precision = 0; while (*f >= '0' && *f <= '9') precision = precision * 10 + (*f++ - '0'); }
        }
        if (*f == 's') {
            const char *s = va_arg(ap, const char *);
            if (!s) s = "(null)";
            for (int i = 0; s[i] && (precision < 0 || i < precision); ++i) put(out, cap, &n, s[i]);
        } else if (*f == 'c') {
            put(out, cap, &n, (char)va_arg(ap, int));
        } else if (*f == 'd' || *f == 'u' || *f == 'l') {
            long long v;
            if (*f == 'l') { while (*f == 'l') ++f; v = *f == 'u' ? (long long)va_arg(ap, unsigned long) : va_arg(ap, long); }
            else v = *f == 'u' ? (long long)va_arg(ap, unsigned) : va_arg(ap, int);
            char digits[24]; int k = 0;
            unsigned long long u = v < 0 ? (unsigned long long)-v : (unsigned long long)v;
            if (v < 0) put(out, cap, &n, '-');
            do { digits[k++] = (char)('0' + u % 10); u /= 10; } while (u);
            while (k) put(out, cap, &n, digits[--k]);
        } else if (*f == 'f') {
            double v = va_arg(ap, double);
            if (precision < 0) precision = 6;
            if (v < 0 || (v == 0 && __builtin_signbit(v))) { put(out, cap, &n, '-'); v = -v; }
            double scale = 1; for (int i = 0; i < precision; ++i) scale *= 10;
            double x = v * scale, whole = __builtin_floor(x), frac = x - whole;
            if (frac > 0.5 || (frac == 0.5 && whole - 2 * __builtin_floor(whole / 2) == 1)) whole += 1;   /* half to even */
            unsigned long long u = (unsigned long long)whole, ip = u / (unsigned long long)scale, fp = u % (unsigned long long)scale;
            char digits[24]; int k = 0;
            do { digits[k++] = (char)('0' + ip % 10); ip /= 10; } while (ip);
            while (k) put(out, cap, &n, digits[--k]);
            if (precision) {
                put(out, cap, &n, '.');
                for (int i = precision - 1; i >= 0; --i) { unsigned long long d = fp; for (int j = 0; j < i; ++j) d /= 10; put(out, cap, &n, (char)('0' + d % 10)); }
            }
        } else if (*f == '%') {
            put(out, cap, &n, '%');
        }
    }
    if (cap) out[n < cap ? n : cap - 1] = 0;
    return (int)n;
}
int snprintf(char *out, size_t cap, const char *f, ...) { va_list ap; va_start(ap, f); int n = vsnprintf(out, cap, f, ap); va_end(ap); return n; }

/* Console output goes to the host one line at a time. */
extern void sim_print(const char *s, int length);
int printf(const char *f, ...) { char line[256]; va_list ap; va_start(ap, f); int n = vsnprintf(line, sizeof(line), f, ap); va_end(ap); sim_print(line, (int)strlen(line)); return n; }
int puts(const char *s) { sim_print(s, (int)strlen(s)); return 0; }
