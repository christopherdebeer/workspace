#pragma once
void sim_assert_failed(const char *expr, const char *file, int line);
static inline _Noreturn void sim_assert_trap(const char *e, const char *f, int l) { sim_assert_failed(e, f, l); __builtin_trap(); }
#define assert(e) ((e) ? (void)0 : sim_assert_trap(#e, __FILE__, __LINE__))
