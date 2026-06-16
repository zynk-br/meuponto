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
}

/// Lê um campo de horário ("HH:MM") da entrada de agenda; "" se ausente.
fn field<'a>(entry: &'a serde_json::Value, key: &str) -> &'a str {
    entry.get(key).and_then(|v| v.as_str()).unwrap_or("")
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

    /// Reconcilia o plano contra os pontos reais do portal. Marca como
    /// `Registered` toda batida (não-registrada) cujo horário planejado casar.
    pub fn reconcile(&mut self, existing_points: &[String], now_iso: &str) {
        for p in self.punches.iter_mut() {
            if p.status == PunchStatus::Registered {
                continue;
            }
            if time_matches(existing_points, &p.planned_time) {
                p.status = PunchStatus::Registered;
                if p.registered_at.is_none() {
                    p.registered_at = Some(now_iso.to_string());
                }
            }
        }
        self.last_reconciled_at = Some(now_iso.to_string());
    }

    /// Índice da próxima batida acionável (na ordem de prioridade).
    pub fn next_actionable(&self) -> Option<usize> {
        self.punches.iter().position(|p| p.status.is_actionable())
    }

    /// Verdadeiro quando não resta nenhuma batida acionável.
    pub fn is_complete(&self) -> bool {
        self.next_actionable().is_none()
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

    pub fn clear(app: &AppHandle, dry_run: bool) -> Result<(), String> {
        let store = app.store(STORE_FILENAME).map_err(|e| e.to_string())?;
        store.delete(store_key(dry_run));
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
    fn reconcile_marks_registered_for_matching_points() {
        let d = day("08:00", "12:00", "13:00", "17:00");
        let mut plan = DayPlan::build("2026-06-16", "Terça-feira", &d, &[], false, false, "now");
        // Ponto manual às 12:02 casa com saida1 (12:00) dentro da tolerância.
        plan.reconcile(&["12:02".to_string()], "ts");
        let s1 = plan.punches.iter().find(|p| p.punch_type == "saida1").unwrap();
        assert_eq!(s1.status, PunchStatus::Registered);
        assert_eq!(s1.registered_at.as_deref(), Some("ts"));
        assert_eq!(plan.last_reconciled_at.as_deref(), Some("ts"));
        // entrada1 (08:00) não casa → continua pendente.
        let e1 = plan.punches.iter().find(|p| p.punch_type == "entrada1").unwrap();
        assert_eq!(e1.status, PunchStatus::Pending);
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
        assert!(plan.is_complete());
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
    fn datetime_for_uses_plan_date() {
        let d = day("08:00", "12:00", "13:00", "17:00");
        let plan = DayPlan::build("2026-06-16", "Terça-feira", &d, &[], false, false, "now");
        let dt = plan.datetime_for("08:30").unwrap();
        assert_eq!(dt.to_string(), "2026-06-16 08:30:00");
    }
}
