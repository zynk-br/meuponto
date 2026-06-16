//! Validação proativa da agenda semanal.
//!
//! A verdade da validação fica no Rust (testável) e é usada como gate no
//! `start_automation` e exposta ao frontend via comando `validate_schedule`.
//! Melhoria sobre o Electron: em vez de pular um dia inválido em silêncio,
//! reportamos qual dia e por quê, antes de iniciar.

use serde::Serialize;

use crate::utils::time::{minutes_to_time_string, weekday_pt};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleIssue {
    pub day: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    pub valid: bool,
    pub issues: Vec<ScheduleIssue>,
}

fn field<'a>(entry: &'a serde_json::Value, key: &str) -> &'a str {
    entry.get(key).and_then(|v| v.as_str()).unwrap_or("").trim()
}

/// Faz o parse de "HH:MM" com validação de faixa (00:00–23:59).
fn parse_hhmm(s: &str) -> Result<i32, ()> {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() != 2 {
        return Err(());
    }
    let h: i32 = parts[0].parse().map_err(|_| ())?;
    let m: i32 = parts[1].parse().map_err(|_| ())?;
    if !(0..=23).contains(&h) || !(0..=59).contains(&m) {
        return Err(());
    }
    Ok(h * 60 + m)
}

/// Valida a entrada de um dia. Retorna `Some(mensagem)` no primeiro problema.
/// `None` = dia ok (inclui feriado e dia sem horários configurados).
fn validate_day(entry: &serde_json::Value, pre_assigned_interval: bool) -> Option<String> {
    // Feriado: nada a validar.
    if entry.get("feriado").and_then(|v| v.as_bool()).unwrap_or(false) {
        return None;
    }

    // No modo pré-assinalação, só E1 e S2 importam.
    let labels: Vec<(&str, &str)> = if pre_assigned_interval {
        vec![("Entrada 1", "entrada1"), ("Saída 2", "saida2")]
    } else {
        vec![
            ("Entrada 1", "entrada1"),
            ("Saída 1", "saida1"),
            ("Entrada 2", "entrada2"),
            ("Saída 2", "saida2"),
        ]
    };

    // Faz o parse das batidas configuradas (não-vazias), validando formato/faixa.
    let mut parsed: Vec<(&str, i32)> = Vec::new();
    for (label, key) in &labels {
        let raw = field(entry, key);
        if raw.is_empty() {
            continue;
        }
        match parse_hhmm(raw) {
            Ok(min) => parsed.push((label, min)),
            Err(()) => return Some(format!("{label} com horário inválido: \"{raw}\".")),
        }
    }

    // Sem horários configurados: nada a registrar nesse dia, ok.
    if parsed.is_empty() {
        return None;
    }

    // Devem ser estritamente crescentes na ordem canônica.
    for i in 1..parsed.len() {
        if parsed[i].1 <= parsed[i - 1].1 {
            return Some(format!(
                "{} ({}) deve ser depois de {} ({}).",
                parsed[i].0,
                minutes_to_time_string(parsed[i].1),
                parsed[i - 1].0,
                minutes_to_time_string(parsed[i - 1].1),
            ));
        }
    }

    None
}

/// Valida a agenda semanal inteira (apenas dias úteis). Retorna todos os
/// problemas encontrados, um por dia.
pub fn validate_schedule(schedule: &serde_json::Value, pre_assigned_interval: bool) -> ValidationResult {
    use chrono::Weekday;
    let weekdays = [
        Weekday::Mon,
        Weekday::Tue,
        Weekday::Wed,
        Weekday::Thu,
        Weekday::Fri,
    ];

    let mut issues = Vec::new();
    for wd in weekdays {
        let day_key = weekday_pt(wd);
        if let Some(entry) = schedule.get(day_key) {
            if let Some(msg) = validate_day(entry, pre_assigned_interval) {
                issues.push(ScheduleIssue {
                    day: day_key.to_string(),
                    message: msg,
                });
            }
        }
    }

    ValidationResult {
        valid: issues.is_empty(),
        issues,
    }
}

/// Resumo legível das pendências (para log/erro e Telegram).
pub fn format_issues(result: &ValidationResult) -> String {
    result
        .issues
        .iter()
        .map(|i| format!("{}: {}", i.day, i.message))
        .collect::<Vec<_>>()
        .join(" | ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sched(entries: serde_json::Value) -> serde_json::Value {
        entries
    }

    #[test]
    fn valid_full_week_passes() {
        let s = sched(json!({
            "Segunda-feira": {"entrada1":"08:00","saida1":"12:00","entrada2":"13:00","saida2":"17:00","feriado":false},
            "Terça-feira":   {"entrada1":"08:00","saida1":"12:00","entrada2":"13:00","saida2":"17:00","feriado":false},
        }));
        let r = validate_schedule(&s, false);
        assert!(r.valid, "{:?}", r.issues);
        assert!(r.issues.is_empty());
    }

    #[test]
    fn out_of_order_is_flagged_with_day_and_reason() {
        let s = sched(json!({
            "Segunda-feira": {"entrada1":"12:00","saida1":"08:00","entrada2":"13:00","saida2":"17:00","feriado":false},
        }));
        let r = validate_schedule(&s, false);
        assert!(!r.valid);
        assert_eq!(r.issues.len(), 1);
        assert_eq!(r.issues[0].day, "Segunda-feira");
        assert!(r.issues[0].message.contains("Saída 1"));
    }

    #[test]
    fn malformed_time_is_flagged() {
        let s = sched(json!({
            "Quarta-feira": {"entrada1":"25:99","saida1":"12:00","entrada2":"13:00","saida2":"17:00","feriado":false},
        }));
        let r = validate_schedule(&s, false);
        assert!(!r.valid);
        assert!(r.issues[0].message.contains("inválido"));
    }

    #[test]
    fn holiday_and_empty_days_are_ok() {
        let s = sched(json!({
            "Segunda-feira": {"entrada1":"","saida1":"","entrada2":"","saida2":"","feriado":true},
            "Terça-feira":   {"entrada1":"","saida1":"","entrada2":"","saida2":"","feriado":false},
        }));
        let r = validate_schedule(&s, false);
        assert!(r.valid);
    }

    #[test]
    fn pre_assigned_only_checks_e1_s2() {
        // S1 > E2 seria inválido no modo normal, mas pré-assinalação ignora S1/E2.
        let s = sched(json!({
            "Segunda-feira": {"entrada1":"08:00","saida1":"14:00","entrada2":"13:00","saida2":"17:00","feriado":false},
        }));
        assert!(!validate_schedule(&s, false).valid); // normal: S1(14:00) > E2(13:00) → erro
        assert!(validate_schedule(&s, true).valid); // pré-assinalação: só E1<S2 → ok
    }

    #[test]
    fn pre_assigned_e1_after_s2_is_flagged() {
        let s = sched(json!({
            "Segunda-feira": {"entrada1":"18:00","saida1":"12:00","entrada2":"13:00","saida2":"17:00","feriado":false},
        }));
        let r = validate_schedule(&s, true);
        assert!(!r.valid);
        assert!(r.issues[0].message.contains("Saída 2"));
    }

    #[test]
    fn partial_day_in_order_is_ok() {
        let s = sched(json!({
            "Sexta-feira": {"entrada1":"08:00","saida1":"","entrada2":"","saida2":"17:00","feriado":false},
        }));
        assert!(validate_schedule(&s, false).valid);
    }
}
