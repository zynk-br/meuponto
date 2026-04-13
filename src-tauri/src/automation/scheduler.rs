// TODO: Fase 6 — Heartbeat scheduler com tokio
//
// Responsabilidades:
// - get_next_punch(schedule, existing_points) — determinar próxima batida
// - schedule_heartbeat(next_punch) — timer adaptativo (5min → 1min → 5s)
// - AutomationManager com CancellationToken para start/stop limpo
// - Serialização de operações via Mutex (fix do race condition)
