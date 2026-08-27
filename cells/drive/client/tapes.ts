/**
 * ── AUTHORED TAPES: THE ATTRACT REEL ──
 *
 * Input tapes (see the recorder in main.ts) banked into the bundle: each is a
 * real drive, re-simulated live on the player's device under the splash — the
 * trailer is rendered by the game, at the player's own hour and weather.
 *
 * A reel entry carries where to boot (lat/lon/h — an attract cycle travels the
 * way DRIVES travels, by reload, because the world origin is set at boot) and
 * the tape itself, typed-array halves as base64.
 *
 * AUTHORING: drive it, KEEP it (SETTINGS → recorder), then `__tapeexport()`
 * in the console prints this exact shape. Paste it here.
 */
export interface AttractTape {
  id: string;
  name: string;
  lat: number; lon: number; h: number;
  head: {
    v: number; build: string; at: number; lat: number; lon: number;
    hdg: number; t: string; wx: string; steps: number; secs: number;
    /** Weather as numbers — cover, rain, wet — so a replay drives the surface
     *  it was recorded on. Absent on tapes cut before the field existed. */
    wxc?: number; wxr?: number; wxw?: number;
  };
  /** Uint8Array of 4-byte steps (dt, steer, throttle, brake), base64. */
  steps: string;
  /** Float32Array of 10-float checkpoints, base64. */
  keys: string;
}
// HARNESS-AUTHORED PLACEHOLDERS (the headless rig drives at a fraction of
// real time, so these are modest). The reel wants drives from the SEAT:
// drive it, KEEP it, __tapeexport(), replace these.
export const ATTRACT_TAPES: AttractTape[] = [
  {
    id: "noordhoek", name: "NOORDHOEK ROAD",
    lat: -34.0971, lon: 18.37582, h: 109,
    head: { v: 1, build: "http://localhost:8832/", at: 1787529474803, lat: -34.09709788222099, lon: 18.375820902946735, hdg: 109.45, t: "NOON", wx: "clear", steps: 425, secs: 21.25 },
    steps: "/4CAAP+AgAD/gIAA/3bGAP92xgD/dsYA/3bGAP92xgD/dsYA/3fGAP93xgD/d8YA/3fGAP94xgD/eMYA/3nGAP95xgD/ecYA/3nGAP96xgD/esYA/3rGAP96xgD/e8YA/3vGAP97xgD/e8YA/4DGAP+AxgD/gMYA/4DGAP+AxgD/gMYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+ClgD/gpYA/4GWAP+BlgD/gZYA/4GWAP+BlgD/gZYA/4GWAP+BlgD/gZYA/4GWAP+AlgD/gJYA/4CWAP+AlgD/gpYA/4KWAP+ClgD/gpYA/4GWAP+BlgD/gZYA/4GWAP+BlgD/gZYA/4GWAP+BlgD/gcYA/4HGAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gZYA/4GWAP+BlgD/gZYA/4GWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AxgD/gMYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AxgD/gMYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AxgD/gMYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gMYA/4DGAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AxgD/gMYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/f5YA/3+WAP9/lgD/f5YA/3+WAP9/lgD/f5YA/3+WAP9/lgD/f8YA/3/GAP9/lgD/f5YA/3+WAP9/lgD/f5YA/3+WAP9/lgD/f5YA/3+WAP9/lgD/f5YA/3+WAP9/lgD/f5YA/3+WAP9/lgD/f5YA/3+WAP9/lgD/f8YA/3/GAP9/lgD/f5YA/3+WAP9/lgD/f5YA/3+WAP9/lgD/f5YA/3+WAP9/lgD/f5YA/3+WAP9/lgD/f5YA/3+WAP9/lgD/f5YA/3+WAP9/lgD/f8YA/3/GAP9/lgD/f5YA/3+WAP9/lgD/f5YA/3+WAP9/lgD/f5YA/4GWAP+BlgD/gZYA/4GWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4DGAP+AxgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4DGAP+AxgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gMYA/4DGAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4CWAP+AlgD/gJYA/4SWAP+ElgD/g5YA/4OWAP+DlgD/gpYA/4KWAP+ClgD/gpYA/4KWAP+BlgD/gZYA/4GWAP+BlgD/gZYA/4GWAP+BlgD/gZYA/4GWAP+BxgD/gcYA/4OWAP+DlgD/gpYA/4KWAP+ClgD/gpYA/4GWAP+BlgD/gZYA/4GWAP+BlgD/gZYA/4GWAP+BlgD/gZYA/4GWAP+BlgD/gZYA/4GWAP+BlgD/gZYA/4GWAP+AgAA=",
    keys: "vHeqPcBocb59gfQ/AAAAAAAAAAAAAAAAAAAAAPsnGj/Ghcy5jMBNONTv0UCY3uw/CEjvPyVzGEHM9em38kQyOtc7IjozRBc/Rg1/PLUNZLpxba1BGajSQH8G8T9rBihB1aoSuYmXpjz1xY88FGcdP/kUYDw/Kxs6Ra4TQoiZOkEXEfM/Q+AqQfFLnLixYc07NKyvO6TIRT+aAIQ8lry+ORN+UELPJ4dBjcPzP2NOLUH9Mhe4IjMkO+RnCzsNvXM/7ZGaPPMR/DjTlYZCl1uxQcz58z/Gky5B5XM/t3ajADq9l9k55a2ZP/4X3jxDPhc4lvqkQnK/20GlBfQ/nl0uQR8fIbYwp8c45PaoOHujwz+2Zes8i+j4Ns1sw0IjHgNC8gf0P3LnLUFwkpi0l4aDN3PtXjcdEO8/P6HnPNpaoTVS0uFCOVQYQj8I9D8E6yxBR+yeMtoc1DXmS7Q1Y0IPQAMSCj0dnrYzrhYAQwuDLUI/CPQ/LjcqQQXZHDMyLjq1cpMftTXRLUCiOh49BlZHs3FDD0PNsEJCOgj0P9GaL0EB0WsyvOhdtOUaO7QHr1FAAOMsPeThyrKMex5D9yxYQu0L9T+wTSxBJmpyOVVE/TuDrtc7sA5yQLz5DT3CCSI4ep4tQ+gXbkJy1fU/HowqQQfysrhMH/46opXZOpaghkDeSe08GalAOX+6PEM7LYJCCpb3P/3UKUFSJ0E5YAi3PNoQnTzLKJJA8yjdPGp2NzqWpEtDkvuNQum++j8iTCpB6OyfuVe7GjxglgQ8RwWcQPUzvzzi/yY6",
  },
  {
    id: "romsdalen", name: "ROMSDALEN",
    lat: 62.5511, lon: 7.7112, h: 322,
    head: { v: 1, build: "http://localhost:8861/", at: 1787529397503, lat: 62.5511, lon: 7.7112, hdg: 322.0, t: "NOON", wx: "clear", steps: 378, secs: 18.9 },
    steps: "/4CAAP+AgAD/gIAA/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gJ8A/4CfAP+AnwD/gIAA",
    keys: "AAAAAAAAAAC31rNAAAAAAAAAAAAAAAAAAAAAABjs3T9XpkS+UPGOPnDsL8BPBAbAt9azQFKCb0Bv8kC/AAAAAAAAAAAd6t0/BcsxPp2sgj6Mu9nAMVGTwLfWs0ChdD1AgrivvwAAAAAAAAAAy9PTP6+VnL2ZePM+XZxCwZ+bEcG31rNAzjOwQOsR6b4AAAAAAAAAADZfaz8tGOa9lr0WPrsMjsFCZWXBt9azQHaJWEDZRGa/AAAAAAAAAAANbw1Apv0MP/aT7j6SPqLBDKptwbfWs0CBQIk+CgB+vwAAAAAAAAAArusjQN1z8T6CHBY/9H6qwROmVcG31rNAMMRev6aUn78AAACAAAAAAE4G5T+N6gE/Xy7lPnfdq8H95i/Bt9azQOqchL/G8h6/AAAAgAAAAADn/oM9dYj2vJFllj3F+a/B1jUpwbfWs0D+tYE/0qy5vgAAAAAAAAAAwU44PXZKiT49Ubo9u+C8wQqlM8G31rNA3+soP3E8Kr8AAAAAAAAAAPepyj628cU+y+tmPi3qx8EWlDPBt9azQDyTSj9E5zm/AAAAAAAAAADM3Rw+XAyDPuKXeD4+U9fB5tlCwbfWs0BzEtw/96Q1vwAAAAAAAAAAHZ2mPotTcz79qng+KwnqwaC9V8G31rNA8Q67P97CGr8AAAAAAAAAAHO5QT8QmJk+zZpNPg==",
  },
];
