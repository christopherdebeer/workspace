/* The simulator's view of the reader: flat buffers JavaScript can read. */
#include "afterword.h"
#include <string.h>

static float gravity_in[3], gyro_in[3], state_out[12];
static aw_frame_t frame_out;
static char note_in[96];

float *sim_gravity(void) { return gravity_in; }
float *sim_gyro(void) { return gyro_in; }
char *sim_note(void) { return note_in; }
aw_frame_t *sim_frame(void) { return &frame_out; }
float *sim_state(void) { return state_out; }
int sim_frame_field(void) { return (int)sizeof(frame_out.word); }

static void publish(void) {
    aw_state_t s;
    aw_frame(&frame_out);
    aw_state(&s);
    state_out[0] = s.roll_radians;
    state_out[1] = s.pitch_radians;
    state_out[2] = s.rate_multiplier;
    state_out[3] = s.orientation_ready;
    state_out[4] = s.roll_active;
    state_out[5] = s.roll_armed;
    state_out[6] = s.tilt_latched;
    state_out[7] = s.focused;
    state_out[8] = s.tutorial_active;
    state_out[9] = s.tutorial_complete;
    state_out[10] = (float)s.tutorial_stage;
    state_out[11] = (float)aw_fixation_index(frame_out.word);
}

void sim_init(int pace_ms, int invert_roll, int invert_pitch, int tutorial_done, uint32_t now) {
    aw_init(pace_ms, invert_roll, invert_pitch, tutorial_done, note_in, now);
    publish();
}

void sim_tick(uint32_t now, int live) {
    aw_gravity(gravity_in);
    aw_tick(now, gyro_in, live);
    publish();
}

void sim_restart_tutorial(uint32_t now) { aw_tutorial_restart(now); publish(); }
const char *sim_stage_name(int stage) { return aw_tutorial_stage_name((aw_tutorial_stage_t)stage); }
void sim_print_unused(void) {}
