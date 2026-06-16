use icalendar::{Calendar, Component, Event, EventLike, Alarm, Trigger};
use chrono::{Datelike, Duration, Local, NaiveTime};
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::utils::time;

#[derive(Debug, Serialize)]
pub struct ExportResult {
    pub success: bool,
    pub path: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn export_calendar(
    app: AppHandle,
    schedule: serde_json::Value,
) -> Result<ExportResult, String> {
    match generate_calendar_file(&app, &schedule) {
        Ok(ics_path) => {
            // Open the file with default application
            let path_str = ics_path.to_string_lossy().to_string();
            let _ = open::that(&ics_path);

            Ok(ExportResult {
                success: true,
                path: Some(path_str),
                error: None,
            })
        }
        Err(e) => Ok(ExportResult {
            success: false,
            path: None,
            error: Some(e),
        }),
    }
}

fn generate_calendar_file(
    app: &AppHandle,
    schedule: &serde_json::Value,
) -> Result<PathBuf, String> {
    let mut calendar = Calendar::new();
    calendar.name("Registro de Ponto");

    let today = Local::now().date_naive();
    let current_day_of_week = today.weekday();

    // Calculate Monday of the current week
    let days_since_monday = current_day_of_week.num_days_from_monday();
    let week_start = today - Duration::days(days_since_monday as i64);

    // Days of the week mapping
    let days = [
        (chrono::Weekday::Mon, 0),
        (chrono::Weekday::Tue, 1),
        (chrono::Weekday::Wed, 2),
        (chrono::Weekday::Thu, 3),
        (chrono::Weekday::Fri, 4),
    ];

    for (weekday, offset) in &days {
        let day_name = time::weekday_pt(*weekday);
        let event_date = week_start + Duration::days(*offset);

        // Skip past days
        if event_date < today {
            continue;
        }

        let day_entry = match schedule.get(day_name) {
            Some(entry) => entry,
            None => continue,
        };

        // Skip holidays
        if day_entry
            .get("feriado")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            continue;
        }

        // Create events for each punch time
        let punch_times = [
            ("entrada1", "Entrada 1"),
            ("saida1", "Saída 1"),
            ("entrada2", "Entrada 2"),
            ("saida2", "Saída 2"),
        ];

        for (field, label) in &punch_times {
            let time_str = match day_entry.get(*field).and_then(|v| v.as_str()) {
                Some(t) if !t.is_empty() => t,
                _ => continue,
            };

            let parts: Vec<&str> = time_str.split(':').collect();
            if parts.len() != 2 {
                continue;
            }
            let hours: u32 = parts[0].parse().unwrap_or(0);
            let minutes: u32 = parts[1].parse().unwrap_or(0);

            let start_time = match NaiveTime::from_hms_opt(hours, minutes, 0) {
                Some(t) => t,
                None => continue,
            };
            let end_time = start_time + Duration::minutes(5);

            let start_dt = event_date.and_time(start_time);
            let end_dt = event_date.and_time(end_time);

            let event = Event::new()
                .summary(&format!("🕐 {} - Registro de Ponto", label))
                .description(&format!(
                    "Lembrete para registrar ponto: {} às {}",
                    label, time_str
                ))
                .location("Central do Funcionário")
                .starts(start_dt)
                .ends(end_dt)
                .alarm(Alarm::display(
                    "Registro de Ponto em 5 minutos",
                    Trigger::before_start(Duration::minutes(5)),
                ))
                .alarm(Alarm::display(
                    "Registro de Ponto em 1 minuto",
                    Trigger::before_start(Duration::minutes(1)),
                ))
                .done();

            calendar.push(event);
        }
    }

    let ics_content = calendar.to_string();
    let ics_path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Erro ao obter diretório: {e}"))?
        .join("registro-ponto.ics");

    std::fs::write(&ics_path, ics_content)
        .map_err(|e| format!("Erro ao salvar arquivo .ics: {e}"))?;

    Ok(ics_path)
}
