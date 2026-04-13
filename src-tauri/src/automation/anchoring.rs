use crate::utils::time::{minutes_to_time_string, parse_time_to_minutes};

/// Parameters extracted from a schedule entry (lunch duration, work duration)
pub struct ScheduleParameters {
    pub lunch_minutes: i32,
    pub work_minutes: i32,
}

/// Extract lunch and work duration from a schedule entry
pub fn extract_schedule_parameters(
    entrada1: &str,
    saida1: &str,
    entrada2: &str,
    saida2: &str,
) -> ScheduleParameters {
    let e1 = parse_time_to_minutes(entrada1).unwrap_or(0);
    let s1 = parse_time_to_minutes(saida1).unwrap_or(0);
    let e2 = parse_time_to_minutes(entrada2).unwrap_or(0);
    let s2 = parse_time_to_minutes(saida2).unwrap_or(0);

    if e1 == 0 || s1 == 0 || e2 == 0 || s2 == 0 {
        return ScheduleParameters {
            lunch_minutes: 60,
            work_minutes: 480,
        };
    }

    let lunch_minutes = e2 - s1;
    let total_minutes = s2 - e1;
    let work_minutes = total_minutes - lunch_minutes;

    ScheduleParameters {
        lunch_minutes,
        work_minutes,
    }
}

/// Result of anchored target calculation
pub struct AnchoredTargets {
    pub entrada1: String,
    pub saida1: String,
    pub entrada2: String,
    pub saida2: String,
    pub anchored: bool,
    pub invalid: bool,
}

/// Calculate targets (anchored to existing points if available)
///
/// Rules:
/// - If no points exist: return schedule as-is (no anchoring)
/// - If points exist but are out of order: mark day as INVALID
/// - If points exist and are valid: anchor remaining punches based on recorded ones
pub fn calculate_anchored_targets(
    entrada1: &str,
    saida1: &str,
    entrada2: &str,
    saida2: &str,
    existing_points: &[String],
) -> AnchoredTargets {
    // No existing points = use schedule as-is
    if existing_points.is_empty() {
        return AnchoredTargets {
            entrada1: entrada1.to_string(),
            saida1: saida1.to_string(),
            entrada2: entrada2.to_string(),
            saida2: saida2.to_string(),
            anchored: false,
            invalid: false,
        };
    }

    // Parse existing points to minutes
    let points_minutes: Vec<i32> = existing_points
        .iter()
        .filter_map(|p| parse_time_to_minutes(p))
        .collect();

    // Validate chronological order
    for i in 1..points_minutes.len() {
        if points_minutes[i] <= points_minutes[i - 1] {
            return AnchoredTargets {
                entrada1: entrada1.to_string(),
                saida1: saida1.to_string(),
                entrada2: entrada2.to_string(),
                saida2: saida2.to_string(),
                anchored: false,
                invalid: true,
            };
        }
    }

    // Validate gap if we have exactly 2 points (potential E1+S2 without S1/E2)
    if points_minutes.len() == 2 {
        let diff = points_minutes[1] - points_minutes[0];
        let params = extract_schedule_parameters(entrada1, saida1, entrada2, saida2);

        if diff > (params.lunch_minutes + params.work_minutes + 120) {
            return AnchoredTargets {
                entrada1: entrada1.to_string(),
                saida1: saida1.to_string(),
                entrada2: entrada2.to_string(),
                saida2: saida2.to_string(),
                anchored: false,
                invalid: true,
            };
        }
    }

    // Valid points: apply anchoring
    let params = extract_schedule_parameters(entrada1, saida1, entrada2, saida2);

    let scheduled_e1 = parse_time_to_minutes(entrada1).unwrap_or(0);
    let scheduled_s1 = parse_time_to_minutes(saida1).unwrap_or(0);
    let scheduled_e2 = parse_time_to_minutes(entrada2).unwrap_or(0);
    let scheduled_s2 = parse_time_to_minutes(saida2).unwrap_or(0);

    let mut target_e1 = scheduled_e1;
    let mut target_s1 = scheduled_s1;
    let mut target_e2 = scheduled_e2;
    let mut target_s2 = scheduled_s2;

    // Rule 1: If entrada1 recorded -> saida2 = entrada1_reg + work + lunch
    if !points_minutes.is_empty() {
        let entrada1_reg = points_minutes[0];
        target_e1 = entrada1_reg;
        target_s2 = entrada1_reg + params.work_minutes + params.lunch_minutes;
    }

    // Rule 2: If saida1 recorded -> entrada2 = saida1_reg + lunch
    if points_minutes.len() >= 2 {
        let saida1_reg = points_minutes[1];
        target_s1 = saida1_reg;
        target_e2 = saida1_reg + params.lunch_minutes;
    }

    // Rule 3: If entrada2 recorded, keep it
    if points_minutes.len() >= 3 {
        target_e2 = points_minutes[2];
    }

    // Rule 4: If saida2 recorded, keep it
    if points_minutes.len() >= 4 {
        target_s2 = points_minutes[3];
    }

    AnchoredTargets {
        entrada1: minutes_to_time_string(target_e1),
        saida1: minutes_to_time_string(target_s1),
        entrada2: minutes_to_time_string(target_e2),
        saida2: minutes_to_time_string(target_s2),
        anchored: true,
        invalid: false,
    }
}

