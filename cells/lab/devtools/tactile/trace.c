/* Native driver for the parity check: one "now gx gy gz wx wy wz" per line in,
 * one "section|word|after|hint|rate|stage|focused|latched" per line out. */
#include "afterword.h"
#include <math.h>
#include <stdio.h>

float *sim_gravity(void);
float *sim_gyro(void);
float *sim_state(void);
aw_frame_t *sim_frame(void);
void sim_init(int, int, int, int, uint32_t);
void sim_tick(uint32_t, int);
const char *sim_stage_name(int);

int main(void) {
    sim_init(440, 0, 0, 0, 0);
    unsigned now;
    float *g = sim_gravity(), *w = sim_gyro();
    while (scanf("%u %f %f %f %f %f %f", &now, &g[0], &g[1], &g[2], &w[0], &w[1], &w[2]) == 7) {
        sim_tick(now, 1);
        aw_frame_t *f = sim_frame();
        float *s = sim_state();
        printf("%s|%s|%s|%s|%.4f|%s|%d|%d\n", f->section, f->word, f->after, f->hint, s[2],
               sim_stage_name((int)s[10]), (int)s[7], (int)s[6]);
    }
    return 0;
}
