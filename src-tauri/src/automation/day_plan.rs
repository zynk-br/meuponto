//! DayPlan — plano-do-dia explícito e persistido que dirige o scheduler.
//!
//! O portal continua sendo a fonte da verdade: a cada ciclo o plano é
//! reconciliado contra os pontos reais (`reconcile`). O anchoring é aplicado
//! no nascimento do plano (`build`), e o reagendamento em falha
//! (`apply_reschedule`) reusa a lógica de `anchoring::reschedule_with_delay`.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

use crate::automation::anchoring::{calculate_anchored_targets, reschedule_with_delay};
use crate::automation::portal::parse_time_minutes;

const STORE_FILENAME: &str = "settings.json";
const DAY_PLAN_KEY: &str = "dayPlan";
const DAY_PLAN_DRY_KEY: &str = "dayPlanDryRun";
const PUNCH_HISTORY_KEY: &str = "punchHistory";
/// Quantos dias de histórico manter.
const HISTORY_MAX_DAYS: usize = 30;

/// Chave de persistência conforme o modo (real x simulação), para que o
/// dry-run nunca contamine o plano real (usado na recuperação ao reiniciar).
fn store_key(dry_run: bool) -> &'static str {
    if dry_run {
        DAY_PLAN_DRY_KEY
    } else {
        DAY_PLAN_KEY
    }
}

/// Tolerância (em minutos) para casar uma batida planejada com um ponto real.
pub const TOLERANCE_MINUTES: i32 = 5;

/// Carência (minutos) antes de o reconcile reverter uma batida marcada como
/// Registered mas sem respaldo no portal. Evita corrida com um ponto recém-
/// batido que ainda não apareceu na sincronização.
const REVERT_GRACE_MINUTES: i64 = 3;