/// Reschedule a failed punch by adding a delay and propagating to related punches
pub fn reschedule_with_delay(
    entrada1: &str,
    saida1: &str,
    entrada2: &str,
    saida2: &str,
    failed_punch_type: &str,
    delay_minutes: i32,
    existing_points: &[String],
) -> AnchoredTargets {
    let anchored = calculate_anchored_targets(entrada1, saida1, entrada2, saida2, existing_points);

    let mut target_e1 = parse_time_to_minutes(&anchored.entrada1).unwrap_or(0);
    let mut target_s1 = parse_time_to_minutes(&anchored.saida1).unwrap_or(0);
    let mut target_e2 = parse_time_to_minutes(&anchored.entrada2).unwrap_or(0);
    let mut target_s2 = parse_time_to_minutes(&anchored.saida2).unwrap_or(0);

    match failed_punch_type {
        "entrada1" => {
            target_e1 += delay_minutes;
            target_s2 += delay_minutes;
        }
        "saida1" => {
            target_s1 += delay_minutes;
            target_e2 += delay_minutes;
        }
        "entrada2" => {
            target_e2 += delay_minutes;
            target_s2 += delay_minutes;
        }
        "saida2" => {
            target_s2 += delay_minutes;
        }
        _ => {}
    }

    AnchoredTargets {
        entrada1: minutes_to_time_string(target_e1),
        saida1: minutes_to_time_string(target_s1),
        entrada2: minutes_to_time_string(target_e2),
        saida2: minutes_to_time_string(target_s2),
        anchored: anchored.anchored,
        invalid: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_schedule_parameters() {
        let params = extract_schedule_parameters("08:00", "12:00", "13:00", "17:00");
        assert_eq!(params.lunch_minutes, 60);
        assert_eq!(params.work_minutes, 480);
    }

    #[test]
    fn test_no_existing_points() {
        let result = calculate_anchored_targets("08:00", "12:00", "13:00", "17:00", &[]);
        assert!(!result.anchored);
        assert!(!result.invalid);
        assert_eq!(result.entrada1, "08:00");
        assert_eq!(result.saida2, "17:00");
    }

    #[test]
    fn test_anchoring_with_one_point() {
        let existing = vec!["08:15".to_string()];
        let result = calculate_anchored_targets("08:00", "12:00", "13:00", "17:00", &existing);
        assert!(result.anchored);
        assert!(!result.invalid);
        assert_eq!(result.entrada1, "08:15");
        // saida2 should be entrada1_reg + work + lunch = 08:15 + 480 + 60 = 17:15
        assert_eq!(result.saida2, "17:15");
    }

    #[test]
    fn test_invalid_out_of_order_points() {
        let existing = vec!["12:00".to_string(), "08:00".to_string()];
        let result = calculate_anchored_targets("08:00", "12:00", "13:00", "17:00", &existing);
        assert!(result.invalid);
    }

    #[test]
    fn test_reschedule_entrada1() {
        let result = reschedule_with_delay("08:00", "12:00", "13:00", "17:00", "entrada1", 10, &[]);
        assert_eq!(result.entrada1, "08:10");
        assert_eq!(result.saida2, "17:10");
        assert_eq!(result.saida1, "12:00"); // unchanged
        assert_eq!(result.entrada2, "13:00"); // unchanged
    }

    #[test]
    fn test_reschedule_saida1() {
        let result = reschedule_with_delay("08:00", "12:00", "13:00", "17:00", "saida1", 10, &[]);
        assert_eq!(result.saida1, "12:10");
        assert_eq!(result.entrada2, "13:10");
        assert_eq!(result.entrada1, "08:00"); // unchanged
        assert_eq!(result.saida2, "17:00"); // unchanged
    }
}
