use chrono::Weekday;

/// Mapeia Weekday para nome em português (determinístico, sem depender de locale do OS)
pub fn weekday_pt(weekday: Weekday) -> &'static str {
    match weekday {
        Weekday::Mon => "Segunda-feira",
        Weekday::Tue => "Terça-feira",
        Weekday::Wed => "Quarta-feira",
        Weekday::Thu => "Quinta-feira",
        Weekday::Fri => "Sexta-feira",
        Weekday::Sat => "Sábado",
        Weekday::Sun => "Domingo",
    }
}

/// Converte total de minutos para string HH:MM
pub fn minutes_to_time_string(total_minutes: i32) -> String {
    let hours = (total_minutes / 60) % 24;
    let minutes = total_minutes % 60;
    format!("{:02}:{:02}", hours, minutes)
}

/// Parse string HH:MM para total de minutos
pub fn parse_time_to_minutes(time_str: &str) -> Option<i32> {
    let parts: Vec<&str> = time_str.split(':').collect();
    if parts.len() != 2 {
        return None;
    }
    let hours: i32 = parts[0].parse().ok()?;
    let minutes: i32 = parts[1].parse().ok()?;
    Some(hours * 60 + minutes)
}

/// Verifica se um dia da semana é dia útil (seg-sex)
pub fn is_weekday(weekday: Weekday) -> bool {
    !matches!(weekday, Weekday::Sat | Weekday::Sun)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_weekday_pt() {
        assert_eq!(weekday_pt(Weekday::Mon), "Segunda-feira");
        assert_eq!(weekday_pt(Weekday::Fri), "Sexta-feira");
    }

    #[test]
    fn test_minutes_to_time_string() {
        assert_eq!(minutes_to_time_string(0), "00:00");
        assert_eq!(minutes_to_time_string(480), "08:00");
        assert_eq!(minutes_to_time_string(1080), "18:00");
    }

    #[test]
    fn test_parse_time() {
        assert_eq!(parse_time_to_minutes("08:00"), Some(480));
        assert_eq!(parse_time_to_minutes("18:30"), Some(1110));
        assert_eq!(parse_time_to_minutes("invalid"), None);
    }

    #[test]
    fn test_is_weekday() {
        assert!(is_weekday(Weekday::Mon));
        assert!(is_weekday(Weekday::Fri));
        assert!(!is_weekday(Weekday::Sat));
        assert!(!is_weekday(Weekday::Sun));
    }
}