/// Verdadeiro se a batida foi registrada há mais de `REVERT_GRACE_MINUTES`
/// (ou se não há timestamp). Usado para reverter com segurança rótulos errados
/// sem desfazer uma batida que acabou de acontecer.
fn registered_long_ago(p: &PlannedPunch, now_iso: &str) -> bool {
    match (
        p.registered_at
            .as_deref()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()),
        chrono::DateTime::parse_from_rfc3339(now_iso).ok(),
    ) {
        (Some(reg), Some(now)) => (now - reg).num_minutes() >= REVERT_GRACE_MINUTES,
        _ => true,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PunchStatus {
    /// Ainda não tentada / aguardando o horário.
    Pending,
    /// Confirmada no portal (nossa ou manual).
    Registered,
    /// Esgotou as tentativas e não foi possível reagendar.
    Failed,
    /// Falhou mas foi reagendada com novo horário (volta a ser acionável).
    Rescheduled,
    /// Não será registrada (dia inválido/feriado).
    Skipped,
}

impl PunchStatus {
    /// Uma batida acionável é a que ainda precisa ser registrada.
    pub fn is_actionable(self) -> bool {
        matches!(self, PunchStatus::Pending | PunchStatus::Rescheduled)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedPunch {
    pub punch_type: String,
    /// Horário alvo atual (com anchoring/reschedule aplicados). "HH:MM".
    pub planned_time: String,
    /// Horário cru da agenda, antes de qualquer ajuste. Para auditoria.
    pub original_time: String,
    pub status: PunchStatus,
    pub attempts: u8,
    pub last_error: Option<String>,
    /// ISO-8601 do momento em que foi confirmada no portal.
    pub registered_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayPlan {
    /// "YYYY-MM-DD" — invalida o plano quando o dia vira.
    pub date: String,
    /// Nome do dia em português (chave da agenda).
    pub day_key: String,
    pub dry_run: bool,
    pub pre_assigned_interval: bool,
    /// Verdadeiro quando os pontos já registrados estão fora de ordem/incoerentes.
    pub invalid: bool,
    pub invalid_reason: Option<String>,
    pub punches: Vec<PlannedPunch>,
    pub created_at: String,
    pub last_reconciled_at: Option<String>,
    /// Evita reenviar o resumo diário a cada ciclo após a conclusão.
    #[serde(default)]
    pub summary_sent: bool,
}

/// Lê um campo de horário ("HH:MM") da entrada de agenda; "" se ausente.
fn field<'a>(entry: &'a serde_json::Value, key: &str) -> &'a str {
    entry.get(key).and_then(|v| v.as_str()).unwrap_or("")
}

/// Remove pontos duplicados/quase-iguais: dois pontos a menos de `TOLERANCE_MINUTES`
/// um do outro são a MESMA batida física (o portal às vezes registra uma batida
/// em duplicidade). Como batidas de tipos diferentes — entrada1/saída1/entrada2/
/// saída2 — nunca acontecem no mesmo minuto, colapsar pontos próximos é seguro e
/// evita que um ponto duplicado seja interpretado como a batida seguinte (ex.: um
/// 2º ponto de entrada1 às 08:54 ser tratado como saída2). Retorna ordenado.
pub fn dedup_points(points: &[String]) -> Vec<String> {
    let mut mins: Vec<i32> = points.iter().filter_map(|p| parse_time_minutes(p)).collect();
    mins.sort_unstable();
    let mut out: Vec<String> = Vec::new();
    let mut last: Option<i32> = None;
    for m in mins {
        if last.map_or(true, |l| (m - l).abs() > TOLERANCE_MINUTES) {
            out.push(format!("{:02}:{:02}", m / 60, m % 60));
            last = Some(m);
        }
    }
    out
}

/// Verifica se `target` casa com algum ponto da lista (tolerância ±N min).
pub fn time_matches(points: &[String], target: &str) -> bool {
    let t = match parse_time_minutes(target) {
        Some(m) => m,
        None => return false,
    };
    points
        .iter()
        .any(|p| parse_time_minutes(p).map_or(false, |m| (m - t).abs() <= TOLERANCE_MINUTES))
}

impl DayPlan {
    /// Monta o plano a partir da entrada de agenda do dia, aplicando anchoring
    /// sobre os pontos já existentes no portal. Função pura (testável).
    pub fn build(
        date: &str,
        day_key: &str,
        day_entry: &serde_json::Value,
        existing_points: &[String],
        pre_assigned_interval: bool,
        dry_run: bool,
        created_at: &str,
    ) -> DayPlan {
        let e1 = field(day_entry, "entrada1");
        let s1 = field(day_entry, "saida1");
        let e2 = field(day_entry, "entrada2");
        let s2 = field(day_entry, "saida2");

        let anchored = calculate_anchored_targets(e1, s1, e2, s2, existing_points);

        // (tipo, horário planejado, horário cru) na ordem de prioridade.
        let specs: Vec<(&str, &str, &str)> = if pre_assigned_interval {
            vec![
                ("entrada1", anchored.entrada1.as_str(), e1),
                ("saida2", anchored.saida2.as_str(), s2),
            ]
        } else {
            vec![
                ("entrada1", anchored.entrada1.as_str(), e1),
                ("saida1", anchored.saida1.as_str(), s1),
                ("entrada2", anchored.entrada2.as_str(), e2),
                ("saida2", anchored.saida2.as_str(), s2),
            ]
        };

        let mut punches = Vec::new();
        for (ptype, planned, original) in specs {
            // Pula batidas não configuradas na agenda.
            if planned.is_empty() || original.is_empty() {
                continue;
            }
            let already = time_matches(existing_points, planned);
            punches.push(PlannedPunch {
                punch_type: ptype.to_string(),
                planned_time: planned.to_string(),
                original_time: original.to_string(),
                status: if already {
                    PunchStatus::Registered
                } else {
                    PunchStatus::Pending
                },
                attempts: 0,
                last_error: None,
                registered_at: None,
            });
        }

        DayPlan {
            date: date.to_string(),
            day_key: day_key.to_string(),
            dry_run,
            pre_assigned_interval,
            invalid: anchored.invalid,
            invalid_reason: if anchored.invalid {
                Some("Pontos registrados hoje estão fora de ordem ou incoerentes.".to_string())
            } else {
                None
            },
            punches,
            created_at: created_at.to_string(),
            last_reconciled_at: None,
            summary_sent: false,
        }
    }

    /// Monta o plano para HOJE a partir da agenda completa. Retorna `None` em
    /// fim de semana, feriado, ou se não houver entrada para o dia.
    pub fn build_for_today(
        schedule: &serde_json::Value,
        existing_points: &[String],
        pre_assigned_interval: bool,
        dry_run: bool,
    ) -> Option<DayPlan> {
        use chrono::Datelike;
        let now = chrono::Local::now();
        let date = now.format("%Y-%m-%d").to_string();
        let day_key = crate::utils::time::weekday_pt(now.weekday()).to_string();

        let day_entry = schedule.get(&day_key)?;
        if day_entry
            .get("feriado")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            return None;
        }

        let plan = DayPlan::build(
            &date,
            &day_key,
            day_entry,
            existing_points,
            pre_assigned_interval,
            dry_run,
            &now.to_rfc3339(),
        );
        Some(plan)
    }

    /// Reconcilia o plano contra os pontos reais do portal.
    ///
    /// Casa os pontos com as batidas geridas POR ORDEM cronológica: o k-ésimo
    /// ponto real é a k-ésima batida do plano (a lista de batidas já exclui as
    /// pré-assinaladas). Assim, uma `entrada1` batida manualmente num horário
    /// diferente do planejado é reconhecida (não dispara de novo). Cada batida
    /// casada vira `Registered` com o horário REAL, e as batidas ainda pendentes
    /// são re-ancoradas a partir desses horários (recalcula saida2/entrada2 para
    /// manter a jornada).
    pub fn reconcile(&mut self, existing_points: &[String], now_iso: &str) {
        // Pontos reais ordenados cronologicamente.
        let mut pts: Vec<i32> = existing_points
            .iter()
            .filter_map(|p| parse_time_minutes(p))
            .collect();
        pts.sort_unstable();

        for (i, p) in self.punches.iter_mut().enumerate() {
            match pts.get(i) {
                Some(&real_min) => {
                    if p.status != PunchStatus::Registered {
                        p.status = PunchStatus::Registered;
                        if p.registered_at.is_none() {
                            p.registered_at = Some(now_iso.to_string());
                        }
                    }
                    // Reflete o horário REAL (para summary/auditoria e re-anchoring).
                    p.planned_time = crate::utils::time::minutes_to_time_string(real_min);
                }
                None => {
                    // Sem ponto real para esta batida no portal. Se ela estava
                    // marcada como Registered sem respaldo (ex.: rótulo errado de
                    // um ponto duplicado, agora removido pelo dedup), reverte para
                    // Pendente — a batida real ainda precisa acontecer. Reverte
                    // só após uma carência, para não brigar com um ponto recém-
                    // batido que ainda não apareceu no sync. Re-batida é segura:
                    // o pre-check de perform_punch pula se o horário já existir.
                    if p.status == PunchStatus::Registered && registered_long_ago(p, now_iso) {
                        p.status = PunchStatus::Pending;
                        p.registered_at = None;
                    }
                }
            }
        }

        self.reanchor_pending();
        self.last_reconciled_at = Some(now_iso.to_string());
    }

    /// Re-ancora as batidas ainda PENDENTES a partir dos horários já registrados
    /// (reais), preservando a jornada de trabalho agendada:
    /// - `entrada2` ← saída1 real + almoço agendado;
    /// - `saida2`   ← entrada2 + (trabalho agendado − manhã real), de modo que o
    ///   total trabalhado seja o agendado mesmo com almoço mais longo (>1h);
    ///   se só a `entrada1` é conhecida, usa o span total agendado (trabalho+almoço).
    fn reanchor_pending(&mut self) {
        use crate::utils::time::{minutes_to_time_string, parse_time_to_minutes};

        // Horário cru (agenda) por tipo.
        let orig = |t: &str| -> Option<i32> {
            self.punches
                .iter()
                .find(|p| p.punch_type == t)
                .and_then(|p| parse_time_to_minutes(&p.original_time))
        };
        // Horário REAL já registrado por tipo.
        let reg = |t: &str| -> Option<i32> {
            self.punches
                .iter()
                .find(|p| p.punch_type == t && p.status == PunchStatus::Registered)
                .and_then(|p| parse_time_to_minutes(&p.planned_time))
        };

        let (e1_o, s1_o, e2_o, s2_o) =
            (orig("entrada1"), orig("saida1"), orig("entrada2"), orig("saida2"));
        let (e1_r, s1_r, e2_r) = (reg("entrada1"), reg("saida1"), reg("entrada2"));

        // Span total agendado (trabalho + almoço) e trabalho/almoço agendados.
        let total_span = match (e1_o, s2_o) {
            (Some(a), Some(b)) => Some(b - a),
            _ => None,
        };
        let sched_worked = match (e1_o, s1_o, e2_o, s2_o) {
            (Some(a), Some(b), Some(c), Some(d)) => Some((b - a) + (d - c)),
            _ => None,
        };
        let sched_lunch = match (s1_o, e2_o) {
            (Some(b), Some(c)) => Some(c - b),
            _ => None,
        };

        // entrada2 pendente ← saída1 real + almoço agendado.
        let new_e2 = match (s1_r, sched_lunch) {
            (Some(s1), Some(l)) => Some(s1 + l),
            _ => None,
        };
        // entrada2 efetivo (real ou recém-calculado) p/ calcular saida2.
        let e2_eff = e2_r.or(new_e2);
        // saida2 pendente.
        let new_s2 = if let (Some(e1), Some(s1), Some(e2), Some(worked)) =
            (e1_r, s1_r, e2_eff, sched_worked)
        {
            // Mantém a jornada: total trabalhado = agendado, independente do almoço.
            Some(e2 + (worked - (s1 - e1)))
        } else if let (Some(e1), Some(span)) = (e1_r, total_span) {
            // Só entrada1 conhecida: preserva o span agendado (trabalho + almoço).
            Some(e1 + span)
        } else {
            None
        };

        for p in self.punches.iter_mut() {
            if p.status == PunchStatus::Registered {
                continue;
            }
            let nt = match p.punch_type.as_str() {
                "entrada2" => new_e2,
                "saida2" => new_s2,
                _ => None, // entrada1/saida1 pendentes mantêm o horário da agenda
            };
            if let Some(m) = nt {
                p.planned_time = minutes_to_time_string(m);
            }
        }
    }

    /// Índice da próxima batida acionável (na ordem de prioridade).
    pub fn next_actionable(&self) -> Option<usize> {
        self.punches.iter().position(|p| p.status.is_actionable())
    }

    /// Verdadeiro quando há batidas e todas foram registradas.
    pub fn all_registered(&self) -> bool {
        !self.punches.is_empty()
            && self.punches.iter().all(|p| p.status == PunchStatus::Registered)
    }

    /// Resumo legível do dia (para Telegram/log).
    pub fn summary(&self) -> String {
        let registradas: Vec<String> = self
            .punches
            .iter()
            .filter(|p| p.status == PunchStatus::Registered)
            .map(|p| format!("{}={}", p.punch_type, p.planned_time))
            .collect();
        let reagendadas = self.punches.iter().filter(|p| p.original_time != p.planned_time).count();
        let falhas = self.punches.iter().filter(|p| p.status == PunchStatus::Failed).count();
        format!(
            "✅ {} | reagendadas: {} | falhas: {}",
            if registradas.is_empty() { "nenhuma".to_string() } else { registradas.join(", ") },
            reagendadas,
            falhas
        )
    }

    /// Arquiva este plano no histórico (`punchHistory`), por data, mantendo os
    /// últimos HISTORY_MAX_DAYS dias. Não arquiva planos de simulação.
    pub fn archive(&self, app: &AppHandle) {
        if self.dry_run {
            return;
        }
        let store = match app.store(STORE_FILENAME) {
            Ok(s) => s,
            Err(_) => return,
        };
        let mut hist = store
            .get(PUNCH_HISTORY_KEY)
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();

        if let Ok(v) = serde_json::to_value(self) {
            hist.insert(self.date.clone(), v);
        }

        // Mantém apenas os últimos N dias (chaves YYYY-MM-DD ordenam cronologicamente).
        if hist.len() > HISTORY_MAX_DAYS {
            let mut keys: Vec<String> = hist.keys().cloned().collect();
            keys.sort();
            let excedente = hist.len() - HISTORY_MAX_DAYS;
            for k in keys.into_iter().take(excedente) {
                hist.remove(&k);
            }
        }

        store.set(PUNCH_HISTORY_KEY, serde_json::Value::Object(hist));
        let _ = store.save();
    }

    pub fn mark_registered(&mut self, idx: usize, at_iso: &str) {
        if let Some(p) = self.punches.get_mut(idx) {
            p.status = PunchStatus::Registered;
            p.registered_at = Some(at_iso.to_string());
        }
    }

    pub fn record_attempt(&mut self, idx: usize, error: Option<String>) {
        if let Some(p) = self.punches.get_mut(idx) {
            p.attempts = p.attempts.saturating_add(1);
            p.last_error = error;
        }
    }

    pub fn mark_failed(&mut self, idx: usize, error: Option<String>) {
        if let Some(p) = self.punches.get_mut(idx) {
            p.status = PunchStatus::Failed;
            if error.is_some() {
                p.last_error = error;
            }
        }
    }

    /// Reagenda a batida que falhou (e as dependentes) adicionando `delay_minutes`,
    /// reusando a cadeia de dependência de `reschedule_with_delay`. A batida que
    /// falhou volta a ser acionável (`Rescheduled`) com novo horário e contador
    /// de tentativas zerado.
    pub fn apply_reschedule(
        &mut self,
        failed_punch_type: &str,
        delay_minutes: i32,
        existing_points: &[String],
    ) {
        let orig = |t: &str| {
            self.punches
                .iter()
                .find(|p| p.punch_type == t)
                .map(|p| p.original_time.clone())
                .unwrap_or_default()
        };
        let (e1, s1, e2, s2) = (
            orig("entrada1"),
            orig("saida1"),
            orig("entrada2"),
            orig("saida2"),
        );

        let r = reschedule_with_delay(
            &e1,
            &s1,
            &e2,
            &s2,
            failed_punch_type,
            delay_minutes,
            existing_points,
        );

        for p in self.punches.iter_mut() {
            if p.status == PunchStatus::Registered {
                continue;
            }
            let new_time = match p.punch_type.as_str() {
                "entrada1" => &r.entrada1,
                "saida1" => &r.saida1,
                "entrada2" => &r.entrada2,
                "saida2" => &r.saida2,
                _ => continue,
            };
            // Só mexe nos horários que de fato mudaram, mas marca como reagendada
            // a batida que falhou (para zerar tentativas) e mantém as demais.
            if p.punch_type == failed_punch_type {
                p.planned_time = new_time.clone();
                p.status = PunchStatus::Rescheduled;
                p.attempts = 0;
            } else if new_time.as_str() != p.planned_time {
                p.planned_time = new_time.clone();
            }
        }
    }

    /// Calcula o datetime de um horário planejado, ancorado na data do plano.
    pub fn datetime_for(&self, planned_time: &str) -> Option<chrono::NaiveDateTime> {
        let date = chrono::NaiveDate::parse_from_str(&self.date, "%Y-%m-%d").ok()?;
        let mins = parse_time_minutes(planned_time)?;
        date.and_hms_opt((mins / 60) as u32, (mins % 60) as u32, 0)
    }

    // ---- Persistência (tauri-plugin-store, chave `dayPlan`) ----

    pub fn load(app: &AppHandle, dry_run: bool) -> Option<DayPlan> {
        let store = app.store(STORE_FILENAME).ok()?;
        let val = store.get(store_key(dry_run))?;
        serde_json::from_value(val).ok()
    }

    pub fn save(&self, app: &AppHandle) -> Result<(), String> {
        let store = app.store(STORE_FILENAME).map_err(|e| e.to_string())?;
        let val = serde_json::to_value(self).map_err(|e| e.to_string())?;
        store.set(store_key(self.dry_run), val);
        store.save().map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn day(e1: &str, s1: &str, e2: &str, s2: &str) -> serde_json::Value {
        json!({
            "entrada1": e1, "saida1": s1, "entrada2": e2, "saida2": s2, "feriado": false
        })
    }

    #[test]
    fn build_normal_no_points() {
        let d = day("08:00", "12:00", "13:00", "17:00");
        let plan = DayPlan::build("2026-06-16", "Terça-feira", &d, &[], false, false, "now");
        assert_eq!(plan.punches.len(), 4);
        assert!(!plan.invalid);
        // Sem pontos: planejado == cru, tudo pendente.
        for p in &plan.punches {
            assert_eq!(p.planned_time, p.original_time);
            assert_eq!(p.status, PunchStatus::Pending);
        }
        assert_eq!(plan.punches[0].punch_type, "entrada1");
        assert_eq!(plan.punches[3].punch_type, "saida2");
    }

    #[test]
    fn build_pre_assigned_has_two_punches() {
        let d = day("08:00", "12:00", "13:00", "17:00");
        let plan = DayPlan::build("2026-06-16", "Terça-feira", &d, &[], true, false, "now");
        assert_eq!(plan.punches.len(), 2);
        assert_eq!(plan.punches[0].punch_type, "entrada1");
        assert_eq!(plan.punches[1].punch_type, "saida2");
    }

    #[test]
    fn build_skips_unconfigured_punches() {
        let d = day("08:00", "", "", "17:00");
        let plan = DayPlan::build("2026-06-16", "Terça-feira", &d, &[], false, false, "now");
        // Só entrada1 e saida2 estão configuradas.
        let types: Vec<&str> = plan.punches.iter().map(|p| p.punch_type.as_str()).collect();
        assert_eq!(types, vec!["entrada1", "saida2"]);
    }

    #[test]
    fn build_anchors_and_marks_registered() {
        // entrada1 real às 08:15 → entrada1 fica Registered e saida2 ancora p/ 17:15.
        let d = day("08:00", "12:00", "13:00", "17:00");
        let plan = DayPlan::build(
            "2026-06-16",
            "Terça-feira",
            &d,
            &["08:15".to_string()],
            false,
            false,
            "now",
        );
        let e1 = &plan.punches[0];
        assert_eq!(e1.punch_type, "entrada1");
        assert_eq!(e1.planned_time, "08:15");
        assert_eq!(e1.status, PunchStatus::Registered);
        assert_eq!(e1.original_time, "08:00");
        let s2 = plan.punches.iter().find(|p| p.punch_type == "saida2").unwrap();
        assert_eq!(s2.planned_time, "17:15");
        assert_eq!(s2.status, PunchStatus::Pending);
    }

    #[test]
    fn build_marks_invalid_for_out_of_order_points() {
        let d = day("08:00", "12:00", "13:00", "17:00");
        let plan = DayPlan::build(
            "2026-06-16",
            "Terça-feira",
            &d,
            &["12:00".to_string(), "08:00".to_string()],
            false,
            false,
            "now",
        );
        assert!(plan.invalid);
        assert!(plan.invalid_reason.is_some());
    }

    #[test]
    fn dedup_collapses_near_duplicates() {
        // Duas batidas de entrada1 às 08:54 (duplicata do portal) → uma só.
        assert_eq!(dedup_points(&["08:54".into(), "08:54".into()]), vec!["08:54"]);
        // Dentro da tolerância (±5min) também colapsa.
        assert_eq!(dedup_points(&["08:54".into(), "08:57".into()]), vec!["08:54"]);
        // Batidas reais distantes não são afetadas (mantém ordenado).
        assert_eq!(
            dedup_points(&["17:54".into(), "08:54".into()]),
            vec!["08:54", "17:54"]
        );
    }

    #[test]
    fn reconcile_ignores_duplicate_entrada1_point() {
        // Pré-assinalado: batidas = [entrada1, saida2]. Portal com entrada1
        // duplicada (08:54 e 08:54) NÃO pode marcar a saída2 como registrada.
        let d = day("08:54", "12:00", "13:00", "17:54");
        let mut plan = DayPlan::build("2026-06-26", "Sexta-feira", &d, &[], true, false, "now");
        let pts = dedup_points(&["08:54".into(), "08:54".into()]);
        plan.reconcile(&pts, "ts");
        let e1 = plan.punches.iter().find(|p| p.punch_type == "entrada1").unwrap();
        let s2 = plan.punches.iter().find(|p| p.punch_type == "saida2").unwrap();
        assert_eq!(e1.status, PunchStatus::Registered);
        assert_eq!(e1.planned_time, "08:54");
        assert_eq!(s2.status, PunchStatus::Pending); // NÃO registrada
        assert_eq!(s2.planned_time, "17:54"); // reancorada para o fim do dia
    }

    #[test]
    fn reconcile_self_heals_mislabeled_saida2() {
        // Estado corrompido: saida2 marcada Registered às 08:54 (rótulo errado de
        // uma entrada1 duplicada). Com o portal mostrando só [08:54] (deduped) e
        // já passada a carência, o reconcile deve reverter saida2 para Pendente e
        // reancorar para 17:54 — para que a saída real às 17:54 ainda aconteça.
        let d = day("08:54", "12:00", "13:00", "17:54");
        let mut plan = DayPlan::build("2026-06-26", "Sexta-feira", &d, &[], true, false, "2026-06-26T08:54:00-03:00");
        // simula a corrupção
        for p in plan.punches.iter_mut() {
            p.status = PunchStatus::Registered;
            p.planned_time = "08:54".to_string();
            p.registered_at = Some("2026-06-26T08:54:29-03:00".to_string());
        }
        plan.reconcile(&["08:54".to_string()], "2026-06-26T09:10:00-03:00");
        let e1 = plan.punches.iter().find(|p| p.punch_type == "entrada1").unwrap();
        let s2 = plan.punches.iter().find(|p| p.punch_type == "saida2").unwrap();
        assert_eq!(e1.status, PunchStatus::Registered);
        assert_eq!(e1.planned_time, "08:54");
        assert_eq!(s2.status, PunchStatus::Pending); // revertida
        assert_eq!(s2.planned_time, "17:54"); // reancorada
    }

    #[test]
    fn reconcile_keeps_recent_punch_within_grace() {
        // Batida recém-registrada (segundos atrás) que ainda não apareceu no sync
        // NÃO deve ser revertida — evita corrida/dupla batida.
        let d = day("08:54", "12:00", "13:00", "17:54");
        let mut plan = DayPlan::build("2026-06-26", "Sexta-feira", &d, &[], true, false, "2026-06-26T08:54:00-03:00");
        let e1 = plan.punches.iter_mut().find(|p| p.punch_type == "entrada1").unwrap();
        e1.status = PunchStatus::Registered;
        e1.registered_at = Some("2026-06-26T08:54:29-03:00".to_string());
        // sync vazio, mas só 30s depois → dentro da carência → mantém Registered.
        plan.reconcile(&[], "2026-06-26T08:54:59-03:00");
        let e1 = plan.punches.iter().find(|p| p.punch_type == "entrada1").unwrap();
        assert_eq!(e1.status, PunchStatus::Registered);
    }

    #[test]
    fn reconcile_matches_points_in_order() {
        let d = day("08:00", "12:00", "13:00", "17:00");
        let mut plan = DayPlan::build("2026-06-16", "Terça-feira", &d, &[], false, false, "now");
        // entrada1 batida manualmente às 07:46 (≈1h antes do planejado 08:00).
        // Por ORDEM, o 1º ponto é a entrada1 — mesmo longe do horário planejado.
        plan.reconcile(&["07:46".to_string()], "ts");
        let e1 = plan.punches.iter().find(|p| p.punch_type == "entrada1").unwrap();
        assert_eq!(e1.status, PunchStatus::Registered);
        assert_eq!(e1.planned_time, "07:46"); // reflete o horário real
        assert_eq!(e1.registered_at.as_deref(), Some("ts"));
        assert_eq!(plan.last_reconciled_at.as_deref(), Some("ts"));
        // saida1 (só 1 ponto registrado) continua pendente.
        let s1 = plan.punches.iter().find(|p| p.punch_type == "saida1").unwrap();
        assert_eq!(s1.status, PunchStatus::Pending);
    }

    #[test]
    fn reconcile_reanchors_saida2_on_early_entrada1_pre_assigned() {
        // Pré-assinalado: batidas = [entrada1, saida2], span agendado = 9h.
        let d = day("08:44", "12:00", "13:00", "17:44");
        let mut plan = DayPlan::build("2026-06-16", "Terça-feira", &d, &[], true, false, "now");
        // entrada1 manual às 07:46 → saida2 deve reancorar para 07:46 + 9h = 16:46.
        plan.reconcile(&["07:46".to_string()], "ts");
        let e1 = plan.punches.iter().find(|p| p.punch_type == "entrada1").unwrap();
        assert_eq!(e1.status, PunchStatus::Registered);
        assert_eq!(e1.planned_time, "07:46");
        let s2 = plan.punches.iter().find(|p| p.punch_type == "saida2").unwrap();
        assert_eq!(s2.status, PunchStatus::Pending);
        assert_eq!(s2.planned_time, "16:46");
    }

    #[test]
    fn reconcile_keeps_8h_with_long_lunch() {
        // Agenda: 08:00-12:00 / 13:00-17:00 → 8h trabalho, 1h almoço.
        let d = day("08:00", "12:00", "13:00", "17:00");
        let mut plan = DayPlan::build("2026-06-16", "Terça-feira", &d, &[], false, false, "now");
        // entrada1 08:00, saida1 12:00, entrada2 14:00 (almoço de 2h).
        plan.reconcile(
            &["08:00".to_string(), "12:00".to_string(), "14:00".to_string()],
            "ts",
        );
        let e2 = plan.punches.iter().find(|p| p.punch_type == "entrada2").unwrap();
        assert_eq!(e2.status, PunchStatus::Registered);
        assert_eq!(e2.planned_time, "14:00");
        // saida2 = entrada2 + (trabalho agendado − manhã real) = 14:00 + (8h − 4h) = 18:00.
        let s2 = plan.punches.iter().find(|p| p.punch_type == "saida2").unwrap();
        assert_eq!(s2.status, PunchStatus::Pending);
        assert_eq!(s2.planned_time, "18:00");
    }

    #[test]
    fn next_actionable_skips_registered() {
        let d = day("08:00", "12:00", "13:00", "17:00");
        let mut plan = DayPlan::build("2026-06-16", "Terça-feira", &d, &[], false, false, "now");
        plan.punches[0].status = PunchStatus::Registered;
        assert_eq!(plan.next_actionable(), Some(1));
        for p in plan.punches.iter_mut() {
            p.status = PunchStatus::Registered;
        }
        assert!(plan.next_actionable().is_none());
    }

    #[test]
    fn apply_reschedule_normal_entrada1_shifts_e1_and_s2() {
        let d = day("08:00", "12:00", "13:00", "17:00");
        let mut plan = DayPlan::build("2026-06-16", "Terça-feira", &d, &[], false, false, "now");
        plan.apply_reschedule("entrada1", 10, &[]);
        let e1 = plan.punches.iter().find(|p| p.punch_type == "entrada1").unwrap();
        let s1 = plan.punches.iter().find(|p| p.punch_type == "saida1").unwrap();
        let e2 = plan.punches.iter().find(|p| p.punch_type == "entrada2").unwrap();
        let s2 = plan.punches.iter().find(|p| p.punch_type == "saida2").unwrap();
        assert_eq!(e1.planned_time, "08:10");
        assert_eq!(e1.status, PunchStatus::Rescheduled);
        assert_eq!(e1.attempts, 0);
        assert_eq!(s2.planned_time, "17:10");
        assert_eq!(s1.planned_time, "12:00"); // inalterado
        assert_eq!(e2.planned_time, "13:00"); // inalterado
    }

    #[test]
    fn apply_reschedule_pre_assigned_saida2_only() {
        let d = day("08:00", "12:00", "13:00", "17:00");
        let mut plan = DayPlan::build("2026-06-16", "Terça-feira", &d, &[], true, false, "now");
        plan.apply_reschedule("saida2", 10, &[]);
        let e1 = plan.punches.iter().find(|p| p.punch_type == "entrada1").unwrap();
        let s2 = plan.punches.iter().find(|p| p.punch_type == "saida2").unwrap();
        assert_eq!(e1.planned_time, "08:00"); // inalterado
        assert_eq!(s2.planned_time, "17:10");
        assert_eq!(s2.status, PunchStatus::Rescheduled);
    }

    #[test]
    fn all_registered_and_summary() {
        let d = day("08:00", "12:00", "13:00", "17:00");
        let mut plan = DayPlan::build("2026-06-16", "Terça-feira", &d, &[], false, false, "now");
        assert!(!plan.all_registered());
        for i in 0..plan.punches.len() {
            plan.mark_registered(i, "ts");
        }
        assert!(plan.all_registered());
        let s = plan.summary();
        assert!(s.contains("entrada1=08:00"));
        assert!(s.contains("reagendadas: 0"));
        assert!(s.contains("falhas: 0"));
    }

    #[test]
    fn summary_counts_reschedules() {
        let d = day("08:00", "12:00", "13:00", "17:00");
        let mut plan = DayPlan::build("2026-06-16", "Terça-feira", &d, &[], false, false, "now");
        plan.apply_reschedule("entrada1", 10, &[]); // muda entrada1 e saida2
        let s = plan.summary();
        assert!(s.contains("reagendadas: 2"), "{s}");
    }

    #[test]
    fn datetime_for_uses_plan_date() {
        let d = day("08:00", "12:00", "13:00", "17:00");
        let plan = DayPlan::build("2026-06-16", "Terça-feira", &d, &[], false, false, "now");
        let dt = plan.datetime_for("08:30").unwrap();
        assert_eq!(dt.to_string(), "2026-06-16 08:30:00");
    }
}
